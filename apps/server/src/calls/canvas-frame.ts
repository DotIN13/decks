import { cardCalls, VERB_BY_NAME } from "@decks/api";
import { actsAsPerson, type Principal } from "../auth/principal.ts";
import { canvasShowsApp } from "./app-caller.ts";
import type { CallsHost } from "./host.ts";

/**
 * The canvas frame as a caller: the editor in its sandboxed page, and the cards it runs, acting as
 * the person on one canvas and no further. What it may call, what it may say of a card, what a
 * document item's editor may send through it, and which of the harness's events it hears.
 */

/**
 * The calls a canvas frame may make, on its one canvas: reading and changing it, its cards, its
 * frames and files, undo and redo (the verb table's `card: "canvas"`, what a card's call goes to the
 * harness for), and `here` and `now`, which a card's call has answered in the frame. Never another
 * canvas, an agent, an app, the person's tab, or anything that reaches past this canvas; a canvas
 * shared to view reads only.
 */
export const CANVAS_FRAME_VERBS: ReadonlySet<string> = new Set([...cardCalls("canvas"), "here", "now"]);

/** The items only the person and agents place: a document names a file to open, an app a server to reach. */
const TRUSTED_ITEMS = ["decks.document", "decks.app"];
/** What of a trusted item the canvas frame may still change: where it is and how big. */
const PLACE_ONLY = new Set(["x", "y", "width", "height"]);

/**
 * Whether a canvas frame's call would make a document or an app item, or change what one names: a
 * card's script beside the frame could otherwise name any file to read, or a server to drive. Placing,
 * sizing and deleting one stays the frame's.
 */
function touchesTrustedItems(app: Pick<CallsHost, "stage">, verb: string, args: readonly unknown[], canvas: string): boolean {
	if (!["canvas.insert", "canvas.replace", "canvas.update", "canvas.batch", "canvas.copy"].includes(verb)) return false;
	if (TRUSTED_ITEMS.some((tag) => JSON.stringify(args).includes(tag))) return true;
	// The short forms that become one (`{ type: "app", app }`, `{ type: "document", path }`, `calls/canvas.ts`).
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
export function refusedForCanvas(app: Pick<CallsHost, "stage">, verb: string, args: readonly unknown[], canvas: string, role: "edit" | "view"): string | undefined {
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
 * Why a caller may not say something of a card (that it was read, how it measured): the card must exist,
 * and a canvas frame speaks only of cards on its own canvas; the person and a paired site of any.
 */
export function cardRefusedFor(app: Pick<CallsHost, "deck" | "stage">, principal: Principal | undefined, path: string): { status: number; error: string } | undefined {
	if (!path || !app.deck.board(path)) return { status: 404, error: `There is no card or board at ${path || "that path"}.` };
	if (actsAsPerson(principal)) return undefined;
	if (principal?.kind === "canvas" && boardOnCanvas(app, path, principal.canvas)) return undefined;
	return { status: 403, error: `${path} is not on this canvas.` };
}

/** What a document item's editor may send (`@decks/docs`'s `DocClientMessage`). */
export const DOC_CALLS: ReadonlySet<string> = new Set(["doc.open", "doc.close", "doc.patch", "doc.review", "doc.versions", "doc.version", "doc.compile", "doc.restore", "doc.git", "doc.gstyle", "doc.gcomment"]);

/**
 * Whether a broadcast is about one canvas: its drawing (`stage.pen`, `stage.pen.delta`, refusals), its
 * cards (`card.changed` for one on it), and what is said to it alone.
 */
export function onCanvas(app: Pick<CallsHost, "stage" | "agents" | "documentsOn">, message: { type: string; [key: string]: unknown }, canvas: string): boolean {
	/*
	 * An agent's `decks view …` that moves or marks this canvas, and a picture of a card on it (`shot`):
	 * the frame showing it answers. Showing another canvas stays the page's.
	 */
	// A document's messages, for a file a document item on this canvas names.
	if (message.type.startsWith("doc.")) {
		const path = (message as { path?: unknown }).path;
		return typeof path === "string" && app.documentsOn(canvas).has(path);
	}
	if (message.type === "view.called") {
		const call = message.call as { op?: string; agentId?: string; args?: { stage?: unknown; path?: unknown } } | undefined;
		// An agent moving to another canvas: the frame showing the canvas it is on now answers, which knows whether the person is using it.
		if (call?.op === "goto") return !!call.agentId && (call.args as { person?: unknown } | undefined)?.person !== true && app.agents.get(call.agentId)?.seat.stageName() === canvas;
		if (!call || !["show", "camera", "reload", "cursor", "shot"].includes(call.op ?? "")) return false;
		// A cursor, a reload or a card's picture names a card: the frame showing the canvas it is on answers, whoever's home that is.
		if ((call.op === "cursor" || call.op === "reload" || call.op === "shot") && typeof call.args?.path === "string") return boardOnCanvas(app, call.args.path, canvas);
		if (call.op === "shot") return false;
		const named = typeof call.args?.stage === "string" ? call.args.stage : undefined;
		if (named !== undefined) return named === canvas;
		return !!call.agentId && app.agents.get(call.agentId)?.seat.stageName() === canvas;
	}
	if (message.type === "stage.pen" || message.type === "stage.pen.delta") return message.stage === canvas;
	// An agent at work on a card: the frame showing the canvas it is on draws the agent's cursor there.
	if (message.type === "agent.act") return typeof message.path === "string" && boardOnCanvas(app, message.path, canvas);
	// An app's state, for a canvas holding an item of that app.
	if (message.type === "app.changed") return typeof message.name === "string" && canvasShowsApp(app.stage.pens, canvas, message.name);
	if (message.type === "card.changed") {
		const board = message.card as { path?: unknown } | undefined;
		const path = typeof board?.path === "string" ? board.path : typeof message.path === "string" ? message.path : undefined;
		if (!path) return false;
		return boardOnCanvas(app, path, canvas);
	}
	return false;
}

/** Whether a card or board is on a canvas: in its folder, or placed on its drawing. */
export function boardOnCanvas(app: Pick<CallsHost, "stage">, path: string, canvas: string): boolean {
	if (path.startsWith(`canvases/${canvas}/`)) return true;
	try {
		return !!app.stage.pens?.boards(canvas).some((one) => one.path === path);
	} catch {
		return false;
	}
}
