import type { Deck, Route } from "../kernel/index.ts";
import { newsOf, pagesOf, readDrawing } from "./drawing.ts";

// Today's GET /api/deck: the deck's folder and every card and old board on its canvases,
// friends' included, as today's checks read it (deckState, preflight).

export function deckRoute(deck: () => Deck, folder: () => string | undefined): Route {
	return {
		method: "GET",
		prefix: "/api/deck",
		async answer(ctx) {
			const canvases = await ctx.call<Array<{ name: string; title: string }>>("canvas.list", {});
			const boards: Record<string, unknown>[] = [];
			const news = await newsOf((n, a) => ctx.call(n, a));
			for (const canvas of canvases) {
				const read = await readDrawing(deck(), canvas.name, "");
				if (read) boards.push(...pagesOf(canvas.name, read.doc, true, news));
			}
			const path = folder() ?? "";
			const body = { deck: { path, name: path.split("/").filter(Boolean).pop() ?? "deck", boards, roots: [] } };
			return { type: "application/json", body: JSON.stringify(body) };
		},
	};
}
