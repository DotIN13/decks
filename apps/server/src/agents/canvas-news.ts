import type { PenDocument, PenNode } from "@decks/pen";

/**
 * What changed on a canvas since an agent last heard, as the lines put in front of its next message.
 *
 * An agent's instructions say changes others make on a canvas reach it with its next message, and
 * for a long time nothing did: the one note there was ("the user edited this board") went with board
 * editing. So each message now carries this: the agent's canvases as they are, against what they were
 * at its last message, item by item, with who made each change (`ChangeRecord`, kept by the canvas
 * store at every write) and its own changes left out, since it knows those.
 */

/** Who wrote a canvas: the person (an edit from a page), an agent (its own call), or the file itself. */
export type Author = { kind: "person" } | { kind: "agent"; id: string } | { kind: "file" };

/** One write of a canvas: its revision, its author, and the items it touched. */
export interface ChangeRecord {
	rev: number;
	by: Author;
	ids: string[];
}

/** The most lines a note has before it says how many more. */
const MOST = 8;

interface Seen {
	node: PenNode;
	parent: string | null;
}

function indexOf(doc: PenDocument): Map<string, Seen> {
	const map = new Map<string, Seen>();
	const visit = (list: readonly PenNode[], parent: string | null) => {
		for (const node of list) {
			map.set(node.id, { node, parent });
			if (Array.isArray(node.children)) visit(node.children, node.id);
		}
	};
	visit(doc.children ?? [], null);
	return map;
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const meta = (node: PenNode): Record<string, unknown> => (node.metadata && typeof node.metadata === "object" ? (node.metadata as Record<string, unknown>) : {});
const isInk = (node: PenNode) => meta(node).type === "decks.ink";
const isBoard = (node: PenNode) => meta(node).type === "decks.board";

/** Everything but where the item is, how big, and what is in it: a change here is a change of the item itself. */
function body(node: PenNode): string {
	const { x: _x, y: _y, width: _w, height: _h, children: _c, ...rest } = node as PenNode & Record<string, unknown>;
	return JSON.stringify(rest);
}

/** What a person would call the item, in a few words. */
export function label(node: PenNode): string {
	if (isBoard(node)) {
		const path = String(meta(node).path ?? (node as { url?: unknown }).url ?? node.id);
		return `the board ${path.split("/").pop()?.replace(/\.html$/, "")}`;
	}
	const words = typeof (node as { content?: unknown }).content === "string" ? ((node as { content: string }).content).replace(/\s+/g, " ").trim() : "";
	const short = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
	if (node.type === "note") return words ? `the note "${short(words)}" (${node.id})` : `an empty note (${node.id})`;
	if (node.type === "text") return words ? `the text "${short(words)}" (${node.id})` : `a text (${node.id})`;
	const name = typeof node.name === "string" && node.name.trim() ? `"${short(node.name.trim())}" ` : "";
	const kind = node.type === "ref" ? "component" : node.type;
	return `the ${kind} ${name}(${node.id})`;
}

/**
 * The lines for one canvas: what `before` became in `after`, from `records` (the writes since), with
 * `self`'s own writes left out and each author named by `nameOf`. Empty when nothing new is worth saying.
 */
export function canvasNews(
	title: string,
	canvas: string,
	before: PenDocument,
	after: PenDocument,
	records: readonly ChangeRecord[],
	self: string,
	nameOf: (agentId: string) => string,
): string[] {
	const was = indexOf(before);
	const now = indexOf(after);
	// The last write that touched each item names who changed it.
	const authorOf = new Map<string, Author>();
	for (const record of records) for (const id of record.ids) authorOf.set(id, record.by);
	// No record is a change from before this server started keeping them: someone, not a guess.
	const who = (by: Author | undefined) => (!by ? "someone" : by.kind === "file" ? "a file edit" : by.kind === "person" ? "you" : nameOf(by.id));
	const mine = (by: Author | undefined) => by?.kind === "agent" && by.id === self;

	type Change = { author: string; verb: string; node: PenNode; detail?: string };
	const changes: Change[] = [];
	const under = (index: Map<string, Seen>, id: string, set: Set<string>) => {
		for (let at = index.get(id)?.parent; at; at = index.get(at)?.parent) if (set.has(at)) return true;
		return false;
	};
	const added = new Set([...now.keys()].filter((id) => !was.has(id)));
	const removed = new Set([...was.keys()].filter((id) => !now.has(id)));
	for (const id of added) {
		// What is inside something new is part of it.
		if (under(now, id, added) || mine(authorOf.get(id))) continue;
		changes.push({ author: who(authorOf.get(id)), verb: "added", node: now.get(id)!.node });
	}
	for (const id of removed) {
		if (under(was, id, removed) || mine(authorOf.get(id))) continue;
		changes.push({ author: who(authorOf.get(id)), verb: "deleted", node: was.get(id)!.node });
	}
	for (const [id, { node, parent }] of now) {
		const old = was.get(id);
		if (!old || mine(authorOf.get(id))) continue;
		// Only what someone did: an item nobody wrote that moved only because its frame did is its frame's news.
		if (!authorOf.has(id)) continue;
		const author = who(authorOf.get(id));
		const dx = (num(node.x) ?? 0) - (num(old.node.x) ?? 0);
		const dy = (num(node.y) ?? 0) - (num(old.node.y) ?? 0);
		const resized = num(node.width) !== num(old.node.width) || num(node.height) !== num(old.node.height);
		if (parent !== old.parent) {
			const into = parent ? now.get(parent)?.node : undefined;
			changes.push({ author, verb: "moved", node, detail: into ? `into ${label(into)}` : "out onto the canvas" });
		} else if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
			changes.push({ author, verb: "moved", node, detail: `by (${Math.round(dx)}, ${Math.round(dy)})` });
		}
		if (resized) changes.push({ author, verb: "resized", node, detail: `to ${Math.round(num(node.width) ?? 0)} × ${Math.round(num(node.height) ?? 0)}` });
		if (body(node) !== body(old.node)) changes.push({ author, verb: node.type === "note" || node.type === "text" ? "rewrote" : "changed", node });
	}
	if (changes.length === 0) return [];

	// Strokes come by the dozen: one line per author and kind of change, with where they are.
	const lines: string[] = [];
	const inks = new Map<string, PenNode[]>();
	for (const change of changes) {
		if (isInk(change.node)) {
			const key = `${change.author}\u0000${change.verb}`;
			inks.set(key, [...(inks.get(key) ?? []), change.node]);
			continue;
		}
		lines.push(` ${change.author} ${change.verb} ${label(change.node)}${change.detail ? ` ${change.detail}` : ""}`);
	}
	for (const [key, nodes] of inks) {
		const [author, verb] = key.split("\u0000") as [string, string];
		const xs = nodes.map((n) => (num(n.x) ?? 0) + (num(n.width) ?? 0) / 2);
		const ys = nodes.map((n) => (num(n.y) ?? 0) + (num(n.height) ?? 0) / 2);
		const at = `around (${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}, ${Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)})`;
		lines.unshift(` ${author} ${verb} ${nodes.length === 1 ? "an ink stroke" : `${nodes.length} ink strokes`} ${at}`);
	}
	const shown = lines.slice(0, MOST);
	if (lines.length > MOST) shown.push(` and ${lines.length - MOST} more changes`);
	return [`[Since your last message, on "${title}" (${canvas}):`, ...shown, ` decks canvas read --canvas ${canvas} --of <id> reads any of them]`];
}
