import { ALL_VERBS, cardCalls, checkArgs, signature, VERB_BY_NAME } from "@decks/api";
import express, { type Request, type Response } from "express";
import type { App } from "../app.ts";
import { appActor, callerTool, conversationFor } from "../stage/caller-run.ts";
import { fromThisMachine } from "../auth/issue.ts";
import { bearerOf } from "../auth/guard.ts";
import type { Principal } from "../auth/principal.ts";
import { personAgent } from "./person.ts";
import { penEditBy } from "../stage/pens.ts";
import { settleStage } from "../wire/deck.ts";
import type { StageCallResult, StageTool } from "../stage/tool.ts";

/**
 * `/api/v1`: every verb in the table (`@decks/api`) as a route, and the one way in for the SDK in
 * all three of its forms — the TypeScript client, the `decks` command and the MCP server.
 *
 * `POST /api/v1/<verb>` with `{ "args": [...] }` calls the verb for whoever the request names and
 * answers `{ ok, value, notes }`. The arguments are checked against the table before any handler
 * sees them, so a wrong call is answered with the verb's signature rather than a stack trace.
 * `GET /api/v1` lists the verbs, which is what `decks --help` prints, and `GET /api/v1/events`
 * streams every change as it is broadcast.
 *
 * Who is calling is the request's token (`auth/guard.ts`), and nothing else: `req.principal`.
 * The person, in a Decks tab or a terminal, and a paired front end acting for them (Studio) call
 * through the person's tool; they may say what they are acting on, as parameters and not as who
 * they are: `X-Decks-Stage`, the canvas on screen, and `X-Decks-Agent`, the agent they are talking
 * to; `X-Decks-Edit` names an edit to the drawing, which comes back in the `made` of the revision
 * that has it. An agent's token calls as that agent, an app's pass as that app, and a canvas pass as
 * the person on its one canvas. Naming anyone in a header makes nobody them.
 */

/** The answer to one call, as the SDK reads it. */
export interface VerbAnswer extends StageCallResult {}

export function verbRoutes(app: App): express.Router {
	const router = express.Router();
	/** Apps the person let call verbs with "Allow once": remembered until the server restarts. */
	const allowedOnce = new Set<string>();

	router.get("/", (_req, res) => {
		res.set("cache-control", "no-store").json({
			verbs: ALL_VERBS.map((verb) => ({ name: verb.name, group: verb.group, touches: verb.touches, effect: verb.effect, summary: verb.summary, signature: signature(verb), ...(verb.alias ? { alias: verb.alias } : {}) })),
		});
	});

	/**
	 * Every change as it happens, for a client that is not a browser on the socket: the frames Decks
	 * broadcasts (`board.changed`, `stage.pen.delta`, `agent.state`, …), one Server-Sent Event each.
	 * `?types=board.changed,stage.pen.delta` keeps only those. A comment every 25 seconds keeps
	 * proxies from closing a quiet stream.
	 */
	router.get("/events", (req: Request, res: Response) => {
		const wanted = new Set(String(req.query.types ?? "").split(",").map((one) => one.trim()).filter(Boolean));
		// A canvas frame hears its own canvas and nothing else (`onCanvas`), and what was said to it alone (`frame`).
		const own = req.principal?.kind === "canvas" ? req.principal.canvas : undefined;
		const frameId = typeof req.query.frame === "string" ? req.query.frame : undefined;
		/*
		 * A canvas pass is checked on every use, and a stream is used for as long as it is open: before each
		 * message and each beat, so a pass run out, signed out or unshared ends it at once. The frame comes
		 * back on the pass it holds now (`backend.ts`), and reads again what it missed.
		 */
		const pass = own !== undefined ? bearerOf(req.headers) : undefined;
		const still = () => pass === undefined || app.passes.openCanvas(pass)?.canvas === own;
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
		res.write(": decks events\n\n");
		if (own !== undefined) app.canvasFrames += 1;
		const stop = app.listen((message) => {
			if (!still()) {
				res.end();
				return;
			}
			const to = (message as { frameTo?: string }).frameTo;
			if (to !== undefined) {
				if (own === undefined || to !== frameId) return;
				const { frameTo: _to, ...rest } = message as { frameTo?: string };
				res.write(`event: ${message.type}\ndata: ${JSON.stringify(rest)}\n\n`);
				return;
			}
			if (wanted.size && !wanted.has(message.type)) return;
			if (own !== undefined && !onCanvas(app, message, own)) return;
			res.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
		});
		const beat = setInterval(() => (still() ? res.write(": still here\n\n") : res.end()), pass === undefined ? 25_000 : 5_000);
		beat.unref?.();
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			clearInterval(beat);
			if (own !== undefined) app.canvasFrames -= 1;
			stop();
		};
		req.on("close", close);
		res.on("close", close);
	});

	/**
	 * A canvas frame's answer to an agent's `decks view …` on its canvas (`stage.call`, which its stream
	 * carries), as a tab answers on the socket. Only a front end showing the canvas answers one.
	 */
	router.post("/stage-result", (req: Request, res: Response) => {
		const kind = req.principal?.kind;
		if (kind !== "canvas" && kind !== "person" && kind !== "site") {
			res.status(403).json({ ok: false, error: "Only a page showing the canvas answers the canvas's calls." });
			return;
		}
		const result = (req.body ?? {}) as { id?: unknown; value?: unknown; error?: unknown };
		if (typeof result.id !== "string") {
			res.status(400).json({ ok: false, error: "Send { id, value } or { id, error }." });
			return;
		}
		const settled = settleStage(app.pendingStage, { id: result.id, value: result.value, ...(typeof result.error === "string" ? { error: result.error } : {}) });
		res.json({ ok: true, settled });
	});

	/**
	 * What the canvas frame says about a card on its canvas, which a tab says on the socket: that you
	 * read it (`board-seen`) and how it measured (`board-extent`, kept for `decks canvas fit` to report).
	 * Each for a card or board on the caller's own canvas; the person and a paired site may say them for any.
	 */
	const onItsCanvas = (req: Request, res: Response): string | undefined => {
		const path = String((req.body as { path?: unknown } | undefined)?.path ?? "");
		const principal = req.principal;
		if (!path || !app.deck.board(path)) {
			res.status(404).json({ ok: false, error: `There is no card or board at ${path || "that path"}.` });
			return undefined;
		}
		if (principal?.kind === "person" || principal?.kind === "site") return path;
		if (principal?.kind === "canvas" && boardOnCanvas(app, path, principal.canvas)) return path;
		res.status(403).json({ ok: false, error: `${path} is not on this canvas.` });
		return undefined;
	};
	/**
	 * A document item's editor, in the canvas frame (`decks.document`): what it sends, for a file a
	 * document item on the frame's canvas names, and nothing else. The answers go down the frame's own
	 * stream (`frame` in its address), since some come later, as a compile does.
	 */
	router.post("/doc", (req: Request, res: Response) => {
		if (req.principal?.kind !== "canvas") {
			res.status(403).json({ ok: false, error: "A document item's calls are the canvas frame's; a tab sends them on its socket." });
			return;
		}
		const body = (req.body ?? {}) as { frame?: unknown; message?: { type?: unknown; path?: unknown } };
		const message = body.message;
		const frame = typeof body.frame === "string" ? body.frame : "";
		if (!message || typeof message.type !== "string" || !DOC_CALLS.has(message.type) || typeof message.path !== "string" || !frame) {
			res.status(400).json({ ok: false, error: "Send { frame, message }, a document message for a file on this canvas." });
			return;
		}
		if (!app.documentsOn(req.principal.canvas).has(message.path)) {
			res.status(403).json({ ok: false, error: `${message.path} is not a document on this canvas.` });
			return;
		}
		app.docs.handle(message as never, (answer) => app.tellStreams({ ...answer, frameTo: frame } as never));
		res.json({ ok: true });
	});

	router.post("/board-seen", (req: Request, res: Response) => {
		const path = onItsCanvas(req, res);
		if (!path) return;
		app.boards.seen(path);
		res.json({ ok: true });
	});
	router.post("/board-extent", (req: Request, res: Response) => {
		const path = onItsCanvas(req, res);
		if (!path) return;
		const body = req.body as Record<string, unknown>;
		const num = (key: string) => (typeof body[key] === "number" && Number.isFinite(body[key]) ? (body[key] as number) : undefined);
		const rev = num("rev");
		const w = num("w");
		const h = num("h");
		if (rev === undefined || w === undefined || h === undefined) {
			res.status(400).json({ ok: false, error: "Send { path, rev, w, h }, and what else was measured." });
			return;
		}
		const extra: Record<string, number> = {};
		for (const key of ["at", "page", "words", "minFont", "overflowX", "cut", "overlaps"]) {
			const value = num(key);
			if (value !== undefined) extra[key] = value;
		}
		app.boards.noteExtent(path, { rev, w, h, ...extra });
		res.json({ ok: true });
	});
	router.post("/:verb", async (req: Request, res: Response) => {
		const name = String(req.params.verb ?? "");
		const verb = VERB_BY_NAME.get(name);
		if (!verb) {
			res.status(404).json({ ok: false, error: `There is no verb called ${name}. GET /api/v1 lists them.`, notes: [] });
			return;
		}
		const body = (req.body ?? {}) as { args?: unknown };
		const args = body.args === undefined ? [] : body.args;
		if (!Array.isArray(args)) {
			res.status(400).json({ ok: false, error: `Send the arguments as a list: { "args": [...] }. ${signature(verb)}`, notes: [] });
			return;
		}
		if (req.principal?.kind === "canvas") {
			const refused = refusedForCanvas(app, name, Array.isArray(args) ? args : [], req.principal.canvas, req.principal.role);
			if (refused) {
				res.status(403).json({ ok: false, error: refused, notes: [] });
				return;
			}
		}
		const problem = checkArgs(verb, args);
		if (problem) {
			res.status(400).json({ ok: false, error: problem, notes: [] });
			return;
		}

		// A pairing code lets another Decks in, so only someone at the harness's own machine may make one.
		if (name === "pair.code" && !fromThisMachine(req.socket.remoteAddress, req.headers)) {
			res.status(403).json({ ok: false, error: "A pairing code is made only on the harness's own machine: run decks pair code in a shell there.", notes: [] });
			return;
		}
		const caller = await callerOf(app, req, allowedOnce);
		if ("error" in caller) {
			res.status(caller.status).json({ ok: false, error: caller.error, notes: [] });
			return;
		}
		const call = () => caller.tool.call(name, args, caller.on ?? {});
		// The person's name for an edit to the drawing, sent back with the revision that has it (`StagePens`, `penEditBy`).
		const answer = caller.edit ? await penEditBy.run(caller.edit, call) : await call();
		if (caller.announce) caller.announce(name, answer);
		res.status(answer.ok ? 200 : 422).json(answer satisfies VerbAnswer);
	});

	return router;
}

type Caller = { tool: StageTool; announce?: (verb: string, answer: StageCallResult) => void; on?: { stage?: string }; /** The person's name for the edit this call makes (`X-Decks-Edit`). */ edit?: string } | { error: string; status: number };

/** The stage tool a request acts through: the token's principal's (`auth/principal.ts`). */
export async function callerOf(app: App, req: Pick<Request, "headers"> & { principal?: Principal }, allowedOnce: Set<string>): Promise<Caller> {
	const header = (key: string) => {
		const value = req.headers[key];
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	};
	const principal = req.principal;
	switch (principal?.kind) {
		case "person":
		case "site": {
			// The person, clicking in the browser: the canvas on screen and the agent they are talking to.
			const stage = header("x-decks-stage");
			const to = header("x-decks-agent");
			const edit = header("x-decks-edit")?.slice(0, 80);
			const agent = personAgent({ agents: app.agents, pens: app.stage.pens }, { ...(stage ? { stage } : {}), ...(to ? { agent: to } : {}) });
			return { tool: agent.personTool(), on: { ...(stage ? { stage } : {}) }, ...(edit ? { edit } : {}) };
		}
		case "agent": {
			const agent = app.agents.get(principal.id);
			if (!agent) return { status: 401, error: "The agent this token was made for is gone." };
			return { tool: agent.stageTool() };
		}
		case "app":
			return appCaller(app, principal.name, allowedOnce);
		case "canvas":
			return canvasCaller(app, principal, header("x-decks-edit")?.slice(0, 80));
		default:
			return { status: 401, error: "Say who is calling with a token: Authorization: Bearer <token>. An agent's shell and an app's server have DECKS_TOKEN; a terminal gets one with decks login." };
	}
}

/**
 * The calls a canvas frame may make, on its one canvas: reading and changing it, its cards, its
 * frames and files, undo and redo (the verb table's `card: "canvas"`, what a card's call goes to the
 * harness for), and `here` and `now`, which a card's call has answered in the frame. Never another
 * canvas, an agent, an app, the person's tab, or anything that reaches past this canvas; a canvas
 * shared to view reads only.
 */
export const CANVAS_FRAME_VERBS: ReadonlySet<string> = new Set([...cardCalls("canvas"), "here", "now"]);

/** What a document item's editor may send (`@decks/docs`'s `DocClientMessage`). */
const DOC_CALLS = new Set(["doc.open", "doc.close", "doc.patch", "doc.review", "doc.versions", "doc.version", "doc.compile", "doc.restore", "doc.git", "doc.gstyle", "doc.gcomment"]);

/** The items only the person and agents place: a document names a file to open, an app a server to reach. */
const TRUSTED_ITEMS = ["decks.document", "decks.app"];
/** What of a trusted item the canvas frame may still change: where it is and how big. */
const PLACE_ONLY = new Set(["x", "y", "width", "height"]);

/**
 * Whether a canvas frame's call would make a document or an app item, or change what one names: a
 * card's script beside the frame could otherwise name any file to read, or a server to drive. Placing,
 * sizing and deleting one stays the frame's.
 */
function touchesTrustedItems(app: Pick<App, "stage">, verb: string, args: readonly unknown[], canvas: string): boolean {
	if (!["canvas.insert", "canvas.replace", "canvas.update", "canvas.batch", "canvas.copy"].includes(verb)) return false;
	if (TRUSTED_ITEMS.some((tag) => JSON.stringify(args).includes(tag))) return true;
	// The short forms that become one (`{ type: "app", app }`, `{ type: "document", path }`, `verbs/canvas.ts`).
	if (/"type":"(?:app|document)"/.test(JSON.stringify(args))) return true;
	const trusted = new Set<string>();
	try {
		const walk = (nodes: unknown[] | undefined) => {
			for (const node of nodes ?? []) {
				const item = node as { id?: string; type?: string; metadata?: { type?: string }; children?: unknown[] };
				if (item.id && item.type === "browser" && TRUSTED_ITEMS.includes(item.metadata?.type ?? "")) trusted.add(item.id);
				walk(item.children);
			}
		};
		walk((app.stage.pens?.get(canvas).doc as { children?: unknown[] } | undefined)?.children);
	} catch {
		return false;
	}
	if (!trusted.size) return false;
	const ops: Array<{ op?: string; id?: string; set?: Record<string, unknown> }> =
		verb === "canvas.batch" ? ((args[0] as typeof ops | undefined) ?? []) : verb === "canvas.update" ? [{ op: "update", id: String(args[0]), set: (args[1] as { set?: Record<string, unknown> } | undefined)?.set ?? {} }] : verb === "canvas.replace" ? [{ op: "replace", id: String(args[0]) }] : [];
	return ops.some((op) => {
		if (!op.id || !trusted.has(op.id)) return false;
		if (op.op === "replace") return true;
		if (op.op === "update") return Object.keys(op.set ?? {}).some((key) => !PLACE_ONLY.has(key));
		return false;
	});
}

/** Why a canvas frame may not make this call, or undefined when it may. */
export function refusedForCanvas(app: Pick<App, "stage">, verb: string, args: readonly unknown[], canvas: string, role: "edit" | "view"): string | undefined {
	if (!CANVAS_FRAME_VERBS.has(verb)) return `${verb} is not the canvas frame's to call: it reaches past this canvas.`;
	if (role === "view" && VERB_BY_NAME.get(verb)?.effect !== "read") return `${canvas} was shared with you to view, so ${verb} is not yours to call on it.`;
	if (touchesTrustedItems(app, verb, args, canvas)) return "A document or an app item is placed by the person or an agent: the canvas frame may move, size or delete one, not make one or change what it names.";
	const pens = app.stage.pens;
	// A paste's clip names the canvas the items were copied on, which the harness checks itself (`paste.ts`): only where they go is held to this one.
	for (const arg of verb === "canvas.paste" ? args.slice(1) : args) {
		const asked = arg && typeof arg === "object" && !Array.isArray(arg) ? (arg as { canvas?: unknown }).canvas : undefined;
		if (asked === undefined || asked === null || asked === "") continue;
		const raw = String(asked).trim().replace(/^canvases\//, "").replace(/\/canvas(\.pen)?$/, "");
		if (raw !== canvas && pens?.titleOf(canvas).toLowerCase() !== raw.toLowerCase()) return `The canvas frame for ${canvas} acts on that canvas alone, not on ${String(asked)}.`;
	}
	return undefined;
}

/**
 * The canvas frame: the person, on its one canvas. Its calls are the person's own edits (the edit's
 * name comes back in `made`, as a tab's do), made on that canvas whatever the call names, which
 * `refusedForCanvas` has already held to it.
 */
function canvasCaller(app: App, principal: Extract<Principal, { kind: "canvas" }>, edit: string | undefined): Caller {
	const agent = personAgent({ agents: app.agents, pens: app.stage.pens }, { stage: principal.canvas });
	return { tool: agent.personTool(), on: { stage: principal.canvas }, ...(edit ? { edit } : {}) };
}

/**
 * Whether a broadcast is about one canvas: its drawing (`stage.pen`, `stage.pen.delta`, refusals), its
 * cards and boards (`board.changed` for one on it), and what is said to it alone.
 */
export function onCanvas(app: Pick<App, "stage" | "agents" | "documentsOn">, message: { type: string; [key: string]: unknown }, canvas: string): boolean {
	/*
	 * An agent's `decks view …` that moves or marks this canvas, and a picture of a card on it (`shot`):
	 * the frame showing it answers. Showing another canvas stays the page's.
	 */
	// A document's messages, for a file a document item on this canvas names.
	if (message.type.startsWith("doc.")) {
		const path = (message as { path?: unknown }).path;
		return typeof path === "string" && app.documentsOn(canvas).has(path);
	}
	if (message.type === "stage.call") {
		const call = message.call as { op?: string; agentId?: string; args?: { stage?: unknown; path?: unknown } } | undefined;
		if (!call || !["show", "camera", "reload", "cursor", "shot"].includes(call.op ?? "")) return false;
		// A cursor, a reload or a card's picture names a card: the frame showing the canvas it is on answers, whoever's home that is.
		if ((call.op === "cursor" || call.op === "reload" || call.op === "shot") && typeof call.args?.path === "string") return boardOnCanvas(app, call.args.path, canvas);
		if (call.op === "shot") return false;
		const named = typeof call.args?.stage === "string" ? call.args.stage : undefined;
		if (named !== undefined) return named === canvas;
		return !!call.agentId && app.agents.get(call.agentId)?.stageName() === canvas;
	}
	if (message.type === "stage.pen" || message.type === "stage.pen.delta") return message.stage === canvas;
	if (message.type === "board.changed") {
		const board = message.board as { path?: unknown } | undefined;
		const path = typeof board?.path === "string" ? board.path : typeof message.path === "string" ? message.path : undefined;
		if (!path) return false;
		return boardOnCanvas(app, path, canvas);
	}
	return false;
}

/** Whether a card or board is on a canvas: in its folder, or placed on its drawing. */
export function boardOnCanvas(app: Pick<App, "stage">, path: string, canvas: string): boolean {
	if (path.startsWith(`canvases/${canvas}/`)) return true;
	try {
		return !!app.stage.pens?.boards(canvas).some((one) => one.path === path);
	} catch {
		return false;
	}
}

/**
 * An app's calls: once the person has let it, it acts for the conversation on screen, under the
 * app's own name, and each call is noted in that conversation, as an app's stage code always was.
 */
async function appCaller(app: App, name: string, allowedOnce: Set<string>): Promise<Caller> {
	if (!app.apps.exists(name)) return { status: 404, error: `There is no app called ${name}.` };
	// Trusted under `apps/<name>` as it always was, so an "Always allow" given before still holds.
	const key = `apps/${name}`;
	const board = appActor(name);
	if (!app.evalTrust.allows(key) && !allowedOnce.has(key)) {
		const answer = await conversationFor(app, { board }).bridge.choose({
			title: "Let this app use the stage?",
			message: `The app ${name} wants to call stage verbs: write cards, move the canvas, message agents.`,
			options: [
				{ label: "Allow until Decks restarts" },
				{ label: "Always allow this app", description: `Remember ${name}, and stop asking` },
				{ label: "No", description: "Refuse its calls" },
			],
		});
		if (answer === "Always allow this app") app.evalTrust.allow(key);
		else if (answer === "Allow until Decks restarts") allowedOnce.add(key);
		else return { status: 403, error: `The person did not let ${name} use the stage.` };
	}
	const { tool, focused } = callerTool(
		{ agents: app.agents, cameras: app.cameras, boards: app.boards, stage: app.stage, port: app.port },
		{ board, name: `app ${name}`, mayCreate: true },
	);
	return {
		tool,
		announce: (verb, answer) => {
			if (answer.ok) focused.translator.notice("info", `app ${name} called ${verb}`);
			else focused.translator.notice("error", `app ${name} called ${verb} and failed: ${answer.error}`);
		},
	};
}
