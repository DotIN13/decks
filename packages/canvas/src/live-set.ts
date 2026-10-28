/**
 * Which boards have a page, chosen each time the camera rests (`Stage`'s `livePaths`).
 *
 * The selected board first, at any zoom. Then, at the live zoom, every board that already had its page
 * and still meets the window, so a short pan keeps what is up; then the nearest new ones, up to the
 * limit. A board let go keeps its page hidden for a while (`keep` of them, the latest first): panning
 * back to it shows it at once instead of loading it again. On an iPad mini, choosing the six nearest
 * afresh at each rest started 152 board scripts in five seconds of panning back and forth.
 */
export interface LiveSet {
	/** Boards with their page showing. */
	live: readonly string[];
	/** Boards whose page is kept loaded but hidden, the latest let go first. */
	hidden: readonly string[];
}

export interface LiveChoice {
	was: LiveSet;
	/** The selected board, live at any zoom. */
	selected?: string | undefined;
	/** The camera is at the live zoom. */
	liveZoom: boolean;
	/** Boards near enough to be chosen, each with its distance from the middle of the window. */
	near: ReadonlyArray<{ path: string; distance: number }>;
	/** Whether a board meets the window. */
	inWindow: (path: string) => boolean;
	/** Whether a board is still on the canvas. */
	exists: (path: string) => boolean;
	/** How many pages show at once. */
	limit: number;
	/** How many pages let go are kept hidden. */
	keep: number;
}

export const EMPTY_LIVE: LiveSet = { live: [], hidden: [] };

export function chooseLive(choice: LiveChoice): LiveSet {
	const { was, selected, limit } = choice;
	const live: string[] = [];
	const add = (path: string) => {
		if (live.length < limit && !live.includes(path)) live.push(path);
	};
	if (selected !== undefined && choice.exists(selected)) live.push(selected);
	if (choice.liveZoom) {
		const distance = new Map(choice.near.map((one) => [one.path, one.distance]));
		// Kept: already up and still on screen, the nearest first should there be more than the limit.
		const kept = was.live.filter((path) => choice.exists(path) && choice.inWindow(path));
		kept.sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity));
		kept.forEach(add);
		choice.near.filter((one) => choice.exists(one.path)).sort((a, b) => a.distance - b.distance).forEach((one) => add(one.path));
	}
	// Let go now first, then those let go before, each once and only while it is on the canvas.
	const hidden: string[] = [];
	for (const path of [...was.live, ...was.hidden]) {
		if (hidden.length >= choice.keep) break;
		if (!live.includes(path) && !hidden.includes(path) && choice.exists(path)) hidden.push(path);
	}
	return { live, hidden };
}

/** Whether two choices hold the same boards, so a rest that changes nothing reaches no board. */
export function sameLive(a: LiveSet, b: LiveSet): boolean {
	const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((path) => y.includes(path));
	return same(a.live, b.live) && same(a.hidden, b.hidden);
}
