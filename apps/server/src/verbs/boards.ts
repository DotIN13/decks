import { isCardPath } from "../deck/layout.ts";
import { makeCard } from "./board.ts";
import { withBox } from "./context.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Board files: list them, make one (a card now), size one on the canvas and in its file, and say which ones are yours. */
export function boardsVerbs(ctx: VerbContext): Pick<Stage, "boards" | "newBoard" | "resize" | "fit" | "report"> {
	const { service, agent, notes, asList, here, cornerOf, reportPlace } = ctx;
	return {
		/** Every board in the deck, placed as this agent's stage has them, with its box's two corners. */
		boards: async () => here().map(withBox),
		/**
		 * The old name for starting a board, kept one release: it writes a card now, as `card.create`
		 * does, in the caller's own canvas, and places it there at `at` (or beside what is there), as it
		 * always placed what it made. Returns the card's path.
		 *
		 * `template` and `kind` are still accepted rather than refused: this signature is in the
		 * `stage.d.ts` agents have already read, and a card is blank however it was asked for.
		 */
		newBoard: async (options: { title: string; template?: string; kind?: string; w?: number; h?: number; at?: { x1: number; y1: number } | { x: number; y: number } }) => {
			if (!options?.title?.trim()) throw new Error("A board needs a title");
			const named = cornerOf(options.at);
			if (options.template ?? options.kind) {
				notes.push("new cards are blank — there are no templates any more, so the shape asked for was ignored.");
			}
			const stageName = agent.stageName?.();
			if (!stageName) throw new Error("A card is made in a canvas, and you are on none: decks card create '{\"title\":\"…\",\"canvas\":\"<name>\"}' names one.");
			const { path, width } = makeCard(ctx, options, stageName);
			agent.setInPlay([...agent.inPlay(), path], named ? { [path]: named } : undefined);
			reportPlace(path, named);
			agent.acted?.("new", path);
			notes.push(
				`card width ${width}. One screen: about ${Math.round(width * 0.7)} px tall, about 120 words, body text 17px or larger and nothing under 14px. decks canvas fit will say which of these a card is over.`,
			);
			return path;
		},

		/**
		 * Set a board's size, in one call, without opening the file.
		 *
		 * Either dimension on its own is allowed, because the one that is usually wrong is
		 * the height.
		 */
		/**
		 * Size a board: on this stage's canvas, and in its file, so it comes at that size where a canvas
		 * places it next. The same for an agent and for the person dragging a corner:
		 *
		 * - **Clamped**: 320 wide is about the narrowest board the templates use, and the ceiling is
		 *   well past the tallest board in the deck; a resize is not the place to find a typo.
		 * - **The canvas first, then the file.** The file's write is what the canvas on screen waits for
		 *   to let go of the box it was dragged to, and it reads the board's size there from the
		 *   canvas: the other way round, a board made shorter came back at its old height for a moment.
		 * - A board that fills its frame has no size in its file to write.
		 */
		resize: async (path: string, size: { w?: number; h?: number }) => {
			if (!size || (size.w === undefined && size.h === undefined)) throw new Error("A resize needs a width, a height, or both");
			const file = service.fileBoard(path);
			if (!file) throw new Error(`No such board: ${path}`);
			const bounded = (value: unknown, low: number, high: number) =>
				typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined;
			const w = bounded(size.w, 320, 4000);
			const h = bounded(size.h, 200, 8000);
			if (w === undefined && h === undefined) throw new Error("A resize needs a width, a height, or both, as numbers");
			const by = () => (agent.person ? service.wrote(path, "you") : agent.acted?.("resize", path));
			const sized = { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) };
			agent.sized?.(path, { w: w ?? file.w, h: h ?? file.h });
			if (!file.fills && ((w !== undefined && w !== file.w) || (h !== undefined && h !== file.h))) service.resize(path, sized);
			by();
			service.announce(agent.id, path);
			const now = here().find((one) => one.path === path);
			return { path, w: now?.w ?? w ?? file.w, h: now?.h ?? h ?? file.h };
		},

		/**
		 * Size a board to its content on one canvas: the height, at the width the board has there.
		 *
		 * The canvas is named as `pen.read` names one (its name, its title, or `canvases/<name>/canvas.pen`),
		 * or is the one this agent's stage is showing. The width is never measured: it is the canvas's,
		 * and the height is measured at it. Both go to the board's file, as a person's resize writes
		 * them, and to that canvas; every other canvas keeps the size it has for the board.
		 */
		fit: async (path: string, options?: { margin?: number; canvas?: string }) => {
			const pens = service.pens;
			const asked = typeof options?.canvas === "string" ? options.canvas.trim().replace(/^canvases\//, "").replace(/\/canvas(\.pen)?$/, "") : undefined;
			const named = asked && pens ? (pens.names().includes(asked) ? asked : pens.names().find((one) => pens.titleOf(one).toLowerCase() === asked.toLowerCase())) : undefined;
			if (asked && !named) throw new Error(`No canvas is called "${options?.canvas}". decks canvas list names them, by name and title.`);
			const { board, content } = await fitOn(ctx, path, named, options?.margin);
			return { path: board.path, w: board.w, h: board.h, content };
		},

		/**
		 * Say which boards carry your work, without moving anything.
		 *
		 * `fit` and a one-board `show` already say it. This is for the rest: a board edited and
		 * left where it was, or several at once. You become each board's writer, and they are
		 * what a task you were handed lists as its boards.
		 */
		report: async (path: string | string[]) => {
			const paths = asList(path);
			for (const one of paths) {
				if (!here().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			for (const one of paths) agent.worked?.(one);
			return { reported: paths };
		},
	};
}


/**
 * Size a board to its content on one canvas: the height, at the width the board has there.
 *
 * The canvas is the one named, or the caller's own stage. The width is never measured: it is the
 * canvas's, and the height is measured at it. Both go to the board's file, as a person's resize
 * writes them, and to that canvas; every other canvas keeps the size it has for the board. What
 * the browser read goes into the call's notes, and is returned as one sentence too.
 */
export async function fitOn(ctx: VerbContext, asked: string, named: string | undefined, margin?: number | null): Promise<{ board: { path: string; w: number; h: number }; content: { w: number; h: number; page?: number }; canvas: string; said: string }> {
	const { service, agent, notes } = ctx;
	const pens = service.pens;
	const on = named ?? agent.stageName?.();
	// A board from elsewhere is the canvas's own copy of it (`StagePens.copyOf`): that is what is fitted.
	const path = on && pens ? pens.copyOf(on, asked) : asked;
	const held = on && pens ? pens.boards(on).find((one) => one.path === path) : undefined;
	if (!on || !held) throw new Error(`${path} is not on ${named ? `the canvas "${pens!.titleOf(named)}"` : "your canvas"}, so there is no width to fit it at. Put it there first (${isCardPath(path) ? `decks canvas insert --type card --card ${path}` : `decks canvas insert '{"type":"board","board":"${path}"}'`}), or name a canvas that holds it with --canvas.`);
	const own = !named || named === agent.stageName?.();
	const before = notes.length;
	const { board, content, reading, views } = await service.fit(path, { ...(margin === undefined || margin === null ? {} : { margin }), w: held.w });
	if (!own) pens!.sizeBoard(on, board.path, { w: board.w, h: board.h });
	else agent.sized?.(board.path, { w: board.w, h: board.h });
	agent.worked?.(board.path);
	agent.acted?.("resize", board.path);
	/*
	 * What the browser read, said as sentences, so the check costs no screenshot.
	 *
	 * An agent told "one screen, about 120 words, nothing under 14px" used to find out
	 * whether it had managed it by driving Playwright and reading a picture, which was
	 * a third of what a board cost. The frame that measures the height can count the
	 * words and find the smallest type in the same pass, so `decks.canvas.fit` says them. Only what
	 * is over is mentioned: a board inside all three gets the numbers and no advice.
	 */
	const screen = Math.round(board.w * 0.72);
	const over: string[] = [];
	if (content.h > screen) over.push(`${content.h} px tall, which is more than one screen (about ${screen} px at this width)`);
	if (reading.words !== undefined && reading.words > 170) over.push(`${reading.words} words, where about 120 is what gets read`);
	if (reading.minFont !== undefined && reading.minFont < 14) over.push(`its smallest text is ${reading.minFont}px, and under 14px is not readable once the board is fitted to a window`);
	if (reading.overflowX !== undefined) over.push(`${reading.overflowX} px wider than the board, so its right edge is cut off: something (a table, a row, a long word) does not fit the width`);
	if (reading.cut !== undefined) over.push(`${reading.cut} box${reading.cut === 1 ? "" : "es"} on it cut off their own content: a fixed-height panel is too short for what is in it, and a board cannot scroll`);
	if (reading.overlaps !== undefined) over.push(`${reading.overlaps} pair${reading.overlaps === 1 ? "" : "s"} of labels in a drawing overlap each other: move them apart or shorten them, then look at it with a screenshot`);
	for (const view of views?.views ?? [])
			over.push(
				`after pressing "${view.label}" it is ${view.h} px tall${view.overflowX ? ` and ${view.overflowX} px too wide` : ""}, where it opens at ${views?.opening} px: a board's height is measured in the view it opens on, so a taller view has its last lines cut. Give the panel a min-height, or move that view to its own board`,
			);
	for (const error of views?.errors ?? []) over.push(`a script on it throws: ${error}`);
	if (over.length) notes.push(`This board is ${over.join("; ")}. Cut it, enlarge the type, or move the second idea to its own board. A document the person asked for in full (a message, a list, code) is exempt from the height and the word count.`);
	else if (reading.words !== undefined) notes.push(`One screen: ${content.h} px tall, ${reading.words} words${reading.minFont === undefined ? "" : `, smallest text ${reading.minFont}px`}${views ? `, ${views.controls} control${views.controls === 1 ? "" : "s"} pressed and every view fits` : ""}. Nothing to fix.`);
	return { board: { path: board.path, w: board.w, h: board.h }, content, canvas: on, said: notes.slice(before).join(" ") };
}
