import { isCardPath } from "../deck/layout.ts";
import type { VerbContext } from "./context.ts";

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
