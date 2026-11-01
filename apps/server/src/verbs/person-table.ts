import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Op } from "@decks/pen";
import { STT_MODELS, type ServerMessage } from "@decks/protocol";
import { harnessVersion } from "../routes/shared.ts";
import { sttReady } from "../stt.ts";
import type { App } from "../app.ts";
import { cleanParts } from "../agents/message-parts.ts";
import type { DeckAgent } from "../agents/session.ts";
import { joinSpot } from "../deck/place.ts";
import { putOn } from "../stage/canvas-ops.ts";
import { penEditBy } from "../stage/pens.ts";
import { deleteStage, titleCanvas } from "../stage/stage-admin.ts";
import { unpairStudio } from "../studio/index.ts";
import type { View } from "../ws.ts";
import { personAgent } from "./person.ts";

/**
 * Who is calling a person's verb, and what it may say back.
 *
 * `tell` says a message to the caller alone (the line it came on, or the tab's socket), where a
 * broadcast goes to everyone: the history a chat.open asked for, a notice about this call. A call
 * by HTTP has nobody to tell, and its messages become the answer's notes. `view` is the caller's
 * screen, which agent it is on, kept per line or socket (`forView` in `app.ts`); a page that has
 * none (a terminal) changes the harness's own focus alone.
 */
export interface PersonCall {
	tell: (message: ServerMessage) => void;
	view?: View;
	/** The id of the token the call came with, for what names the caller back (the paired front end that is you). */
	tokenId?: string;
	/** What the caller says it acts on: the canvas on screen and the agent it is talking to, from `X-Decks-Stage` and `X-Decks-Agent` or the line's `stage` and `agent`. */
	on: { stage?: string; agent?: string; edit?: string };
}

type Impl = (args: readonly unknown[], call: PersonCall) => Promise<unknown>;

const DOCUMENT_SIZE = { w: 1000, h: 1100 };

/** The person's verbs (`@decks/api`, `PERSON_VERBS`), each run against the harness itself. */
export function personTable(app: App): Record<string, Impl> {
	const agents = () => app.agents;
	const pens = () => app.stage.pens;
	const need = (id: unknown): DeckAgent => {
		const agent = agents().get(String(id));
		if (!agent) throw new Error("That agent is not here any more.");
		return agent;
	};
	const notice = (call: PersonCall, level: "info" | "warn" | "error", text: string) => call.tell({ type: "harness.notice", level, text });
	/** The canvas a call acts on: the one it names, else the one on screen, else the agent's. */
	const stageFor = (asked: unknown, call: PersonCall): { name?: string; agent?: DeckAgent } => {
		const canvas = typeof asked === "string" && pens()?.has(asked) ? asked : call.on.stage && pens()?.has(call.on.stage) ? call.on.stage : undefined;
		const target = app.target();
		const name = canvas ?? target.stageName(true);
		if (!name) return {};
		const agent = target.stageName() === name ? target : agents().looking()?.stageName() === name ? agents().looking() : agents().all().find((one) => one.stageName() === name);
		return { name, ...(agent ? { agent } : {}) };
	};
	const gesture = async (call: PersonCall, asked: { stage?: string; agent?: string }, name: "move" | "resize" | "hide" | "edit" | "open" | "newStage", args: unknown[]) => {
		const answer = await personAgent({ agents: agents(), pens: pens() }, asked).personTool().gesture(name, args as never);
		if (!answer.ok) throw new Error(answer.error ?? `${name} failed`);
		return answer.value;
	};
	/** The canvas a card call acts on: the one its options name, else the one on screen. */
	const onCanvas = (options: unknown, call: PersonCall): { stage?: string } => {
		const canvas = (options as { canvas?: unknown } | undefined)?.canvas;
		const name = typeof canvas === "string" && canvas ? canvas : call.on.stage;
		return name ? { stage: name } : {};
	};

	return {
		"deck.open": async ([path]) => {
			app.openDeck(String(path));
		},

		"agent.focus": async ([id], call) => {
			// This screen first, then everyone: the agent.list the focus publishes is rendered for each line by its view (`forView`), and this one must already say the new agent.
			if (call.view) call.view.focused = String(id);
			agents().focus(String(id));
			if (call.view) call.tell({ type: "deck.changed", deck: app.stageState(agents().get(String(id))) });
		},
		"agent.remove": async ([id]) => {
			const outcome = agents().remove(String(id));
			if (outcome.removed) app.acts.forget(String(id));
			if (!outcome.removed && outcome.reason) throw new Error(outcome.reason);
		},
		"agent.add": async ([spec]) => {
			const given = (spec ?? {}) as { kind?: string; workspace?: string; near?: string };
			const agent = agents().create({ ...(given.workspace ? { workspace: given.workspace } : {}), ...(typeof given.near === "string" ? { near: given.near } : {}), ...(given.kind ? { kind: given.kind as never } : {}) });
			agents().focus(agent.id);
			const workspace = given.workspace ?? (typeof given.near === "string" ? agents().get(given.near)?.workspace : undefined);
			const latest = agents().latestCanvas(workspace, agent.id);
			try {
				if (latest) agent.openStage(latest);
				else agent.newStage?.(agent.chat().name, { provisional: true });
			} catch {
				/* a name clash or a canvas gone meanwhile: the agent still works, on a canvas of its own once it needs one */
			}
			void app.publishAccounts();
			app.publishStages();
			return { id: agent.id };
		},
		"agent.set": async ([id, patch], call) => {
			const agent = need(id);
			const change = (patch ?? {}) as { name?: string; tags?: string[]; workspace?: string | null; model?: { provider: string; model: string; thinking?: string }; thinking?: string; mode?: string; canvas?: string };
			if (change.name !== undefined) {
				const name = String(change.name).trim().slice(0, 40);
				if (!name) throw new Error("A name cannot be empty.");
				if (agents().nameTaken(name, agent.id)) {
					call.tell({ type: "agent.identity", id: agent.id, identity: agent.chat().identity });
					throw new Error(`Another agent is already called ${name}.`);
				}
				agent.rename(name);
			}
			if (change.tags !== undefined) agent.setUserTags(change.tags);
			if (change.workspace !== undefined) {
				if (change.workspace === null) agent.clearWorkspace();
				else agent.setWorkspace(change.workspace);
			}
			if (change.model) await agent.setModel(change.model.provider, change.model.model, change.model.thinking as never);
			if (change.thinking !== undefined) {
				try {
					await agent.setThinking(change.thinking as never);
				} catch (error) {
					throw new Error(`Could not change the thinking level: ${(error as Error).message}`);
				}
			}
			if (change.mode !== undefined) {
				try {
					await agent.setMode(change.mode as never);
					agents().publish();
				} catch (error) {
					throw new Error(`Could not change mode: ${(error as Error).message}`);
				}
			}
			if (change.canvas !== undefined) await gesture(call, { agent: agent.id }, "open", [change.canvas]);
		},
		"agent.report": async ([id], call) => {
			const agent = agents().get(String(id));
			if (!agent) {
				call.tell({ type: "agent.report", id: String(id), error: "That agent is gone." });
				return;
			}
			void agent
				.report()
				.then((report) => call.tell({ type: "agent.report", id: agent.id, report }))
				.catch((error: unknown) => call.tell({ type: "agent.report", id: agent.id, error: (error as Error).message }));
		},
		"agent.answer": async ([answer]) => {
			for (const agent of agents().all()) agent.answerDialog(answer as never);
		},

		"chat.send": async ([id, message]) => {
			const given = (message ?? {}) as { text?: string; parts?: unknown[] };
			const agent = agents().get(String(id)) ?? agents().focused();
			void agent.prompt(String(given.text ?? ""), cleanParts(given.parts as never));
			agent.sayRow();
		},
		"chat.abort": async ([id]) => {
			void agents().get(String(id))?.abort();
		},
		"chat.queue": async ([id, change]) => {
			const agent = need(id);
			const asked = (change ?? {}) as { action?: string; text?: string; parts?: unknown[]; item?: string };
			if (asked.action === "add" && typeof asked.text === "string") agent.queueMine(asked.text, cleanParts(asked.parts as never));
			else if (asked.action === "remove" && typeof asked.item === "string") agent.unqueueMine(asked.item);
			else if (asked.action === "send" && typeof asked.item === "string") agent.sendMineNow(asked.item);
			else if (asked.action === "release") agent.releaseMine();
			agent.sayRow();
		},
		"chat.open": async ([id], call) => {
			const agent = need(id);
			const history = agent.historyMessage() as Extract<ServerMessage, { type: "chat.history" }>;
			call.tell(history);
			const pen = app.penMessage(agent.id);
			if (pen) call.tell(pen);
			return { items: history.items, more: history.more ?? false };
		},
		"chat.earlier": async ([id, page], call) => {
			const asked = (page ?? {}) as { before?: string; limit?: number };
			const before = String(asked.before ?? "");
			const agent = agents().get(String(id));
			if (!agent) {
				call.tell({ type: "chat.earlier", agentId: String(id), before, items: [], more: false });
				return;
			}
			const got = agent.earlier(before, Math.min(Math.max(asked.limit ?? 60, 1), 200));
			call.tell({ type: "chat.earlier", agentId: agent.id, before, items: got.items, more: got.more });
			return { items: got.items, more: got.more };
		},
		"chat.tool": async ([id, item], call) => {
			const agent = agents().get(String(id));
			const result = agent?.toolResult(String(item)) ?? "";
			call.tell({ type: "chat.tool", agentId: String(id), itemId: String(item), result });
			return { result };
		},
		"chat.preview": async ([id, entry], call) => {
			const agent = need(id);
			const entryId = entry === null || entry === undefined ? null : String(entry);
			call.tell({ type: "chat.preview", agentId: agent.id, entryId, boards: entryId ? app.boards.boardsAt(agent, entryId) : {} });
		},
		"chat.rewind": async ([id, entry], call) => {
			const agent = need(id);
			const result = await agent.rewindTo(String(entry));
			agents().publish();
			if (result.cancelled) {
				notice(call, "info", "Rewind cancelled.");
				return { cancelled: true };
			}
			notice(call, "info", "Rewound.");
			if (result.editorText) call.tell({ type: "chat.draft", text: result.editorText });
			return { cancelled: false };
		},
		"chat.fork": async ([id, entry], call) => {
			const agent = need(id);
			const resumeRef = await agent.forkFrom(String(entry));
			if (!resumeRef) throw new Error("There is nothing before that message to fork from.");
			const at = agent.entryTime(String(entry));
			const child = agents().create({
				name: `${agent.chat().name} (fork)`,
				resumeRef,
				kind: agent.kind,
				...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
				...(agent.model ? { model: agent.model } : {}),
				...(agent.mode ? { mode: agent.mode } : {}),
			});
			if (call.view) call.view.focused = child.id;
			agents().focus(child.id);
			return { id: child.id };
		},
		"chat.restore": async ([id, entry], call) => {
			const agent = need(id);
			const wanted = app.boards.boardsAt(agent, String(entry));
			let restored = 0;
			for (const [path, sha] of Object.entries(wanted)) {
				try {
					const content = app.boards.revisions.read(sha);
					if (content === readFileSync(app.deck.fileOf(path), "utf8")) continue;
					writeFileSync(app.deck.fileOf(path), content);
					app.boards.revisions.record(path, content);
					restored++;
				} catch (error) {
					notice(call, "warn", `Could not restore ${path}: ${(error as Error).message}`);
				}
			}
			notice(call, "info", restored === 0 ? "Those boards are already as they were." : `Restored ${restored} board${restored === 1 ? "" : "s"}.`);
			return { restored };
		},

		"account.list": async ([options], call) => {
			void app.publishAccounts(call.tell);
			if ((options as { limits?: unknown } | undefined)?.limits) void app.refreshLimits();
		},
		"account.add": async () => {
			const claude = [agents().focused(), ...agents().all()].find((agent) => agent.kind === "claude");
			if (!claude) throw new Error("Start a Claude agent first. Signing in runs through one.");
			void claude.prompt("/login");
		},
		"account.use": async ([id, agentId]) => {
			const agent = agents().all().find((one) => one.id === String(agentId));
			if (!agent) throw new Error("That agent is not here any more.");
			if (!agent.useAccount(String(id))) throw new Error("That account is not on the list any more.");
			void agent.start();
			void app.warmAccount(String(id)).then(() => app.publishAccounts(undefined, { reread: true }));
		},
		"account.forget": async ([id]) => {
			app.claudeAccounts.forget(String(id));
			void app.publishAccounts();
		},

		"card.move": async ([card, at, options], call) => gesture(call, onCanvas(options, call), "move", [String(card), at]),
		"card.resize": async ([card, size, options], call) => gesture(call, onCanvas(options, call), "resize", [String(card), size]),
		"card.hide": async ([card, options], call) => gesture(call, onCanvas(options, call), "hide", [String(card)]),
		"card.play": async ([card, options], call) => {
			const { name, agent } = stageFor((options as { canvas?: unknown } | undefined)?.canvas, call);
			if (agent) agent.setInPlay([...agent.inPlay, String(card)], { place: true });
			else if (name && pens()) putOn(pens()!, app.deck, name, [String(card)]);
		},
		"card.delete": async ([card], call) => {
			let refused: string | undefined;
			app.boards.deleteBoard(String(card), (message) => {
				if (message.type === "harness.notice") refused = message.text;
				else call.tell(message);
			});
			if (refused) throw new Error(refused);
		},
		"doc.place": async ([options], call) => {
			const asked = (options ?? {}) as { document?: string; google?: string; at?: { x: number; y: number }; canvas?: string };
			const { name } = stageFor(asked.canvas, call);
			if (!name) throw new Error("There is no canvas on screen to put the document on.");
			const place = async (file: string, title?: string) => {
				const real = (one: string) => {
					try {
						return realpathSync(one);
					} catch {
						return one;
					}
				};
				const inside = relative(real(app.deck.path), real(file));
				const path = !inside.startsWith("..") && !isAbsolute(inside) ? inside.split("\\").join("/") : file;
				const corner = asked.at && Number.isFinite(asked.at.x) && Number.isFinite(asked.at.y) ? { x1: Math.round(asked.at.x), y1: Math.round(asked.at.y) } : joined();
				const answer = await personAgent({ agents: agents(), pens: pens() }, { stage: name })
					.personTool()
					.call("canvas.insert", [{ type: "document", path, ...(title ? { title } : {}) }, { canvas: name, ...(corner ? { at: corner } : {}) }]);
				if (!answer.ok) throw new Error(answer.error ?? "The document could not be put on the canvas.");
				const id = (answer.value as { id?: unknown } | undefined)?.id;
				return { path: typeof id === "string" ? `item:${id}` : "" };
			};
			const joined = () => {
				const held = pens();
				if (!held) return undefined;
				try {
					const boards = held.boards(name);
					const spot = joinSpot(DOCUMENT_SIZE, boards.at(-1), [...boards, ...held.drawn(name)]);
					return { x1: spot.x, y1: spot.y };
				} catch {
					return undefined;
				}
			};
			if (typeof asked.google === "string" && asked.google.trim()) {
				const mirror = await app.google.link(asked.google.trim());
				return place(mirror, app.google.remote(mirror)?.title);
			}
			if (typeof asked.document !== "string" || !asked.document.trim()) throw new Error("Name a document to place: { document } or { google }.");
			return place(app.docs.openable(asked.document.trim()));
		},
		"canvas.edit": async ([ops, options], call) => {
			const asked = (options ?? {}) as { canvas?: string; agent?: string };
			const on = { ...(asked.agent ?? call.on.agent ? { agent: asked.agent ?? call.on.agent } : {}), ...(asked.canvas ?? call.on.stage ? { stage: asked.canvas ?? call.on.stage } : {}) };
			const run = () => gesture(call, on, "edit", [ops as Op[]]);
			return call.on.edit ? penEditBy.run(call.on.edit, run) : run();
		},
		"canvas.remove": async ([canvas]) => {
			const held = pens();
			if (!held) throw new Error("This server keeps no canvases.");
			deleteStage({ deck: app.deck, pens: held, agents: agents().all() }, String(canvas));
			app.publishStages();
		},

		"view.remember": async ([camera, options]) => {
			const asked = (options ?? {}) as { agent?: string; canvas?: string; device?: string };
			if (!agents().get(String(asked.agent))) return;
			app.cameras.report(String(asked.agent), camera as never, { stage: asked.canvas, device: asked.device });
		},

		"harness.configure": async ([settings]) => {
			const asked = (settings ?? {}) as { timezone?: string | null; sttModel?: string | null; requireCode?: boolean };
			const problems = [asked.timezone !== undefined ? app.setTimezone(asked.timezone) : undefined, asked.sttModel !== undefined ? app.setSttModel(asked.sttModel) : undefined].filter((one): one is { error: string } => !!one);
			if (typeof asked.requireCode === "boolean") {
				if (app.codes.forced && !asked.requireCode) problems.push({ error: "This harness was started with DECKS_REQUIRE_PAIR_CODE, so a code is always asked for." });
				else app.codes.setRequired(asked.requireCode);
			}
			if (problems.length) throw new Error(problems.map((one) => one.error).join(" "));
		},
		"agent.dialogs": async ([id]) => ({ dialogs: need(id).dialogs() }),
		"agent.settings": async ([id, options]) => {
			const agent = need(id);
			if ((options as { limits?: unknown } | undefined)?.limits) void app.refreshLimits();
			let accounts: { accounts?: unknown[]; active?: string } = {};
			if (agent.kind === "claude") await app.publishAccounts((frame) => frame.type === "account.list" && (accounts = frame));
			const runtime = app.runtimes().find((one) => one.kind === agent.kind);
			return {
				id: agent.id,
				kind: agent.kind,
				model: agent.model ?? null,
				models: runtime?.models ?? [],
				commands: agent.chat().commands ?? runtime?.commands ?? [],
				mode: agent.mode ?? null,
				usage: agent.usage ?? null,
				modes: runtime?.capabilities.modes ?? [],
				accounts: accounts.accounts ?? [],
				account: agent.accountId() ?? accounts.active ?? null,
				queued: agent.queuedMine(),
			};
		},
		"agent.reset": async ([id]) => {
			await need(id).reset();
			agents().publish();
		},
		"apps.seen": async ([name]) => {
			if (!app.apps.exists(String(name))) throw new Error(`There is no app called ${String(name)}.`);
			app.apps.seen(String(name));
		},
		"deck.get": async () => ({ deck: app.deck.state(), warnings: app.deck.warnings }),
		"harness.get": async ([], call) => {
			let accounts: { accounts?: unknown[]; active?: string } = {};
			await app.publishAccounts((frame) => frame.type === "account.list" && (accounts = frame));
			const settings = app.settings.get();
			return {
				name: app.deck.name,
				deck: app.deck.path,
				version: harnessVersion(),
				timezone: settings.timezone ?? null,
				machineZone: app.settings.machineZone(),
				sttModel: settings.sttModel ?? STT_MODELS[0]!.id,
				sttModels: STT_MODELS.map((one) => ({ id: one.id, label: one.label ?? one.id })),
				sttKey: sttReady(),
				runtimes: app.runtimes().map((one) => ({ kind: one.kind, label: one.label, available: one.available, ...(one.reason ? { reason: one.reason } : {}), models: one.models, modes: one.capabilities.modes })),
				accounts: accounts.accounts ?? [],
				paired: app.tokens.paired().map((one) => ({ ...one, ...(one.id === call.tokenId ? { you: true } : {}) })),
				requireCode: app.codes.required,
				requireCodeForced: app.codes.forced,
				extension: { status: app.web.status() },
			};
		},
				"account.google": async () => app.google.state(),
		"account.googleCode": async ([url]) => {
			try {
				return { ok: true, email: await app.google.auth.finish({ url: String(url ?? "") }) };
			} catch (error) {
				return { ok: false, message: (error as Error).message };
			}
		},
		"account.googleSignOut": async () => {
			app.google.auth.signOut();
		},

		"harness.revoke": async ([id]) => {
			if (!app.tokens.paired().some((one) => one.id === String(id)) || !app.tokens.revoke(String(id))) throw new Error("No front end with that id is paired here.");
			app.send(app.pairingMessage());
		},
		"harness.unpair": async () => {
			unpairStudioHere(app);
		},
		"web.answer": async ([id, ok], call) => {
			if (!app.web.answer(String(id), ok === true)) notice(call, "info", "That question has already been answered.");
		},
	};
}

/** `canvas.rename` and `studio.disconnect` are the table's; the person's old `stage.rename` and `studio.unpair` run through them (`wire/legacy.ts`). */
export function renameCanvas(app: App, name: string, to: string): void {
	const pens = app.stage.pens;
	if (!pens) throw new Error("This server keeps no canvases.");
	titleCanvas({ deck: app.deck, pens, agents: app.agents.all() }, name, to);
	app.publishStages();
}

export function unpairStudioHere(app: App): void {
	unpairStudio(app.deck.path, app.tokens);
	app.send(app.pairingMessage());
}
