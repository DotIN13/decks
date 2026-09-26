/**
 * Where a board goes when nobody said where.
 *
 * One rule, in one place, because the app has five ways for a board to arrive on a stage —
 * an agent's `stage.newBoard`, `stage.show`, the ＋ in the corner, a board picked out of the
 * panel, a mirror — and each of them used to fall through to the deck's own auto-layout, which
 * put a new board below every board the stage had ever had a place for: a column a million
 * pixels tall.
 *
 * The rule here is: **a board joins the stage beside the stage's newest board, in the nearest
 * open slot**, clear of every board and every drawn item already there. The first board on an
 * empty stage goes at the origin.
 *
 * **It reads what is on the stage, and nothing about who is watching.** The anchor used to be the
 * middle of the camera, and that broke twice: first a view of another canvas, then the view of
 * whichever browser panned last, on any stage. Both times boards landed tens of thousands of
 * pixels from their own. A stage's contents are the same for every viewer, so the answer is too, and no
 * camera is taken as input anywhere in this file. Keep it that way: arriving where the person is
 * looking is the camera's job (`stage.show` moves it onto the board), not the placement's.
 *
 * Nothing here reads or writes state. The caller is `agents/session.ts`, which owns the places,
 * the list of what is on the stage and the drawing around it.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Space left between boards. The same number `deck/loader.ts` lays its fallback rows on. */
export const GUTTER = 160;

const touching = (a: Box, b: Box, gap: number): boolean =>
	a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The one rectangle that holds all of them. */
export function bounds(boxes: readonly Box[]): Box | undefined {
	if (boxes.length === 0) return undefined;
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.w));
	const bottom = Math.max(...boxes.map((box) => box.y + box.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The nearest free spot to an anchor, for a board of this size.
 *
 * The candidates are the anchor itself and the edges of the boards already on the canvas — to
 * the right of each, below each, to the left of each — so a board that cannot land where it was
 * aimed lands *tidily* beside something rather than nudged a few pixels clear of it.
 *
 * The nearest of those to the anchor wins, which works out as **the short way round whatever is
 * in the way**: past the side of a board that is taller than it is wide, underneath one that is
 * wider than it is tall. That is what keeps a canvas compact instead of growing in one direction.
 * Equal distances go to the right, and when every candidate is taken the board goes to the right
 * of everything.
 */
export function freeSpot(anchor: { x: number; y: number }, size: { w: number; h: number }, occupied: readonly Box[]): { x: number; y: number } {
	const middle = (spot: { x: number; y: number }) => ({ x: spot.x + size.w / 2, y: spot.y + size.h / 2 });
	const aimed = { x: Math.round(anchor.x - size.w / 2), y: Math.round(anchor.y - size.h / 2) };
	const candidates = [
		aimed,
		...occupied.flatMap((box) => [
			{ x: box.x + box.w + GUTTER, y: box.y },
			{ x: box.x, y: box.y + box.h + GUTTER },
			{ x: box.x - size.w - GUTTER, y: box.y },
		]),
	];
	const free = candidates.filter((spot) => !occupied.some((box) => touching({ ...spot, ...size }, box, GUTTER / 2)));
	let best: { x: number; y: number } | undefined;
	let closest = Infinity;
	for (const spot of free) {
		const from = middle(spot);
		const distance = Math.hypot(from.x - anchor.x, from.y - anchor.y);
		if (distance < closest) {
			closest = distance;
			best = spot;
		}
	}
	if (best) return { x: Math.round(best.x), y: Math.round(best.y) };
	const cluster = bounds(occupied);
	return cluster ? { x: Math.round(cluster.x + cluster.w + GUTTER), y: Math.round(cluster.y) } : aimed;
}

/**
 * Where a board joins a stage: just right of the stage's newest board, top edges level, or the
 * nearest open slot to that when it is taken. With nothing on the stage, the origin.
 *
 * `newest` is the board last put on the stage, not the right-hand end of all of them: "beside
 * the board you were just shown" is the near that matters, and a row that has wrapped back or a
 * board dragged away should not drag every newcomer to the far edge.
 */
export function joinSpot(size: { w: number; h: number }, newest: Box | undefined, occupied: readonly Box[]): { x: number; y: number } {
	const aim = newest
		? { x: newest.x + newest.w + GUTTER + size.w / 2, y: newest.y + size.h / 2 }
		: { x: size.w / 2, y: size.h / 2 };
	return freeSpot(aim, size, occupied);
}

/**
 * Is the place a board already has near enough to keep when it joins the canvas?
 *
 * Yes when it sits within a board's length of the boards on the stage — which is what makes hiding a board and playing it again put it back
 * in its own hole rather than at the end of the row. No when it is neither: that is a board still
 * carrying a place from the old deck-wide auto-layout, arriving a million pixels from anything.
 *
 * **An empty canvas keeps it too**, which is the case that has to be argued for rather than
 * assumed. There is nothing there to be near and so nothing to be far from, and a place is
 * somebody's decision — a drag, a drop, a deck laid out on purpose. Moving it here was worse than
 * useless: clearing the stage and playing one board back moved it, and every arrangement was one
 * clear-and-replay from being rebuilt. Nothing is lost by keeping it, because the camera arrives
 * on a board you asked for.
 */
export function keepsPlace(box: Box, onCanvas: readonly Box[]): boolean {
	const cluster = bounds(onCanvas);
	if (!cluster) return true;
	const reach = GUTTER + Math.max(box.w, box.h);
	return touching(box, cluster, reach);
}

/**
 * The places a set of boards joining a canvas should take, and only the ones that need one.
 *
 * The three cases in order: a board with no place gets the nearest open slot beside the stage's
 * newest board; a board whose place is near the boards already on the stage keeps it; a board
 * whose place is far from all of them is placed again. What is returned is the new spots,
 * so the caller writes them into the agent's stage.
 *
 * Pure, so the rule is tested apart from the stage that uses it.
 */
export function joinPlaces(options: {
	wanted: readonly string[];
	playing: readonly string[];
	places: Readonly<Record<string, { x: number; y: number }>>;
	size: (path: string) => { w: number; h: number } | undefined;
	/**
	 * What else is drawn on the stage (notes, shapes, frames, text), which a board must not land
	 * on either. Boards themselves come from `places`.
	 */
	drawn?: readonly Box[];
	/**
	 * Where the caller said a joining board goes, top-left corner. Taken as given, near or far,
	 * clear or not: an agent that names a place has decided, and saying what it sits on is the
	 * tool's job (`stage/tool.ts`), not a reason to move it here.
	 */
	at?: Readonly<Record<string, { x: number; y: number }>>;
}): Record<string, { x: number; y: number }> {
	const { wanted, playing, places, size, drawn = [], at = {} } = options;
	const joining = wanted.filter((path) => !playing.includes(path) && size(path) !== undefined);
	const spots: Record<string, { x: number; y: number }> = {};
	if (joining.length === 0) return spots;
	const boxOf = (path: string): Box | undefined => {
		const dimensions = size(path);
		const at = places[path];
		return dimensions && at ? { x: at.x, y: at.y, ...dimensions } : undefined;
	};
	const onCanvas = wanted
		.filter((path) => playing.includes(path))
		.map(boxOf)
		.filter((box): box is Box => box !== undefined);
	/*
	 * What a newcomer has to keep clear of: the boards on the canvas, and any board that is merely
	 * *near* — placed, hidden, and close enough that playing it again would put it back where it
	 * is. Everything else is filtered out by the same test, which keeps this cheap on a canvas that
	 * still carries a place for hundreds of boards.
	 */
	const occupied = [...onCanvas, ...drawn];
	for (const path of Object.keys(places)) {
		if (wanted.includes(path)) continue;
		const box = boxOf(path);
		if (box && keepsPlace(box, onCanvas)) occupied.push(box);
	}
	/* The named places first, so the boards placed for themselves keep clear of them. */
	for (const path of joining) {
		const dimensions = size(path);
		const named = at[path];
		if (!dimensions || !named) continue;
		const spot = { x: Math.round(named.x), y: Math.round(named.y) };
		spots[path] = spot;
		onCanvas.push({ ...spot, ...dimensions });
		occupied.push({ ...spot, ...dimensions });
	}
	for (const path of joining) {
		const dimensions = size(path);
		if (!dimensions || at[path]) continue;
		const held = places[path];
		if (held && keepsPlace({ ...held, ...dimensions }, onCanvas)) {
			onCanvas.push({ ...held, ...dimensions });
			occupied.push({ ...held, ...dimensions });
			continue;
		}
		const spot = joinSpot(dimensions, onCanvas.at(-1), occupied);
		spots[path] = spot;
		// Both lists: the newcomer is part of the canvas the next one is measured against, and
		// part of what it has to miss.
		onCanvas.push({ ...spot, ...dimensions });
		occupied.push({ ...spot, ...dimensions });
	}
	return spots;
}
