import { baseTheme, num as penNum, type PenDocument, type PenNode } from "@decks/pen";
import type { Page } from "@decks/protocol-old";

/**
 * A board's tag, or a card's: a card is a board drawn in a shadow root of the stage's page (`card.ts`);
 * or a document's or an app's, items with no file of their own that the stage places as it places a board.
 */
export const PAGE_TAGS = new Set(["decks.board", "decks.card", "decks.document", "decks.app"]);
/** A document or an app item: what it is, or nothing for a board or a card. */
export const itemKind = (node: PenNode): "document" | "app" | undefined => {
	const type = (node.metadata as { type?: string } | undefined)?.type;
	return type === "decks.document" ? "document" : type === "decks.app" ? "app" : undefined;
};
export const isPage = (node: PenNode) => node.type === "browser" && PAGE_TAGS.has(String((node.metadata as { type?: string } | undefined)?.type));
const isCardItem = (node: PenNode) => node.type === "browser" && (node.metadata as { type?: string } | undefined)?.type === "decks.card";
export const pagePath = (node: PenNode) => {
	const kind = itemKind(node);
	// An item is its own: its path is its id, so two of one file or app are two places.
	if (kind) return `item:${String(node.id)}`;
	return String((node.metadata as { path?: unknown }).path ?? node.id);
};
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * How a card's item frames it, from its own pen fields: its corners (`cornerRadius`, one number or
 * four, a variable resolved in the light theme) and whether it draws its own outline. The shadow and
 * the outline are painted with the drawing (`paint`'s `browser_frame`); the page only needs to round
 * its corners to the same shape and leave its own outline off.
 */
export function cardFrame(doc: PenDocument, node: PenNode): Pick<Page, "corners" | "outlined"> {
	const out: Pick<Page, "corners" | "outlined"> = {};
	const radius = (node as { cornerRadius?: unknown }).cornerRadius;
	if (radius !== undefined && radius !== null) {
		const theme = baseTheme(doc, "light");
		const list = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
		const at = (i: number) => Math.max(0, penNum(doc, list[i] ?? list[0], theme, 0));
		out.corners = [at(0), at(1), at(2), at(3)];
	}
	const own = node as { stroke?: unknown; strokeWidth?: unknown };
	if ((own.stroke !== undefined && own.stroke !== null) || own.strokeWidth !== undefined) out.outlined = true;
	return out;
}

/** The drawing's boards, as the stage takes them. Top-level only: a board's x and y are the canvas's. */
export function pagesOf(doc: PenDocument): Page[] {
	const boards: Page[] = [];
	for (const node of doc.children ?? []) {
		if (!isPage(node)) continue;
		boards.push({
			path: pagePath(node),
			title: typeof node.name === "string" && node.name ? node.name : itemTitle(node) ?? pagePath(node),
			x: num(node.x, 0),
			y: num(node.y, 0),
			w: num(node.width, 960),
			h: num(node.height, 640),
			rev: 0,
			inContext: [],
			...(isCardItem(node) ? { card: true as const } : {}),
			...itemFields(node),
			...cardFrame(doc, node),
		});
	}
	return boards;
}

/**
 * A host's list of boards (its server's), with what the person's edits on their way do to them: a
 * board moved or sized on the drawing shown is where the drawing has it, and one taken off is gone,
 * until the host's drawing (`given`) and so its list have it too. Boards the edits do not touch, and
 * fields the drawing does not hold (a height the page raised), are the list's.
 */
export function pagesAhead(list: Page[], given: PenDocument, shown: PenDocument): Page[] {
	if (given === shown) return list;
	const byPath = (doc: PenDocument) => new Map(pagesOf(doc).map((board) => [board.path, board]));
	const was = byPath(given);
	const now = byPath(shown);
	const out: Page[] = [];
	for (const board of list) {
		const a = was.get(board.path);
		const b = now.get(board.path);
		if (a && !b) continue;
		if (!a || !b || (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)) {
			out.push(board);
			continue;
		}
		out.push({ ...board, x: b.x, y: b.y, ...(a.w !== b.w ? { w: b.w } : {}), ...(a.h !== b.h ? { h: b.h } : {}) });
	}
	return out;
}

/**
 * Edits made one after another, as one list of ops: run after run of plain updates (what the arrow keys,
 * a colour or a board's move write) folded into one update an item, each field as the last set it, and
 * anything else kept as it was, in order.
 */
export function together(edits: readonly (readonly unknown[])[]): unknown[] {
	const ops = edits.flat();
	const out: unknown[] = [];
	/** The updates since the last op that was not one, by item. */
	let run = new Map<string, { op: "update"; id: string; set: Record<string, unknown> }>();
	for (const op of ops) {
		const update = op as { op?: unknown; id?: unknown; set?: unknown };
		const plain = update.op === "update" && typeof update.id === "string" && update.set && typeof update.set === "object" && Object.keys(update).length === 3;
		if (!plain) {
			run = new Map();
			out.push(op);
			continue;
		}
		const held = run.get(update.id as string);
		if (held) Object.assign(held.set, update.set);
		else {
			const one = { op: "update" as const, id: update.id as string, set: { ...(update.set as Record<string, unknown>) } };
			run.set(one.id, one);
			out.push(one);
		}
	}
	return out;
}

/** What a document or an app item adds to its board record: its kind, and its file or its app. */
function itemFields(node: PenNode): { item?: "document" | "app"; file?: string; app?: string } {
	const kind = itemKind(node);
	const meta = (node.metadata ?? {}) as { path?: unknown; name?: unknown };
	if (kind === "document") return { item: "document", file: String(meta.path ?? "") };
	if (kind === "app") return { item: "app", app: String(meta.name ?? "") };
	return {};
}

/** What a document or an app item is called when it has no name of its own: its file's name, or its app's. */
function itemTitle(node: PenNode): string | undefined {
	const meta = (node.metadata ?? {}) as { path?: unknown; name?: unknown };
	const kind = itemKind(node);
	if (kind === "document") return String(meta.path ?? "").split("/").pop() || undefined;
	if (kind === "app") return String(meta.name ?? "") || undefined;
	return undefined;
}
