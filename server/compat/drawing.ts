import { toDeckPath, type Deck, type Route } from "../kernel/index.ts";

// Today's /compat/stage-pen/<canvas>: the drawing as the canvas frame first reads it, its
// revision, where its files are read on the frame's pass, and the cards on it as pages.

export const DRAWING_PATH = "/compat/stage-pen/";
type Node = { type?: string; id?: string; name?: string; x?: number; y?: number; width?: number; height?: number; metadata?: { type?: string; path?: string }; children?: Node[] };

/** A canvas's folder: canvases/<name>, or shared/canvases/<owner>/<name> for a friend's. */
export const folderOf = (canvas: string): string => (canvas.startsWith("shared/") ? `shared/canvases/${canvas.slice(7)}` : `canvases/${canvas}`);

const PAGES = new Set(["decks.card", "decks.board"]);

/** A card's or board's path in the drawing as today's frame reads it: from the deck's root, not the canvas's folder. */
function deckPaths(canvas: string, nodes: Node[] | undefined): Node[] | undefined {
	return nodes?.map((node) => {
		const path = node.metadata?.path;
		const own = typeof path === "string" && PAGES.has(node.metadata?.type ?? "") && !/^(canvases|shared)\//.test(path);
		const children = node.children ? { children: deckPaths(canvas, node.children) } : {};
		return own ? { ...node, ...children, metadata: { ...node.metadata, path: `${folderOf(canvas)}/${path}` } } : { ...node, ...children };
	});
}

/** The drawing's document, parsed, with the files base it is read against; pages named from the deck's root. */
export async function readDrawing(deck: Deck, canvas: string, base: string): Promise<{ doc: { children?: Node[] }; base: string } | undefined> {
	try {
		const bytes = await deck.read(toDeckPath(`${folderOf(canvas)}/canvas.pen`));
		const doc = JSON.parse(new TextDecoder().decode(bytes)) as { children?: Node[] };
		return { doc: { ...doc, children: deckPaths(canvas, doc.children) ?? [] }, base };
	} catch {
		return undefined;
	}
}

/** The cards at the top of a drawing (and old boards, with boards), as today's Page records. */
export function pagesOf(canvas: string, doc: { children?: Node[] }, boards = false): Record<string, unknown>[] {
	const kinds = boards ? ["decks.card", "decks.board"] : ["decks.card"];
	return (doc.children ?? [])
		.filter((node) => kinds.includes(node.metadata?.type ?? "") && typeof node.metadata?.path === "string")
		.map((node) => ({
			path: /^(canvases|shared)\//.test(node.metadata!.path!) ? node.metadata!.path! : `${folderOf(canvas)}/${node.metadata!.path!}`,
			title: node.name ?? node.metadata!.path!,
			...(node.metadata!.type === "decks.card" ? { card: true } : {}),
			x: node.x ?? 0,
			y: node.y ?? 0,
			w: node.width ?? 1000,
			h: node.height ?? 700,
			rev: 0,
			inContext: [],
		}));
}

const bearer = (header: string | undefined) => (header?.startsWith("Bearer ") ? header.slice(7) : undefined);

export function drawingRoute(deck: () => Deck): Route {
	return {
		method: "GET",
		prefix: DRAWING_PATH,
		async serve(ctx, req, res) {
			const canvas = decodeURIComponent((req.url ?? "").split("?")[0]!.slice(DRAWING_PATH.length));
			const bound = ctx.caller.id.startsWith("frame-") ? ctx.caller.canvas : undefined;
			const pass = bearer(req.headers.authorization);
			const base = bound && pass ? `/api/t/${pass}/card/canvases/${canvas}/` : `/files/canvases/${canvas}/`;
			const got = bound && bound !== canvas ? undefined : await ctx.call<{ rev?: number }>("canvas.get", { canvas }).catch(() => undefined);
			const read = got ? await readDrawing(deck(), canvas, base) : undefined;
			if (!read) return void res.writeHead(404, { "content-type": "text/plain" }).end(`There is no canvas called ${canvas}.`);
			const body = JSON.stringify({ doc: read.doc, base, rev: got?.rev ?? 0, cards: pagesOf(canvas, read.doc, true) });
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
		},
	};
}
