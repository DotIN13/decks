import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { sttReady, transcribe } from "./stt.ts";
import { readFile } from "node:fs/promises";
import { renderShell } from "./boards/shell.ts";
import { LIB_FOREVER, libVersion, splitLibVersion, versionLibRefs } from "./deck/lib-version.ts";
import { normalizeBoardPath } from "./deck/schema.ts";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheControlFor, compressedStatic } from "./static.ts";
import { appRequest } from "./apps/route.ts";
import { SDK_FILE } from "./apps/service.ts";
import { forwardRequest } from "./ports.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MAX_UPLOAD_BYTES, STT_MODELS, THINKING_LEVELS, type ExtensionUiAnswer, type ThinkingLevel } from "@decks/protocol";
import { fileUrl, NotFound, PathRefused, resolveFileRequest, resolveInDeck, resolveServed } from "./deck/roots.ts";
import { canvasFolder, canvasNameOk, canvasOfPath, isBoardPagePath, isCardPath, isSharedCanvas, servedAs, SHARED_SANDBOX } from "./deck/layout.ts";
import { cardModules, cardPage, readDeckImports } from "./boards/cards.ts";
import { unstampCard } from "@decks/board-host";
import { browse } from "./files/browse.ts";
import { filePreview, previewKind } from "./files/preview.ts";
import { assetHeaders, boardHeaders, quarantine } from "./files/serve.ts";
import { storeAssetStream, UploadRefused, withMedia } from "./files/upload.ts";
import { boardOnCanvas, verbRoutes } from "./verbs/router.ts";
import { renderSnapshot } from "./boards/snapshot.ts";
import { pictureType, SMALL_WIDTHS } from "./boards/thumbs.ts";
import type { App } from "./app.ts";
import type { ServerMessage } from "@decks/protocol";
import { buildBundle, bundleFileName } from "./share/bundle.ts";
import { guard } from "./auth/guard.ts";
import { extraHosts, hostAllowed, hostRefusal } from "./auth/hosts.ts";
import { doorRoutes, isTopNavigation, tabToken, withSession } from "./auth/issue.ts";
import { actsAsPerson } from "./auth/principal.ts";
import { Relay } from "./share/relay.ts";

/**
 * The HTTP surface: reading files, writing one kind of file, and the built UI.
 *
 * Almost everything that *changes* something goes over the WebSocket, because the
 * socket is where state lives — but bytes are not state. A file the user drags in
 * from the desktop has to arrive as a body on a request (`POST /api/upload`), so
 * this file does have one mutating route, and it is the only way anything in Decks
 * writes a file the user did not name.
 *
 * The routes that turn a URL into a file, plus that one, are the security boundary
 * of the whole app. Every one of them asks `deck/roots.ts` where the path may go
 * and nothing else makes that decision. The upload route adds its own guards, all
 * in `files/upload.ts`: a size cap refused before the body is buffered, a name
 * derived rather than trusted, a refusal to overwrite, and one `Sec-Fetch-Site`
 * check so it is not the easiest way in.
 *
 * Who may ask for any of it is decided once, before every route, by the gate (`auth/guard.ts`): a
 * request carries a token, and the token's principal is who is calling.
 */

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
	return (req: Request, res: Response, next: NextFunction) => {
		handler(req, res).catch(next);
	};
}

/**
 * Whether a deck-relative path is a board, as opposed to a file a board uses.
 *
 * Answered from the shape of the path rather than by asking the open deck, on
 * purpose: a board written a moment ago is on disk before the watcher has told the
 * deck about it, and a board served as an asset would lose the origin the editor
 * needs — a wrong answer that reads as "editing stopped working".
 */
function isBoardPath(requested: string): boolean {
	// The library's `boards/`, or a canvas's own (`deck/layout.ts`): both are boards.
	return isBoardPagePath(requested);
}

/**
 * A friend's board, or anything else from a canvas shared with you, is someone else's page on your
 * machine: sent with a sandbox of its own, so it has a blank origin wherever it is opened, a frame or
 * a tab, and can reach nothing of the harness's (`deck/layout.ts`).
 */
function sharedHeaders(res: Response): void {
	res.setHeader("Content-Security-Policy", `sandbox ${SHARED_SANDBOX}`);
	res.setHeader("Referrer-Policy", "no-referrer");
}

/** The wildcard segment of `/api/board/*path`, as one forward-slashed string. */
function wildcard(req: Request): string {
	const raw = (req.params as Record<string, string | string[]>).path;
	return Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
}

export function createHttpApp(app: App): Express {
	const server = express();
	server.disable("x-powered-by");
	/*
	 * Before anything else, the name the request was addressed to (`share/hosts.ts`): a page that
	 * pointed its own name at this server (DNS rebinding) is refused here, ahead of the forwarded
	 * ports and apps that would otherwise answer it as one of their own.
	 */
	const hosts = extraHosts(process.env, app.config.host);
	server.use((req, res, next) => {
		if (hostAllowed(req.headers.host, hosts)) return next();
		res.status(403).type("text").send(hostRefusal(req.headers.host));
	});
	/*
	 * Forwarded ports first (`ports.ts`), before any body is read: the request is somebody
	 * else's server's, and a JSON parser here would eat the body it is waiting for.
	 */
	server.use((req, res, next) => {
		if (!forwardRequest(req, res, app.forwards)) next();
	});
	// A tab another site opens an app in: an app pass for that app (`auth/passes.ts`), or a ticket from before (`auth/tickets.ts`).
	const ticketed = (ticket: string | undefined, path: string | undefined, opening?: { pass: string | undefined; name: string }) => {
		if (opening) {
			const pass = app.passes.openApp(opening.pass);
			return pass?.holder === "tab" && pass.app === opening.name;
		}
		return app.tickets.admits(ticket, path);
	};
	// A token that is the person's or a paired site's, from the page it came with (`auth/tokens.ts`).
	const paired = (token: string | undefined, origin?: string) => {
		const seen = app.tokens.verify(token, { origin });
		return seen.ok && actsAsPerson(seen.principal);
	};
	// The deck's apps (`apps/route.ts`), for the same reason: a server app's request is the app's.
	server.use((req, res, next) => {
		if (!appRequest(req, res, app.apps, paired, ticketed)) next();
	});

	/*
	 * The gate (`auth/guard.ts`): every request from here on carries a token, and who is calling is
	 * that token's principal, on `req.principal`. Before any body is read: a request refused is not read.
	 */
	server.use(guard(app));
	// Bodies after the gate.
	server.use(express.json({ limit: "8mb" }));

	const api = express.Router();
	// Every verb in the table, for the SDK's three forms (`verbs/router.ts`).
	api.use("/v1", verbRoutes(app));
	// The doors, where tokens are handed out (`auth/issue.ts`).
	api.use(doorRoutes(app));
	const relay = new Relay(join(app.deck.path, ".decks", "relay.json"));
	server.all("/c/:id/*rest", asyncRoute((req, res) => relay.pass(req, res)));

	/**
	 * A person's acts on an agent from another front end, such as Studio's agent rows: what this
	 * app's own page sends on its socket (`wire/agents.ts`). `rename` takes `{ name }`, refused when
	 * another agent has it; `stop` ends the turn it is running; `remove` takes it off this deck.
	 */
	/**
	 * What another front end's composer offers for one agent (Studio's model menu): the model it is on
	 * with its thinking level, the models its runtime offers here, and, for a Claude agent, the
	 * subscriptions it could spend and the one it does. `?limits=1` reads the accounts' 5-hour
	 * figures again, as this app's picker does on opening; they arrive with the next read.
	 */
	/*
	 * An agent's conversation, for another front end's transcript (Studio): the window a browser is
	 * given when it opens a chat (`chat.open`), a page before an item (`chat.earlier`), and one tool
	 * call's whole result (`chat.tool`). What happens next arrives on the event stream as
	 * `chat.item`, `chat.delta` and `chat.history`.
	 */
	api.get("/agents/:id/history", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const message = agent.historyMessage() as { items: unknown[]; more?: boolean };
		res.set("cache-control", "no-store").json({ items: message.items, more: message.more ?? false });
	});
	api.get("/agents/:id/earlier", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const page = agent.earlier(String(req.query.before ?? ""), Math.min(Math.max(Number(req.query.limit) || 60, 1), 200));
		res.set("cache-control", "no-store").json({ items: page.items, more: page.more });
	});
	api.get("/agents/:id/tool/:item", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		res.set("cache-control", "no-store").json({ result: agent?.toolResult(String(req.params.item)) ?? "" });
	});

	/** The questions an agent is waiting on, for a front end that arrives after they were asked. */
	api.get("/agents/:id/dialogs", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		res.set("cache-control", "no-store").json({ dialogs: agent.dialogs() });
	});

	api.get(
		"/agents/:id/settings",
		asyncRoute(async (req, res) => {
			const agent = app.agents.get(String(req.params.id));
			if (!agent) {
				res.status(404).json({ error: "No agent here has that id." });
				return;
			}
			if (req.query.limits) void app.refreshLimits();
			let accounts: { accounts?: unknown[]; active?: string } = {};
			if (agent.kind === "claude") await app.publishAccounts((frame) => frame.type === "claude.accounts" && (accounts = frame));
			res.set("cache-control", "no-store").json({
				id: agent.id,
				kind: agent.kind,
				model: agent.model ?? null,
				models: app.runtimes().find((runtime) => runtime.kind === agent.kind)?.models ?? [],
				// How much it asks before acting, and the modes its runtime offers (none for Pi).
				// What `/` completes to: the session's own list once it has run, else its runtime's.
				commands: agent.chat().commands ?? app.runtimes().find((runtime) => runtime.kind === agent.kind)?.commands ?? [],
				mode: agent.mode ?? null,
				// How full its context is and what the session has cost: the composer's dial.
				usage: agent.usage ?? null,
				modes: app.runtimes().find((runtime) => runtime.kind === agent.kind)?.capabilities.modes ?? [],
				accounts: accounts.accounts ?? [],
				account: agent.accountId() ?? accounts.active ?? null,
				// The person's own messages waiting for the turn to end (Ctrl+Enter), and whether Stop holds them.
				queued: agent.queuedMine(),
			});
		}),
	);

	/**
	 * This harness's own settings, for another front end's settings page (Studio's harness page):
	 * the machine (deck folder, timezone, version), what its agents run on (runtimes, Claude accounts,
	 * the server's speech model) and who reaches it (the front ends paired, whether a code is asked
	 * for, the Decks extension). What this app's own Settings shows over its socket, read in one call.
	 */
	api.get(
		"/harness",
		asyncRoute(async (req, res) => {
			let accounts: { accounts?: unknown[]; active?: string } = {};
			await app.publishAccounts((frame) => frame.type === "claude.accounts" && (accounts = frame));
			const settings = app.settings.get();
			const you = req.tokenId;
			res.set("cache-control", "no-store").json({
				name: app.deck.name,
				deck: app.deck.path,
				version: harnessVersion(),
				timezone: settings.timezone ?? null,
				machineZone: app.settings.machineZone(),
				sttModel: settings.sttModel ?? STT_MODELS[0]!.id,
				sttModels: STT_MODELS.map((one) => ({ id: one.id, label: one.label ?? one.id })),
				sttKey: sttReady(),
				runtimes: app.runtimes().map((one) => ({ kind: one.kind, label: one.label, available: one.available, ...(one.reason ? { reason: one.reason } : {}), models: one.models?.length ?? 0 })),
				accounts: accounts.accounts ?? [],
				paired: app.tokens.paired().map((one) => ({ ...one, ...(one.id === you ? { you: true } : {}) })),
				requireCode: app.codes.required,
				requireCodeForced: app.codes.forced,
				extension: { status: app.web.status() },
			});
		}),
	);

	/** Change them: `{ timezone, sttModel, requireCode }`, each only when named; the answer is the whole page again. */
	api.post("/harness", (req, res) => {
		const body = (req.body ?? {}) as { timezone?: unknown; sttModel?: unknown; requireCode?: unknown };
		const refused: string[] = [];
		if (body.timezone !== undefined) {
			const outcome = app.setTimezone(typeof body.timezone === "string" ? body.timezone : null);
			if (outcome) refused.push(outcome.error);
		}
		if (body.sttModel !== undefined) {
			const outcome = app.setSttModel(typeof body.sttModel === "string" ? body.sttModel : null);
			if (outcome) refused.push(outcome.error);
		}
		if (typeof body.requireCode === "boolean") {
			if (app.codes.forced && !body.requireCode) refused.push("This harness was started with DECKS_REQUIRE_PAIR_CODE, so a code is always asked for.");
			else app.codes.setRequired(body.requireCode);
		}
		if (refused.length) res.status(400).json({ error: refused.join(" ") });
		else res.json({ ok: true });
	});

	/** Take a paired front end's token back; the one asking may take back its own, and is then unpaired. */
	api.post("/harness/paired/:id/revoke", (req, res) => {
		const id = String(req.params.id);
		if (!app.tokens.paired().some((one) => one.id === id) || !app.tokens.revoke(id)) {
			res.status(404).json({ error: "No front end with that id is paired here." });
			return;
		}
		app.send(app.pairingMessage());
		res.json({ revoked: true });
	});

	/** A fresh code for the Decks extension: the old one stops working. */
	api.post("/harness/extension/code", (_req, res) => {
		res.json({ code: app.web.repair() });
	});

	/** Forget a Claude account this harness signed in to; its own login stays. */
	api.post("/harness/accounts/:id/forget", (req, res) => {
		app.claudeAccounts.forget(String(req.params.id));
		void app.publishAccounts();
		res.json({ forgotten: true });
	});

	/**
	 * Delete a board's file, for another front end's board pill (Studio): what this app's own page sends
	 * on its socket (`board.delete`). A revision of it is kept first, as there.
	 */
	api.post("/boards/delete", (req, res) => {
		const path = String(((req.body ?? {}) as { path?: unknown }).path ?? "");
		let refused: string | undefined;
		app.boards.deleteBoard(path, (message) => {
			if (message.type === "notice") refused = message.text;
		});
		if (refused) res.status(/no board/i.test(refused) ? 404 : 409).json({ error: refused });
		else res.json({ path, deleted: true });
	});

	api.post("/agents/:id/:act", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const act = String(req.params.act);
		/*
		 * What a person types, as this app's own composer sends it (`agent.prompt` on the socket):
		 * untouched, so a `/` command runs as one. Answered at once; what it does arrives as events.
		 */
		if (act === "prompt") {
			const text = String(((req.body ?? {}) as { text?: unknown }).text ?? "");
			if (!text.trim()) {
				res.status(400).json({ error: "Say something to send." });
				return;
			}
			// Said from a canvas (Studio's composer): the agent works on that one, as an agent talked
			// to from this app's own canvas does, rather than being told which in the words.
			const canvas = ((req.body ?? {}) as { canvas?: unknown }).canvas;
			if (typeof canvas === "string" && canvas && agent.stageName() !== canvas) {
				try {
					agent.openStage(canvas);
				} catch {
					// A canvas this harness has not synced yet: the words still go.
				}
			}
			void agent.prompt(text);
			agent.sayRow();
			res.json({ id: agent.id, sent: true });
			return;
		}
		/*
		 * The time machine, from a message's buttons in another front end (Studio), as this app's
		 * own socket does it (`rewind.to`, `fork.from` in `wire/agents.ts`). A rewind may ask first,
		 * on the agent's dialog; the words it took back come back for the composer.
		 */
		if (act === "rewind" || act === "fork") {
			const entryId = String(((req.body ?? {}) as { entryId?: unknown }).entryId ?? "");
			if (!entryId) {
				res.status(400).json({ error: "Name the message, by its entry." });
				return;
			}
			// A dormant agent has no session in memory to go back in: wake it first, as sending to it would.
			const ready = agent.start().catch(() => undefined);
			if (act === "rewind") {
				ready.then(() => agent.rewindTo(entryId)).then(
					(result) => {
						app.agents.publish();
						res.json(result.cancelled ? { cancelled: true } : { rewound: true, ...(result.editorText ? { editorText: result.editorText } : {}) });
					},
					(error: unknown) => res.status(400).json({ error: (error as Error).message }),
				);
				return;
			}
			ready.then(() => agent.forkFrom(entryId)).then(
				(resumeRef) => {
					if (!resumeRef) {
						res.status(409).json({ error: "There is nothing before that message to fork from." });
						return;
					}
					const at = agent.entryTime(entryId);
					const child = app.agents.create({
						name: `${agent.chat().name} (fork)`,
						resumeRef,
						kind: agent.kind,
						...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
						...(agent.model ? { model: agent.model } : {}),
						...(agent.mode ? { mode: agent.mode } : {}),
					});
					res.json({ id: child.id, name: child.chat().name });
				},
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		/** Start the agent afresh: a new conversation, the same agent (`session.reset`). */
		if (act === "reset") {
			agent.reset().then(
				() => {
					app.agents.publish();
					res.json({ id: agent.id, reset: true });
				},
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		/** The project an agent is filed under, from another front end's agent list (Studio); null takes it out of any. */
		if (act === "workspace") {
			const workspace = ((req.body ?? {}) as { workspace?: unknown }).workspace;
			if (workspace === null || workspace === "") agent.clearWorkspace();
			else if (typeof workspace === "string") agent.setWorkspace(workspace.trim());
			else {
				res.status(400).json({ error: "A workspace is a name, or null for none." });
				return;
			}
			app.agents.publish();
			res.json({ id: agent.id, workspace: agent.workspace ?? null });
			return;
		}
		/** The answer to a question the agent asked (`/login`'s method and code, a choice, a confirm). */
		if (act === "dialog") {
			const answer = (req.body ?? {}) as ExtensionUiAnswer;
			if (typeof answer?.id !== "string") {
				res.status(400).json({ error: "An answer names the question it answers." });
				return;
			}
			agent.answerDialog(answer);
			res.json({ answered: answer.id });
			return;
		}
		if (act === "rename") {
			const name = String(((req.body ?? {}) as { name?: unknown }).name ?? "").trim().slice(0, 40);
			if (!name) {
				res.status(400).json({ error: "A name cannot be empty." });
				return;
			}
			if (app.agents.nameTaken(name, agent.id)) {
				res.status(409).json({ error: `Another agent is already called ${name}.` });
				return;
			}
			agent.rename(name);
			res.json({ id: agent.id, name });
			return;
		}
		/*
		 * The person's own queue, as this app's composer works it over the socket (`agent.queue`):
		 * `add` a message for when the turn ends, `remove` one, `send` one now (it steers the turn),
		 * `release` what Stop held. The new queue comes back, and as `agent.queued` on the events.
		 */
		if (act === "queue") {
			const body = (req.body ?? {}) as { action?: unknown; text?: unknown; item?: unknown };
			const { action, text, item } = body;
			if (action === "add" && typeof text === "string" && text.trim()) agent.queueMine(text);
			else if (action === "remove" && typeof item === "string") agent.unqueueMine(item);
			else if (action === "send" && typeof item === "string") agent.sendMineNow(item);
			else if (action === "release") agent.releaseMine();
			else {
				res.status(400).json({ error: "Say what to do with the queue: add (with text), remove or send (with item), or release." });
				return;
			}
			agent.sayRow();
			res.json({ id: agent.id, ...agent.queuedMine() });
			return;
		}
		if (act === "stop") {
			void agent.abort();
			res.json({ id: agent.id, stopped: true });
			return;
		}
		if (act === "remove") {
			const outcome = app.agents.remove(agent.id);
			if (!outcome.removed) {
				res.status(409).json({ error: outcome.reason ?? "That agent cannot be removed." });
				return;
			}
			res.json({ id: agent.id, removed: true });
			return;
		}
		const body = (req.body ?? {}) as { provider?: unknown; model?: unknown; thinking?: unknown; id?: unknown; mode?: unknown };
		const level = THINKING_LEVELS.find((one) => one === body.thinking) as ThinkingLevel | undefined;
		// The model, with the level the picker kept for it; the thinking level alone; the subscription it spends.
		if (act === "model") {
			if (typeof body.provider !== "string" || typeof body.model !== "string") {
				res.status(400).json({ error: "Say which provider and model." });
				return;
			}
			agent.setModel(body.provider, body.model, level).then(
				() => res.json({ id: agent.id, model: agent.model ?? null }),
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		if (act === "thinking") {
			if (!level) {
				res.status(400).json({ error: `A thinking level is one of ${THINKING_LEVELS.join(", ")}.` });
				return;
			}
			agent.setThinking(level).then(
				() => res.json({ id: agent.id, model: agent.model ?? null }),
				(error: unknown) => res.status(400).json({ error: `Could not change the thinking level: ${(error as Error).message}` }),
			);
			return;
		}
		if (act === "mode") {
			const modes = app.runtimes().find((runtime) => runtime.kind === agent.kind)?.capabilities.modes ?? [];
			const mode = modes.find((one) => one === body.mode);
			if (!mode) {
				res.status(400).json({ error: modes.length ? `A mode here is one of ${modes.join(", ")}.` : "This agent's runtime has no modes." });
				return;
			}
			agent.setMode(mode).then(
				() => {
					app.agents.publish();
					res.json({ id: agent.id, mode: agent.mode ?? mode });
				},
				(error: unknown) => res.status(400).json({ error: `Could not change mode: ${(error as Error).message}` }),
			);
			return;
		}
		if (act === "account") {
			if (agent.kind !== "claude" || typeof body.id !== "string" || !agent.useAccount(body.id)) {
				res.status(409).json({ error: "That account is not on the list, or this agent has no Claude account." });
				return;
			}
			// The runtime starts, so the subscription is in force at once (`wire/accounts.ts`).
			void agent.start();
			void app.publishAccounts();
			res.json({ id: agent.id, account: body.id });
			return;
		}
		res.status(404).json({ error: "An agent can be renamed, stopped, removed, or given a model, a thinking level, a mode or an account." });
	});

	/**
	 * Pass another server through this one, for a page with no service worker (`share/relay.ts`).
	 * The page names the connection and its token; `/c/<id>/...` below is then that server's.
	 */
	api.post("/relay", (req, res) => {
		const body = (req.body ?? {}) as { id?: unknown; base?: unknown; token?: unknown };
		const refused = typeof body.id === "string" && typeof body.base === "string" && typeof body.token === "string" ? relay.register(body.id, body.base, body.token) : "Name the connection, its address and its token.";
		if (refused) {
			res.status(400).json({ error: refused });
			return;
		}
		res.json({ ok: true });
	});

	api.get("/deck", (_req, res) => {
		res.json({ deck: app.deck.state(), warnings: app.deck.warnings });
	});

	/**
	 * A board, for the frame it renders in — same origin, no sandbox (§4).
	 *
	 * Path-shaped rather than a query parameter so a board's own relative
	 * references resolve: `../lib/board.css` beside a board asks for the sibling
	 * URL and lands back here, on the same guard.
	 */
	api.get(
		"/board/*path",
		asyncRoute(async (req, res) => {
			// A card's folder at a version (`cards/sales@<rev>/`, `@decks/board-host`) is the folder.
			const asked = unstampCard(wildcard(req));
			// A canvas's `lib/`, and the deck's `assets/`, `docs/` and `apps/` beside its boards (`deck/layout.ts`).
			const served = servedAs(asked);
			if ("refused" in served) throw new PathRefused(asked, served.refused);
			let requested = served.path;
			/*
			 * A card's scripts, each at its own address beside the card (`sales.html.m0.js`), so its relative
			 * imports resolve from its folder (`boards/cards.ts`). A friend's card runs none: the stage cleans
			 * them out, and none is served either.
			 */
			const cardModule = /^(.+\.html?)\.m(\d+)\.js$/i.exec(requested);
			if (cardModule && isCardPath(cardModule[1]!)) {
				const file = resolveServed(app.deck.path, cardModule[1]!);
				if (!existsSync(file) || !statSync(file).isFile()) throw new NotFound(requested);
				if (isSharedCanvas(canvasOfPath(asked)?.name ?? "")) throw new PathRefused(requested, "a card shared with you runs no scripts");
				const source = cardModules(await readFile(file, "utf8"))[Number(cardModule[2])];
				if (source === undefined) throw new NotFound(requested, "the card has no such script");
				boardHeaders(res);
				res.setHeader("Cache-Control", "no-cache");
				res.type("text/javascript").send(source);
				return;
			}
			// The runtime at a versioned address (`deck/lib-version.ts`): the file is the one in `lib/`.
			const versioned = requested.startsWith("lib/") ? splitLibVersion(requested.slice(4)) : undefined;
			if (versioned) requested = `lib/${versioned.file}`;
			const target = resolveServed(app.deck.path, requested);
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(requested);
			// A friend's canvas: every page and file of it sandboxed, whatever frame it is in.
			if (isSharedCanvas(canvasOfPath(asked)?.name ?? "")) sharedHeaders(res);
			/*
			 * This route serves the whole deck, not only its boards — a board's own
			 * `../assets/photo.png` and `../lib/board.css` resolve to sibling URLs and
			 * land here. A *board* is what gets the app's origin (§4); everything else
			 * gets the asset treatment, which sandboxes anything a browser would run.
			 * That distinction started mattering the day the user could drop an HTML
			 * file onto a board and have it stored in `assets/`.
			 */
			if (isBoardPath(requested)) boardHeaders(res);
			else assetHeaders(res, target);
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);

			/*
			 * A board that is not a document gets one made for it.
			 *
			 * Two kinds of file need that, and `board.shell` names which: a `.md` is content
			 * rather than a document, and an HTML page from somewhere else has to be wrapped
			 * so it can be put in a *sandboxed* frame. Everything this app writes — a
			 * component board, a flow board, an HTML deck — is already a document and falls
			 * straight through to the file.
			 *
			 * The board record is what decides, because it already knows the format, the size
			 * and the title; re-deriving them here would be a second opinion that can differ
			 * from the one the canvas laid the board out with.
			 *
			 * Anything the deck knows nothing about — an asset, `lib/board.css` — falls
			 * through as well, which is what every non-board request is.
			 */
			/*
			 * `?raw=1` is the shell asking for the file it wraps.
			 *
			 * Without it the shell — which is served at this very URL — would be what its
			 * own embed fetched, and the board would render empty with nothing in any log to
			 * say why. One query parameter rather than a second route, so the reference in
			 * the shell stays *relative* and a nested board resolves its own sibling.
			 */
			const board = req.query.raw === undefined ? app.deck.board(normalizeBoardPath(requested)) : undefined;
			// A card opened by itself, or pictured: the piece in a page of its own (`boards/cards.ts`).
			if (req.query.raw === undefined && isCardPath(requested)) {
				const shared = isSharedCanvas(canvasOfPath(asked)?.name ?? "");
				const mapFile = resolveServed(app.deck.path, "assets/importmap.json");
				const deckImports = readDeckImports(existsSync(mapFile) ? await readFile(mapFile, "utf8") : undefined, "../../assets/");
				const page = cardPage({ path: requested, source: await readFile(target, "utf8"), title: board?.title ?? requested, w: board?.w ?? 600, shared, deckImports });
				res.type("html").send(versionLibRefs(page, libVersion(app.deck.path)));
				return;
			}
			// A board that has to be rendered *into* a document: a `.md`, or a page
			// from somewhere else (`deck/kinds.ts`).
			if (board?.shell) {
				res.type("html").send(
					versionLibRefs(renderShell({
						path: board.path,
						shell: board.shell,
						title: board.title,
						w: board.w,
						h: board.h,
					}), libVersion(app.deck.path)),
				);
				return;
			}
			// A board's page, with its runtime at the versioned address; the file itself is untouched,
			// and `?raw=1` (its text, for the editor) is the file as it is.
			if (req.query.raw === undefined && isBoardPath(requested) && /\.html?$/i.test(requested)) {
				let page = versionLibRefs(await readFile(target, "utf8"), libVersion(app.deck.path));
				// A friend's board has no storage of its own: the shim keeps it in the page around (`lib/storage-shim.js`).
				const shared = canvasOfPath(asked);
				if (shared && isSharedCanvas(shared.name)) page = withScript(page, `${"../".repeat(shared.rest.split("/").length - 1)}lib/storage-shim.js`);
				/*
				 * The canvas's bridge beside the board's own `board.js`: the editor hands a board's page the
				 * pointer only once it has said it is a guest (`plain-board.tsx`), as Studio's pages do, so
				 * without it no board here could be used, only selected.
				 */
				const own = /<script[^>]*\ssrc="([^"]*?)board\.js"/i.exec(page);
				if (own) page = withGuest(page, `${own[1]}embed-guest.js`);
				res.type("html").send(page);
				return;
			}
			/*
			 * `?guest=1` is a board that is this web page (`data-bare`, `renderFileBoard`) asking for it
			 * with `lib/embed-guest.js` in it: the page then takes the scrolls it can use and hands the
			 * rest, and every pinch, to the canvas, as a board's own page does, with no click first.
			 * Still the asset's headers, so still sandboxed; the script is ours and reads nothing back.
			 */
			if (req.query.guest !== undefined && !isBoardPath(requested) && /\.html?$/i.test(requested)) {
				res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(asked.split("/").length - 1)}lib/embed-guest.js`));
				return;
			}
			await sendFile(res, target);
		}),
	);

	/** How far the server has got keeping a picture of every board (`ThumbService.index`), for the ⋯ menu. */
	api.get("/pictures", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.thumbs.progress());
	});

	/**
	 * A picture of a board, for the panel's thumbnails (`boards/thumbs.ts`).
	 *
	 * The answer waits for the picture: an `<img>` has no way to be told "later", and a
	 * request that is held is what lets the newest-first queue know who is still looking.
	 * `v` is the revision the browser knows, and it is only there to make the URL a new one
	 * when the board changes, which is what allows the year of caching: the picture served is
	 * always of the board as it is now. 503 when there is no Chromium here, 404 for no such
	 * board; the gallery draws its plain tile for either.
	 */
	api.get(
		"/thumb/*path",
		asyncRoute(async (req, res) => {
			const board = app.deck.board(normalizeBoardPath(wildcard(req)));
			if (!board) {
				res.status(404).end();
				return;
			}
			let gone = false;
			res.on("close", () => (gone = !res.writableEnded));
			try {
				const scheme = req.query.scheme === "dark" ? "dark" : "light";
				const kind = req.query.whole === "1" ? "whole" : "card";
				// A smaller copy of a whole picture, for a canvas zoomed out (`SMALL_WIDTHS`).
				const width = Number(req.query.w);
				const small = kind === "whole" && SMALL_WIDTHS.includes(width) ? width : undefined;
				const send = async (file: string) => {
					res.type(file.endsWith(".webp") ? "webp" : "jpeg");
					await sendFile(res, file);
				};
				if (kind === "card") {
					const file = await app.thumbs.get(board, scheme, () => gone, kind);
					if (gone) return;
					res.setHeader("Cache-Control", req.query.v === String(board.rev) ? "private, max-age=31536000, immutable" : "no-cache");
					await send(file);
					return;
				}
				/*
				 * A board's picture for the canvas: the one asked for when it is on disk; otherwise
				 * whatever the board has that is nearest (another size, an earlier revision) at once,
				 * not cached and said to be a stand-in so the canvas asks again (`pen/scene.ts`), with
				 * the one asked for made ahead of the background's work. Only a board with no picture at
				 * all waits. Not for a gallery card: an `<img>` would keep the stand-in.
				 */
				const size = small ?? "whole";
				app.thumbs.asked(scheme, "whole");
				const near = app.thumbs.nearest(board, scheme, size);
				if (near && !near.exact) {
					app.thumbs.picture(board, scheme, size).catch(() => {});
					res.setHeader("Cache-Control", "no-store");
					res.setHeader("X-Decks-Stand-In", "1");
					await send(near.file);
					return;
				}
				const file = near?.file ?? (await app.thumbs.picture(board, scheme, size, () => gone));
				if (gone) return;
				res.setHeader("Cache-Control", req.query.v === String(board.rev) ? "private, max-age=31536000, immutable" : "no-cache");
				// Compressed for the GPU, when the canvas takes it (`astc=1`) and this machine can make it; else the WebP.
				const packed = req.query.astc === "1" && small !== undefined ? await app.thumbs.compressed(file) : undefined;
				if (gone) return;
				if (packed) {
					res.type("application/vnd.decks.astc");
					await sendFile(res, packed);
					return;
				}
				await send(file);
			} catch (error) {
				if (!gone) res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * A picture of a whole stage, for the manager's cards (`stage/shots.ts`).
	 *
	 * The board thumbnails' bargain, one level up: the request waits for the picture because an
	 * `<img>` cannot be told "later", `v` is the drawing's revision and is what makes the URL new
	 * when the stage changes, and a year of caching is safe because of it. 503 when this machine
	 * has no Chromium, 404 for no such stage; the card draws its plain tile for either.
	 */
	api.get(
		"/stage-thumb/:name",
		asyncRoute(async (req, res) => {
			const shots = app.stage.shots;
			const pens = app.stage.pens;
			const name = String(req.params.name ?? "");
			if (!shots || !pens || !pens.names().includes(name)) {
				res.status(404).end();
				return;
			}
			const scheme = req.query.scheme === "dark" ? "dark" : "light";
			const { rev } = pens.summary(name);
			try {
				const file = await shots.thumb(name, rev, scheme);
				res.setHeader("Cache-Control", req.query.v === String(rev) ? "private, max-age=31536000, immutable" : "no-cache");
				res.type("jpeg");
				await sendFile(res, file);
			} catch (error) {
				res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * A canvas as one `.decks` file, to download and open in any Decks (`share/bundle.ts`).
	 *
	 * Pictures already taken go in as they are; one not taken yet gets the time left of a shared
	 * minute, and a board without one is drawn from its page when the reader opens it.
	 */
	api.get(
		"/bundle/:name",
		asyncRoute(async (req, res) => {
			const pens = app.stage.pens;
			const name = String(req.params.name ?? "");
			if (!pens || !pens.names().includes(name)) {
				res.status(404).type("text").send("No such canvas.");
				return;
			}
			const frame = pens.frame("", name) as Extract<ServerMessage, { type: "stage.pen" }>;
			const until = Date.now() + 60_000;
			const { bytes } = await buildBundle({
				deckPath: app.deck.path,
				deckName: app.deck.name,
				board: (path) => app.deck.board(path),
				stage: { dir: pens.folderOf(name), title: pens.titleOf(name), rev: frame.rev, doc: frame.doc, boards: pens.boards(name) },
				picture: async (board, scheme) => {
					const near = app.thumbs.nearest(board, scheme, "whole");
					if (near) return near.file;
					const left = until - Date.now();
					if (left <= 0) return undefined;
					return Promise.race([app.thumbs.get(board, scheme, () => false, "whole"), new Promise<undefined>((done) => setTimeout(() => done(undefined), left))]).catch(() => undefined);
				},
			});
			const file = bundleFileName(pens.titleOf(name));
			res.setHeader("Content-Disposition", `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(file)}`);
			res.setHeader("Cache-Control", "no-store");
			res.type("application/zip").send(bytes);
		}),
	);

	/**
	 * One stage, for `shot.html` to draw (`stage/shots.ts`): its `.pen` document, the folder its
	 * image fills are read against, and where each board on it is.
	 */
	api.get("/stage-pen/:name", (req, res) => {
		const pens = app.stage.pens;
		const name = String(req.params.name ?? "");
		if (!pens || !pens.names().includes(name)) {
			res.status(404).end();
			return;
		}
		const frame = pens.frame("", name) as { doc: unknown; base: string; rev: number; by?: string };
		res.setHeader("Cache-Control", "no-store");
		/*
		 * Each card and board on it with its record (title, revision, card or not, who wrote it and when,
		 * when it was read), at its place on this drawing: what the canvas frame shows them from.
		 */
		const cards = pens.boards(name).flatMap(({ path, x, y, w, h }) => {
			const board = app.deck.board(path);
			return board ? [{ ...board, x, y, w, h }] : [];
		});
		res.json({ doc: frame.doc, base: frame.base, rev: frame.rev, ...(frame.by ? { by: frame.by } : {}), boards: pens.boards(name).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })), cards });
	});

	/**
	 * Any .pen file as `shot.html` draws it: a saved frame, or a stage by its file. `path` is relative
	 * to the deck or absolute (`StagePens.penFile`).
	 */
	api.get("/pen-file", (req, res) => {
		const pens = app.stage.pens;
		if (!pens || typeof req.query.path !== "string") {
			res.status(404).end();
			return;
		}
		try {
			const frame = pens.fileFrame(req.query.path);
			const boards = frame.stage ? pens.boards(frame.stage).map(({ path, x, y, w, h }) => ({ path, x, y, w, h })) : [];
			res.setHeader("Cache-Control", "no-store");
			res.json({ doc: frame.doc, base: frame.base, boards });
		} catch (error) {
			res.status(404).type("text").send((error as Error).message);
		}
	});

	/**
	 * A picture of what is selected on an agent's stage, to download: the drawing's Export
	 * button. `of` is a comma-separated list of item ids, or nothing for the whole stage; `box` is
	 * `x1,y1,x2,y2` on the stage instead, `scale` the pixels per CSS pixel (2 by default), and
	 * `live=1` takes it in the browser with live boards. The box taken is answered in `X-Shot-Box`,
	 * and how it was taken (`native`, or `chromium: why`) in `X-Shot-How`.
	 */
	api.get(
		"/stage-shot",
		asyncRoute(async (req, res) => {
			const shots = app.stage.shots;
			const agent = app.agents.get(String(req.query.agent ?? ""));
			const stage = agent?.stageName(false);
			if (!shots || !stage) {
				res.status(404).type("text").send("That agent has no stage to picture.");
				return;
			}
			const box = typeof req.query.box === "string" ? req.query.box.split(",").map(Number) : undefined;
			const of = box ? { x1: box[0], y1: box[1], x2: box[2], y2: box[3] } : typeof req.query.of === "string" && req.query.of ? req.query.of.split(",") : undefined;
			const format = req.query.format === "jpeg" || req.query.format === "pdf" ? req.query.format : "png";
			const scale = typeof req.query.scale === "string" && Number.isFinite(Number(req.query.scale)) ? Number(req.query.scale) : 2;
			const live = req.query.live === "1" || req.query.live === "true";
			try {
				const shot = await shots.take({ stage, of, format, scale, scheme: req.query.scheme === "dark" ? "dark" : "light", ...(live ? { live } : {}) });
				res.setHeader("X-Shot-Box", JSON.stringify(shot.box));
				res.setHeader("X-Shot-How", encodeURIComponent(shot.how));
				res.setHeader("Content-Disposition", `attachment; filename="${stage}.${format === "jpeg" ? "jpg" : format}"`);
				res.type(format === "pdf" ? "application/pdf" : format === "jpeg" ? "jpeg" : "png");
				res.send(shot.bytes);
			} catch (error) {
				res.status(503).type("text").send((error as Error).message);
			}
		}),
	);

	/**
	 * The board primitives, reachable from a document not served under `/board`.
	 *
	 * A revision preview is served at `/api/revision/<sha>`, so the `../lib/board.css` in
	 * its own markup resolves to `/api/lib/board.css` — not to `/api/board/lib/board.css`,
	 * where the deck's copy lives. Without this alias a previewed board arrived as unstyled
	 * HTML with `board.js` missing, so the time machine looked like it worked (the text was
	 * right) while showing nothing like the board it was previewing.
	 */
	api.get(
		"/lib/*path",
		asyncRoute(async (req, res) => {
			const versioned = splitLibVersion(wildcard(req));
			const target = resolveServed(app.deck.path, join("lib", versioned?.file ?? wildcard(req)));
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(wildcard(req));
			boardHeaders(res);
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);
			await sendFile(res, target);
		}),
	);

	/**
	 * A file from outside the deck — asked for by path, answered with a redirect.
	 *
	 * The redirect is the interesting part. A browser deletes `..` segments from a
	 * URL path before the request is sent (and treats `%2e%2e` the same way), so a
	 * relative path cannot survive the trip inside the URL — it arrives here in a
	 * query parameter instead, where nothing rewrites it, and leaves as the
	 * absolute path it resolved to. From then on the URL is path-shaped, which is
	 * what makes a foreign page's own relative references land back on this guard.
	 *
	 * `from` is the board that asked, so a relative path means what it would mean
	 * in an `<img src>` on that board.
	 */
	api.get("/file", (req, res) => {
		const path = typeof req.query.path === "string" ? req.query.path : "";
		const from = typeof req.query.from === "string" ? req.query.from : undefined;
		const target = resolveFileRequest(app.deck.roots, { path, from });
		if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(path);
		// 302 rather than 301: which file a relative path resolves to depends on the
		// deck that is open, and that changes. A board that is the page asks for the bridge, and still does there.
		res.redirect(302, `${fileUrl(target)}${req.query.guest === undefined ? "" : "?guest=1"}`);
	});

	/** The resolved file itself, at its absolute path — read-only and quarantined (§4). */
	api.get(
		"/f/*path",
		asyncRoute(async (req, res) => {
			const requested = `/${wildcard(req)}`;
			const target = resolveFileRequest(app.deck.roots, { path: requested });
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(requested);
			quarantine(res, target);
			// A web page outside the deck that is its board, with the bridge in it, as one inside the deck gets (`/board/*path`).
			if (req.query.guest !== undefined && /\.html?$/i.test(target)) {
				res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(requested.split("/").length - 1)}board/lib/embed-guest.js`));
				return;
			}
			await sendFile(res, target);
		}),
	);

	/**
	 * An agent's avatar, which the agent drew itself (§6.2).
	 *
	 * Stored under the deck's `.decks/` so it travels with the deck, and served with
	 * the quarantine headers: it is an SVG, and an SVG is a scriptable document to a
	 * browser even when it is only ever going to be an <img>.
	 */
	api.get(
		"/avatar/:id",
		asyncRoute(async (req, res) => {
			const id = String(req.params.id).replace(/[^\w-]/g, "");
			const target = resolveInDeck(app.deck.path, join(".decks", "avatars", `${id}.svg`));
			if (!existsSync(target)) throw new NotFound(id, "no avatar for that agent");
			quarantine(res, target);
			await sendFile(res, target);
		}),
	);

	/**
	 * One past version of a board, by content hash (§6.7).
	 *
	 * This is what lets the timeline show what a board looked like at a point in the
	 * conversation without writing anything: the frame loads a revision instead of
	 * the file. Same quarantine headers as any other stored document.
	 */
	api.get(
		"/revision/:sha",
		asyncRoute(async (req, res) => {
			const sha = String(req.params.sha);
			if (!app.boards.revisions.has(sha)) throw new PathRefused(sha, "no such revision");
			res.setHeader("X-Content-Type-Options", "nosniff");
			// Immutable by construction: the name is the hash of the contents.
			res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
			res.type("html").send(app.boards.revisions.read(sha));
		}),
	);

	/**
	 * Where a file the picker named sits in the deck, and, for a film or a sound, what it is: the
	 * same `media` an upload answers with, its poster written beside it once. For placing a picked
	 * file on the canvas, which refers to deck files by their deck path and copies nothing. The picker
	 * names deck files by their full path; a file outside the deck answers `inDeck: false`.
	 */
	api.get(
		"/where",
		asyncRoute(async (req, res) => {
			const asked = typeof req.query.path === "string" ? req.query.path : "";
			const root = resolve(app.deck.path);
			const full = resolve(root, asked);
			if (!asked || (full !== root && !full.startsWith(root + sep)) || !existsSync(full) || !statSync(full).isFile()) {
				res.json({ inDeck: false });
				return;
			}
			const path = relative(root, full).split(sep).join("/");
			// Only what is named as a film or a sound is asked of ffmpeg, which reads a still picture as a one-frame film.
			const playable = /\.(mp4|m4v|webm|mov|ogv|mkv|mp3|m4a|aac|wav|flac|ogg|oga|opus|weba)$/i.test(path);
			const asset = playable ? await withMedia(root, { path, name: basename(full), bytes: statSync(full).size, reused: true }) : undefined;
			// A PDF, an SVG or a web page: a picture of it for its card (`files/preview.ts`).
			const preview = previewKind(path) ? await filePreview(root, path) : undefined;
			res.json({ inDeck: true, path, ...(asset?.media ? { media: asset.media } : {}), ...(preview ? { preview } : {}) });
		}),
	);

	api.get("/browse", (req, res) => {
		const path = typeof req.query.path === "string" && req.query.path.length > 0 ? req.query.path : undefined;
		res.json(browse(app.deck.roots, path));
	});

	/**
	 * A file the user dropped onto a board, copied into the deck's `assets/` (§3), or with
	 * `canvas`, into that canvas's own `files/`.
	 *
	 * One file per request, its bytes as the body and its name in the query. Not
	 * `multipart/form-data`: a raw body needs no parser and therefore no parser
	 * dependency, and one request per file is what lets the browser report progress
	 * per file and land each one as its own component.
	 *
	 * `express.raw` is where the cap is enforced, and it enforces it twice — it
	 * refuses on `Content-Length` before reading anything, and again on the stream
	 * for a chunked body that lied. Either way the answer is a 413 with a sentence,
	 * not a truncated file.
	 */
	/**
	 * A board or card drawn from a snapshot of the reader's page (`boards/snapshot.ts`): the page's markup
	 * as it stood, drawn by the server's Chrome at its own address. The answer is the picture. A card's
	 * comes from the canvas frame showing it (`packages/canvas/src/items/card-snapshot.ts`).
	 */
	api.post(
		"/snapshot",
		express.text({ type: () => true, limit: "24mb" }),
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, a paired front end's (Studio), or a canvas frame's for a card on its canvas.
			const principal = req.principal;
			if (!actsAsPerson(principal) && principal?.kind !== "canvas") throw new UploadRefused("Only the person, a front end paired with this harness, or a canvas frame sends this.", 403);
			const path = normalizeBoardPath(typeof req.query.path === "string" ? req.query.path : "");
			if (!app.deck.board(path)) {
				res.status(404).type("text").send("No such board.");
				return;
			}
			if (principal?.kind === "canvas" && !boardOnCanvas(app, path, principal.canvas)) throw new UploadRefused(`${path} is not on this canvas.`, 403);
			const shot = await renderSnapshot(app.thumbs, `http://127.0.0.1:${req.socket.localPort}`, {
				path,
				html: typeof req.body === "string" ? req.body : "",
				w: Number(req.query.w) || 1000,
				h: Number(req.query.h) || 700,
				scheme: req.query.scheme === "dark" ? "dark" : "light",
			});
			res.setHeader("Cache-Control", "no-store");
			res.type(pictureType(shot)).send(shot);
		}),
	);

	/*
	 * Speech to text for the composer's mic (`stt.ts`): whether this server can, and a recording's words.
	 * The recording is the body, as an upload's file is, and nothing of it is kept.
	 */
	api.get("/stt", (_req, res) => {
		res.json({ server: sttReady() });
	});
	api.post(
		"/stt",
		express.raw({ type: () => true, limit: "25mb" }),
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, or a paired front end's (Studio).
			if (!actsAsPerson(req.principal)) throw new UploadRefused("Only the person, or a front end paired with this harness, sends this.", 403);
			if (!sttReady()) {
				res.status(503).json({ error: "No speech recogniser on this server." });
				return;
			}
			const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
			if (audio.length === 0) {
				res.status(400).json({ error: "No recording was sent." });
				return;
			}
			try {
				// The model chosen in Settings, or the default (`stt.ts`).
				res.json({ text: await transcribe(audio, String(req.headers["content-type"] ?? "audio/webm"), app.settings.get().sttModel) });
			} catch (error) {
				res.status(502).json({ error: (error as Error).message });
			}
		}),
	);

	api.post(
		"/upload",
		asyncRoute(async (req, res) => {
			// The person's, in a Decks tab or a terminal, or a paired front end's (Studio).
			if (!actsAsPerson(req.principal)) throw new UploadRefused("Only the person, or a front end paired with this harness, sends this.", 403);
			// Refused on the declared length before a byte is read; the stream enforces it again for a body that lied.
			const declared = Number(req.headers["content-length"] ?? 0);
			if (declared > MAX_UPLOAD_BYTES) throw new UploadRefused(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`, 413);
			const name = typeof req.query.name === "string" ? req.query.name : "";
			/*
			 * Dropped on a canvas, it goes into that canvas's own files/ (`deck/layout.ts`), so the canvas
			 * stands alone, and a friend's canvas you may edit takes it in its folder, which syncs back to
			 * them. A canvas shared with you to view takes nothing: its owner's copy is the one there is.
			 */
			const canvas = typeof req.query.canvas === "string" && req.query.canvas ? req.query.canvas : undefined;
			let into: { folder: string; ref: string } | undefined;
			if (canvas) {
				const pens = app.stage.pens;
				if (!pens || !canvasNameOk(canvas) || !pens.has(canvas)) throw new UploadRefused(`There is no canvas ${canvas} to put the file in.`, 404);
				try {
					pens.mayWrite(canvas);
				} catch (error) {
					throw new UploadRefused((error as Error).message, 403);
				}
				into = { folder: `${canvasFolder(canvas)}/files`, ref: "files" };
			}
			res.json(await storeAssetStream(app.deck.path, name, req, into));
		}),
	);

	/*
	 * Google Docs (`google/`): signing in as the person, the pictures in a Doc's page, and the
	 * agents' Google Docs tools. The sign-in is started by the page with its own origin, since
	 * behind a proxy this server cannot tell what address the browser used to reach it.
	 */
	api.get("/google/status", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.google.state());
	});
	api.get("/google/signin", (req, res) => {
		const origin = typeof req.query.origin === "string" && /^https?:\/\/[^/\s]+$/.test(req.query.origin) ? req.query.origin : `${req.protocol}://${req.get("host")}`;
		try {
			res.redirect(302, app.google.auth.signInUrl(origin));
		} catch (error) {
			res.status(400).type("text/plain").send((error as Error).message);
		}
	});
	const signedIn = (res: Response, said: string, ok: boolean) =>
		res
			.status(ok ? 200 : 400)
			.type("html")
			.send(`<!doctype html><meta charset="utf-8"><title>Google</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;line-height:1.5"><h1 style="font-size:22px">${ok ? "Signed in" : "Not signed in"}</h1><p>${said.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</p><p>You can close this tab and go back to Decks.</p></body>`);
	api.get(
		"/google/callback",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ code: String(req.query.code ?? ""), state: String(req.query.state ?? ""), ...(req.query.error ? { url: `http://x/?error=${String(req.query.error)}` } : {}) });
				signedIn(res, `Decks can now read and edit the Google Docs ${email} can.`, true);
			} catch (error) {
				signedIn(res, (error as Error).message, false);
			}
		}),
	);
	api.post(
		"/google/code",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ url: String((req.body as { url?: unknown })?.url ?? "") });
				res.json({ ok: true, email });
			} catch (error) {
				res.json({ ok: false, message: (error as Error).message });
			}
		}),
	);
	/** The person's Google Docs for the file picker, the ones they looked at last first; `q` narrows them by name. */
	api.get(
		"/google/docs",
		asyncRoute(async (req, res) => {
			res.setHeader("Cache-Control", "no-store");
			if (!app.google.state().signedIn) {
				res.status(401).json({ error: "Not signed in to Google." });
				return;
			}
			try {
				res.json({ docs: await app.google.api().list(typeof req.query.q === "string" ? req.query.q : undefined) });
			} catch (error) {
				res.status(502).json({ error: (error as Error).message });
			}
		}),
	);
	api.post("/google/signout", (_req, res) => {
		app.google.auth.signOut();
		res.json({ ok: true });
	});
	api.get(
		"/google/image/:doc/:object",
		asyncRoute(async (req, res) => {
			const doc = await app.google.api().get(String(req.params.doc)).catch(() => undefined);
			const uri = doc?.inlineObjects?.[String(req.params.object)]?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
			const fetched = uri ? await fetch(uri).catch(() => undefined) : undefined;
			if (!fetched?.ok) {
				res.status(404).end();
				return;
			}
			res.setHeader("Content-Type", fetched.headers.get("content-type") ?? "image/png");
			res.setHeader("Cache-Control", "private, max-age=600");
			res.end(Buffer.from(await fetched.arrayBuffer()));
		}),
	);
	/*
	 * The agents' Google Docs tools, for a runtime outside this process (opencode, antigravity),
	 * with the same identity as the canvas tool: a token per agent, or opencode's session id.
	 */
	api.post(
		"/gdocs/call",
		asyncRoute(async (req, res) => {
			const header = req.headers.authorization;
			const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
			const body = (req.body ?? {}) as { tool?: unknown; args?: unknown; sessionID?: unknown };
			const agentId = app.bridge.agentFor(token, typeof body.sessionID === "string" ? body.sessionID : undefined);
			if (!agentId) {
				res.json({ text: "This tool's token is not valid any more. The agent it belonged to has gone.", isError: true });
				return;
			}
			res.json(await app.google.tool(String(body.tool ?? ""), (body.args ?? {}) as Record<string, unknown>, app.agentName(agentId)));
		}),
	);

	/*
	 * The deck's apps (`apps/service.ts`), for the bar on an app's board (`lib/live-app.js`): what
	 * each is doing, its log, that its board is still in view, and the bar's Restart.
	 */
	const appOf = (req: Request, res: Response): string | undefined => {
		const name = String(req.params.name ?? "");
		if (app.apps.exists(name)) return name;
		res.status(404).json({ error: `There is no app called ${name}.` });
		return undefined;
	};
	api.get("/apps", (_req, res) => {
		res.json({ apps: app.apps.list() });
	});
	api.get("/apps/:name", (req, res) => {
		const name = appOf(req, res);
		if (name) res.set("cache-control", "no-store").json(app.apps.state(name));
	});
	api.get("/apps/:name/log", (req, res) => {
		const name = appOf(req, res);
		if (name) res.set("cache-control", "no-store").json({ lines: app.apps.log(name, Number(req.query.tail) || 200) });
	});
	/*
	 * An app's board saying it is on screen, which keeps a server app awake. A read as well as a post:
	 * a board's page has no token (`auth/guard.ts` lets this read in), and a heartbeat is no more than the
	 * request from its frame that would wake the app anyway.
	 */
	const seen = (req: Request, res: Response) => {
		const name = appOf(req, res);
		if (!name) return;
		app.apps.seen(name);
		res.set("cache-control", "no-store").json({ ok: true });
	};
	api.get("/apps/:name/seen", seen);
	api.post("/apps/:name/seen", seen);

	/**
	 * The SDK, for an app's page: `import { decks } from "../../api/sdk/decks.mjs"`. It is one file
	 * with no dependencies (`packages/sdk`), and a server app is told its path on disk instead.
	 */
	api.get("/sdk/decks.mjs", (_req, res) => {
		res.setHeader("Cache-Control", "no-cache");
		res.type("text/javascript").sendFile(SDK_FILE);
	});

	api.post("/apps/:name/restart", async (req, res) => {
		const name = appOf(req, res);
		if (!name) return;
		app.apps.stop(name);
		res.json(await app.apps.run(name, 30_000));
	});

	server.use("/api", api);

	// The built UI, when there is one. In development Vite serves it instead and
	// proxies here, so a missing dist is normal rather than an error.
	const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
	/**
	 * The Decks page itself, with a fresh person token in it for a tab the person opened
	 * (`auth/issue.ts`): a frame or a script's fetch of the same page gets it without. Never stored, so
	 * a later fetch cannot be answered from a cache with the token in it; and alone in its browsing
	 * context group (`Cross-Origin-Opener-Policy`), so a page that opened it in a new window cannot
	 * reach into it.
	 */
	const shell = async (req: Request, res: Response) => {
		const html = await readFile(join(webDist, "index.html"), "utf8");
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
		res.setHeader("Vary", "Sec-Fetch-Dest, Sec-Fetch-Mode");
		res.type("html").send(isTopNavigation(req.headers) ? withSession(html, tabToken(app.tokens)) : html);
	};
	if (existsSync(webDist)) {
		server.get(["/", "/index.html"], (req, res, next) => void shell(req, res).catch(next));
		// Compressed and cached by name first (`static.ts`); anything it passes on is sent plain,
		// with the same cache rule.
		/*
		 * The app's own scripts, styles, fonts and engine are public, and the canvas frame loads them from a
		 * sandboxed page with no origin: a module script, a font and a fetched `.wasm` are read only with
		 * CORS, so they say anyone may. The Decks page itself (`/`) is not among them.
		 */
		server.use((req, res, next) => {
			if ((req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/") && req.path !== "/" && req.path !== "/index.html") res.setHeader("Access-Control-Allow-Origin", "*");
			next();
		});
		server.use(compressedStatic(webDist));
		server.use(
			express.static(webDist, {
				setHeaders: (res, file) => res.setHeader("Cache-Control", cacheControlFor(file.slice(webDist.length).split(sep).join("/"))),
			}),
		);
		server.get("*any", (req, res, next) => void shell(req, res).catch(next));
	}

	// One error handler, because a refusal should read the same wherever it came
	// from: 403 for a path we would not serve, 404 for one that is not there.
	server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		if (error instanceof NotFound) {
			res.status(404).type("text/plain").send(error.message);
			return;
		}
		if (error instanceof PathRefused) {
			res.status(403).type("text/plain").send(error.message);
			return;
		}
		if (error instanceof UploadRefused) {
			res.status(error.status).type("text/plain").send(error.message);
			return;
		}
		// Body-parser's own refusal. Mapped rather than left to fall through, because a
		// file over the cap is a 413 the browser can explain, not a 500 that reads as a
		// crash.
		if ((error as { type?: string }).type === "entity.too.large") {
			res.status(413).type("text/plain").send(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		// A file half sent when the page went away (a frame closed, a picture no longer wanted): nothing to answer.
		if (res.headersSent || /EPIPE|ECONNRESET|aborted/i.test(message)) {
			res.end();
			return;
		}
		const code = /ENOENT/.test(message) ? 404 : 500;
		if (code === 500) console.error("[decks]", error);
		res.status(code).type("text/plain").send(message);
	});

	return server;
}

function sendFile(res: Response, target: string): Promise<void> {
	return new Promise((ok, fail) => {
		res.sendFile(target, { acceptRanges: true, dotfiles: "allow" }, (error) => (error ? fail(error) : ok()));
	});
}


/**
 * A web page with `lib/embed-guest.js` put first in its head, so it takes the scrolls it can use and
 * hands the rest to the canvas. A page that brings its own bridge (it says `decks:embed-ready`) is
 * left as it is: two bridges would hand every scroll up twice.
 */
function withGuest(page: string, src: string): string {
	if (page.includes("decks:embed-ready")) return page;
	return withScript(page, src);
}

/** A page with a script put first in its head, before any of its own. */
function withScript(page: string, src: string): string {
	const tag = `<script src="${src}"></script>`;
	const head = /<head[^>]*>/i.exec(page);
	return head ? `${page.slice(0, head.index + head[0].length)}${tag}${page.slice(head.index + head[0].length)}` : `${tag}${page}`;
}

/** The commit this harness runs, short, read once; "" when it is not a git checkout. */
let version: string | undefined;
function harnessVersion(): string {
	if (version !== undefined) return version;
	try {
		version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.env.DECKS_APP_DIR ?? process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		version = "";
	}
	return version;
}
