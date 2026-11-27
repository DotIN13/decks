import { boxOf, placements, baseTheme, type Op } from "@decks/pen";
import { serverText } from "../canvas/text.ts";
import { withBox, type VerbContext } from "./context.ts";

/**
 * What the person's hands do on the canvas, sent over the socket: a card moved, sized or taken off
 * (`card.move`, `card.resize`, `card.hide` in `calls/person-canvas.ts`), and the drawing edited, a canvas
 * picked or made (`canvas.edit`, there too). Not verbs: nothing in the table names them and `/api/v1` cannot
 * reach them; an agent does these with `canvas.move`, `canvas.update`, `canvas.batch` and the rest.
 */
export interface Gestures {
	move(path: string, at: { x: number; y: number }): Promise<unknown>;
	resize(path: string, size: { w?: number; h?: number }): Promise<unknown>;
	hide(path: string | string[]): Promise<unknown>;
	edit(ops: readonly unknown[]): Promise<unknown>;
	open(name: string): Promise<unknown>;
	newStage(title: string): Promise<unknown>;
}

export function gestures(ctx: VerbContext): Gestures {
	const { service, agent, asList, here, needPens, needCanvas } = ctx;
	return {
		/** A card dragged: placed where it was let go, on the canvas on screen. */
		move: async (path: string, at: { x: number; y: number }) => {
			const card = service.move(agent.id, path, at);
			agent.acted?.("move", card.path);
			return withBox(card);
		},

		/**
		 * A card dragged to a new size: on this canvas's canvas, and in its file, so it comes at that size
		 * where a canvas places it next.
		 *
		 * - **Clamped**: 320 wide is about the narrowest card, and the ceiling is well past the tallest
		 *   card in the deck; a resize is not the place to find a typo.
		 * - **The canvas first, then the file.** The file's write is what the canvas on screen waits for
		 *   to let go of the box it was dragged to, and it reads the card's size there from the canvas:
		 *   the other way round, a card made shorter came back at its old height for a moment.
		 */
		resize: async (path: string, size: { w?: number; h?: number }) => {
			if (!size || (size.w === undefined && size.h === undefined)) throw new Error("A resize needs a width, a height, or both");
			const file = service.fileCard(path);
			if (!file) throw new Error(`No such card: ${path}`);
			const bounded = (value: unknown, low: number, high: number) =>
				typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined;
			const w = bounded(size.w, 320, 4000);
			const h = bounded(size.h, 200, 8000);
			if (w === undefined && h === undefined) throw new Error("A resize needs a width, a height, or both, as numbers");
			const sized = { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) };
			agent.sized?.(path, { w: w ?? file.w, h: h ?? file.h });
			if ((w !== undefined && w !== file.w) || (h !== undefined && h !== file.h)) service.resize(path, sized);
			if (agent.person) service.wrote(path, "you");
			else agent.acted?.("resize", path);
			service.announce(agent.id, path);
			const now = here().find((one) => one.path === path);
			return { path, w: now?.w ?? w ?? file.w, h: now?.h ?? h ?? file.h };
		},

		/** Cards taken off the canvas, kept in its context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const up = agent.inPlay();
			agent.setInPlay(up.filter((playing) => !dropping.has(playing)));
			for (const one of dropping) if (up.includes(one)) agent.acted?.("hide", one);
		},

		/**
		 * Pen operations on the canvas's own drawing, applied together or not at all (`canvas.edit`).
		 * The person's own edits can be taken back with the canvas's undo; each item's new box comes back.
		 */
		edit: async (ops: readonly unknown[]) => {
			const pens = needPens();
			const cards = new Map(here().map((card) => [card.path, { x: card.x, y: card.y, w: card.w, h: card.h }]));
			const { entry, results } = pens.edit(needCanvas(), ops as readonly Op[], (path) => cards.get(path), agent.person ? { undoable: true } : undefined);
			const placed = placements(pens.files.withImported(needCanvas(), entry.doc), { theme: baseTheme(entry.doc, "light"), measure: serverText.measure });
			const answered = results.map((result) => {
				const box = result.op === "delete" ? undefined : boxOf(placed.get(result.id));
				return { ...result, ...(box ? { box } : {}) };
			});
			const touched = answered.filter((result) => result.box && !result.id.startsWith("board:"));
			if (touched.length > 0) agent.drew?.(needCanvas(), touched.map((result) => result.id), touched.map((result) => result.box!));
			return { rev: entry.rev, results: answered };
		},

		/** Put the conversation on another canvas, picked in the canvas manager (`agent.stage`): by its folder or its title. */
		open: async (name: string) => {
			if (typeof name !== "string" || !name.trim()) throw new Error("Name a canvas to open.");
			if (!agent.openCanvas) throw new Error("This conversation cannot change canvases.");
			const pens = service.pens;
			const asked = name.trim();
			const folder = pens && !pens.names().includes(asked) ? (pens.names().find((one) => pens.titleOf(one).toLowerCase() === asked.toLowerCase()) ?? asked) : asked;
			agent.openCanvas(folder);
			service.stagesChanged();
			return { stage: folder };
		},

		/** A new, empty canvas named from a title, opened for the conversation at once (`stage.new`). */
		newStage: async (title: string) => {
			if (typeof title !== "string" || !title.trim()) throw new Error("A new canvas needs a title.");
			if (!agent.newCanvas) throw new Error("This conversation cannot make canvases.");
			const made = agent.newCanvas(title.trim());
			service.stagesChanged();
			return { stage: made };
		},
	};
}
