import type { ClientMessage, ServerMessage } from "@decks/protocol";
import type { App } from "../app.ts";
import { settleStage } from "../stage/pending.ts";
import type { View } from "../ws.ts";
import { runVerb } from "../verbs/router.ts";
import { renameCanvas, unpairStudioHere } from "../verbs/person-table.ts";

/**
 * The tab socket's old requests, for one release: each is an alias of a person's verb (`@decks/api`,
 * `PERSON_VERBS`) or of the table's, run exactly as a call is, and answered as the socket answered
 * it: a failure as a notice, the things the old frame said back said back. A page of this release
 * calls the verbs on the line instead; the Decks iOS app and a page of the release before still
 * send these.
 */

type Alias = { verb: string; args: unknown[]; on?: { stage?: string; agent?: string; edit?: string }; after?: (answer: { ok: boolean; value?: unknown; error?: string }, tell: (message: ServerMessage) => void, app: App) => void } | { direct: (app: App, tell: (message: ServerMessage) => void, view?: View) => void };

function alias(message: ClientMessage): Alias | undefined {
	const stage = (message as { stage?: string }).stage;
	const on = stage ? { canvas: stage } : {};
	switch (message.type) {
		case "hello":
			return { direct: () => {} };
		case "deck.open":
			return { verb: "deck.open", args: [message.path] };
		case "card.move":
			return { verb: "card.move", args: [message.path, { x: message.x, y: message.y }, on], on: { stage } };
		case "card.resize":
			return { verb: "card.resize", args: [message.path, { ...(typeof message.w === "number" ? { w: message.w } : {}), ...(typeof message.h === "number" ? { h: message.h } : {}) }, on], on: { stage } };
		case "card.extent": {
			const { type: _type, path, ...rest } = message;
			return { direct: (app) => app.boards.noteExtent(path, rest as never) };
		}
		case "card.play":
			return { verb: "card.play", args: [message.path, on], on: { stage } };
		case "card.seen":
			return { direct: (app) => app.boards.seen(message.path) };
		case "card.hide":
			return { verb: "card.hide", args: [message.path, on], on: { stage } };
		case "document.create":
			return {
				verb: "doc.place",
				args: [{ ...(message.document ? { document: message.document } : {}), ...(message.google ? { google: message.google } : {}), ...(message.at ? { at: message.at } : {}), ...on }],
				on: { stage },
				after: (answer, tell) => {
					const path = (answer.value as { path?: string } | undefined)?.path;
					if (answer.ok && typeof message.request === "string" && path) tell({ type: "doc.created", request: message.request, path });
				},
			};
		case "board.delete":
			return { verb: "card.delete", args: [message.path] };
		case "stage.pen.edit":
			return {
				verb: "canvas.edit",
				args: [message.ops, { ...on, agent: message.agentId }],
				on: { stage, agent: message.agentId, ...(message.edit ? { edit: message.edit.slice(0, 80) } : {}) },
				after: (answer, tell, app) => {
					if (answer.ok) return;
					if (message.edit) tell({ type: "stage.pen.refused", agentId: message.agentId, edit: message.edit });
					const frame = app.penMessage(message.agentId);
					if (frame) tell(frame);
				},
			};
		case "stage.pen.get":
			return {
				direct: (app, tell) => {
					const frame = app.penMessage(message.agentId);
					if (frame) tell(frame);
				},
			};
		case "agent.stage":
			return { verb: "agent.set", args: [message.id, { canvas: message.stage }] };
		case "stage.new":
			return {
				verb: "canvas.create",
				args: [message.title],
				on: { agent: message.id },
				after: (answer, tell, app) => {
					const name = (answer.value as { name?: string } | undefined)?.name;
					if (!answer.ok || !name) return;
					void runVerb(app, { kind: "person" }, {}, "agent.set", [message.id, { canvas: name }], undefined, { tell }).then(() => tell({ type: "deck.changed", deck: app.stageState() }));
				},
			};
		case "stage.rename":
			// At once, as the socket did it: a test or a page reads the title straight after.
			return {
				direct: (app, tell) => {
					try {
						renameCanvas(app, message.name, message.to);
					} catch (error) {
						tell({ type: "harness.notice", level: "warn", text: (error as Error).message });
						return;
					}
					tell({ type: "deck.changed", deck: app.stageState() });
				},
			};
		case "stage.delete":
			return { verb: "canvas.remove", args: [message.name], after: (answer, tell, app) => answer.ok && tell({ type: "deck.changed", deck: app.stageState() }) };
		case "stage.pen.step":
			return {
				verb: "canvas.step",
				args: [message.direction, on],
				on: { stage, agent: message.agentId, ...(message.edit ? { edit: message.edit.slice(0, 80) } : {}) },
				after: (answer, tell) => {
					if (answer.ok) return;
					if (message.edit) tell({ type: "stage.pen.refused", agentId: message.agentId, edit: message.edit });
					tell({ type: "harness.notice", level: "info", text: answer.error ?? "Nothing to undo." });
				},
			};
		case "camera.set":
			return { verb: "view.remember", args: [message.camera, { agent: message.agentId, ...(message.stage ? { canvas: message.stage } : {}), ...(message.device ? { device: message.device } : {}) }] };
		case "agent.create":
			return { verb: "agent.add", args: [{ ...(message.kind ? { kind: message.kind } : {}), ...(message.workspace ? { workspace: message.workspace } : {}), ...(message.near ? { near: message.near } : {}) }] };
		case "agent.focus":
			return {
				direct: (app, tell, view) => {
					app.agents.focus(message.id);
					if (view) view.focused = message.id;
					tell({ type: "deck.changed", deck: app.stageState() });
				},
			};
		case "agent.remove":
			return { verb: "agent.remove", args: [message.id] };
		case "agent.tags":
			return { verb: "agent.set", args: [message.id, { tags: message.tags }] };
		case "agent.rename":
			return { verb: "agent.set", args: [message.id, { name: message.name }] };
		case "agent.workspace":
			return { verb: "agent.set", args: [message.id, { workspace: message.workspace }] };
		case "agent.prompt":
			return { verb: "chat.send", args: [message.id, { text: message.text, ...(message.parts ? { parts: message.parts } : {}) }] };
		case "agent.abort":
			return { verb: "chat.abort", args: [message.id] };
		case "agent.queue":
			return { verb: "chat.queue", args: [message.id, { action: message.action, ...(message.text !== undefined ? { text: message.text } : {}), ...(message.parts ? { parts: message.parts } : {}), ...(message.item !== undefined ? { item: message.item } : {}) }] };
		case "agent.setModel":
			return { verb: "agent.set", args: [message.id, { model: { provider: message.provider, model: message.model, ...(message.thinking ? { thinking: message.thinking } : {}) } }] };
		case "agent.thinking":
			return { verb: "agent.set", args: [message.id, { thinking: message.thinking }] };
		case "agent.setMode":
			return { verb: "agent.set", args: [message.id, { mode: message.mode }] };
		case "agent.report":
			return { verb: "agent.report", args: [message.id] };
		case "chat.earlier":
			return { verb: "chat.earlier", args: [message.agentId, { before: message.before, ...(message.limit !== undefined ? { limit: message.limit } : {}) }] };
		case "chat.open":
			return { verb: "chat.open", args: [message.agentId] };
		case "chat.tool":
			return { verb: "chat.tool", args: [message.agentId, message.itemId] };
		case "stage.result":
			return { direct: (app) => void settleStage(app.pendingStage, message.result) };
		case "extension.ui.answer":
			return { verb: "agent.answer", args: [message.answer] };
		case "claude.accounts":
			return { verb: "account.list", args: [message.limits ? { limits: true } : {}] };
		case "claude.accounts.add":
			return { verb: "account.add", args: [] };
		case "claude.accounts.use":
			return { verb: "account.use", args: [message.id, message.agentId] };
		case "claude.accounts.forget":
			return { verb: "account.forget", args: [message.id] };
		case "rewind.preview":
			return { verb: "chat.preview", args: [message.id, message.entryId] };
		case "rewind.to":
			return { verb: "chat.rewind", args: [message.id, message.entryId] };
		case "fork.from":
			return { verb: "chat.fork", args: [message.id, message.entryId] };
		case "boards.restore":
			return { verb: "chat.restore", args: [message.id, message.entryId] };
		case "web.answer":
			return { verb: "web.answer", args: [message.id, message.ok] };
		case "web.stop":
			return { verb: "web.stop", args: [] };
		case "web.repair":
			return { verb: "web.repair", args: [] };
		case "settings.set":
			return { verb: "harness.configure", args: [{ ...(message.timezone !== undefined ? { timezone: message.timezone } : {}), ...(message.sttModel !== undefined ? { sttModel: message.sttModel } : {}) }] };
		case "pair.revoke":
			return { verb: "harness.revoke", args: [message.id] };
		case "studio.unpair":
			return {
				direct: (app, tell) => {
					try {
						unpairStudioHere(app);
					} catch (error) {
						tell({ type: "harness.error", text: (error as Error).message });
					}
				},
			};
		default:
			if (message.type.startsWith("doc.")) return { direct: (app, tell) => app.docs.handle(message as never, tell) };
			return undefined;
	}
}

/** Run one old request as the call it stands for. */
export async function legacy(app: App, message: ClientMessage, tell: (message: ServerMessage) => void, view?: View): Promise<void> {
	const found = alias(message);
	if (!found) {
		tell({ type: "harness.notice", level: "warn", text: `Not implemented yet: ${(message as { type: string }).type}` });
		return;
	}
	if ("direct" in found) {
		found.direct(app, tell, view);
		return;
	}
	const headers: Record<string, string> = { ...(found.on?.stage ? { "x-decks-stage": found.on.stage } : {}), ...(found.on?.agent ? { "x-decks-agent": found.on.agent } : {}), ...(found.on?.edit ? { "x-decks-edit": found.on.edit } : {}) };
	const { answer } = await runVerb(app, { kind: "person" }, headers, found.verb, found.args, undefined, { tell, view });
	if (!answer.ok && !found.after) tell({ type: "harness.notice", level: "warn", text: answer.error ?? `${message.type} failed` });
	found.after?.(answer, tell, app);
}
