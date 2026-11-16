import type { PenDocument, PenEdit } from "@decks/pen";
import type { Page } from "@decks/protocol-old";
import { isPage, itemKind } from "../../drawing/pages.ts";
import type { FrameSocket } from "./socket.ts";

// The drawing as the frame reads it from the server (`canvas.drawing`): its cards named from the deck's
// root, as the frame keys them, and the cards' records read off the drawing with their news (`card.list`).

type Meta = { type?: string; path?: string };

/** The drawing, its revision and its cards, in one read. */
export async function readDrawing(socket: FrameSocket, canvas: string, base: string): Promise<{ doc: PenDocument; base: string; rev: number; cards: Page[] }> {
	const [drawn, cards] = await Promise.all([socket.call("canvas.drawing", { canvas }), socket.call("card.list", {})]);
	if (!drawn.ok) throw new Error(`The canvas ${canvas} did not load: ${drawn.error.message}`);
	const { doc, rev } = drawn.value as { doc: PenDocument; rev: number };
	const own = { ...doc, children: deckPaths(canvas, doc.children as PenDocument["children"]) ?? [] } as PenDocument;
	const news = new Map(((cards.ok ? cards.value : []) as News[]).map((one) => [one.path, one]));
	return { doc: own, base, rev, cards: pagesOf(own, news) };
}

/** A pen edit as the frame applies it: a card's path from the deck's root, as `readDrawing` gives them. */
export function deckPathEdits(canvas: string, edits: readonly PenEdit[]): PenEdit[] {
	return edits.map((edit) => {
		if (edit.op === "insert") {
			const meta = edit.props.metadata as Meta | undefined;
			return meta && owned(meta) ? { ...edit, props: { ...edit.props, metadata: { ...meta, path: `${folderOf(canvas)}/${meta.path}` } } } : edit;
		}
		if (edit.op === "set" && edit.key === "metadata") {
			const meta = edit.value as Meta | undefined;
			return meta && owned(meta) ? { ...edit, value: { ...meta, path: `${folderOf(canvas)}/${meta.path}` } } : edit;
		}
		return edit;
	});
}

const folderOf = (canvas: string) => `canvases/${canvas}`;

/** A card the canvas's folder holds, as the file names it: relative to that folder (documents and apps are items, not files). */
const owned = (meta: Meta) => {
	const node = { type: "browser", id: "", metadata: { type: meta.type ?? "" } };
	return typeof meta.path === "string" && isPage(node) && !itemKind(node) && !/^(canvases|shared)\//.test(meta.path);
};

function deckPaths(canvas: string, nodes: PenDocument["children"] | undefined): PenDocument["children"] | undefined {
	return nodes?.map((node) => {
		const meta = node.metadata as Meta | undefined;
		const children = node.children ? { children: deckPaths(canvas, node.children) } : {};
		return meta && owned(meta) ? { ...node, ...children, metadata: { ...meta, path: `${folderOf(canvas)}/${meta.path}` } } : { ...node, ...children };
	}) as PenDocument["children"];
}

/** A card's news, as card.list says it. */
type News = { path: string; by?: string; named?: number; changed?: number; seen?: number };

/** The cards at the top of the drawing as the frame's records, with their news. */
function pagesOf(doc: PenDocument, news: Map<string, News>): Page[] {
	return (doc.children ?? [])
		.filter((node) => isPage(node) && !itemKind(node) && typeof (node.metadata as Meta).path === "string")
		.map((node) => {
			const meta = node.metadata as Meta;
			const one = news.get(meta.path!);
			return {
				path: meta.path!,
				title: typeof node.name === "string" ? node.name : meta.path!,
				...(meta.type === "decks.card" ? { card: true as const } : {}),
				x: typeof node.x === "number" ? node.x : 0,
				y: typeof node.y === "number" ? node.y : 0,
				w: typeof node.width === "number" ? node.width : 1000,
				h: typeof node.height === "number" ? node.height : 700,
				rev: 0,
				inContext: [],
				...(one?.by ? { lastWrittenBy: one.by === "person" ? "you" : one.by } : {}),
				...(one?.named !== undefined ? { namedAt: one.named } : {}),
				...(one?.changed !== undefined ? { modifiedAt: one.changed } : {}),
				...(one?.seen !== undefined ? { seenAt: one.seen } : {}),
			} as Page;
		});
}
