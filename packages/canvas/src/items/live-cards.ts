import type { Camera } from "@decks/protocol";
import { CARD_LIVE_ZOOM, toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import type { Rect } from "../render/spatial.ts";

/**
 * Which cards are live, chosen from the camera at rest (`camera/controller.ts`, `rest`).
 *
 * A live card is its own root of elements on the page (`card.ts`): fetched, parsed, its scripts run,
 * laid out and painted at every step of a pinch. Every other card is its picture on the sheet. So the
 * live ones are few and chosen only when the camera has stopped, never while it moves:
 *
 * - **Near the window**: cards touching the window or half a window round it, from the R-tree.
 * - **Nearest the middle first**: by how far the card is from the middle of the screen, 0 for one
 *   under it, and cut to the device's budget (`render/device.ts`, `CARDS`).
 * - **None below `CARD_LIVE_ZOOM`**: under 40% every card is its picture.
 * - **The selected card** is live at any zoom and wherever it is, beside the budget: it is what the
 *   person is working on.
 *
 * `kept` are the cards let go most recently, the latest first, up to the budget's `kept`: their roots
 * may stay, hidden, so that coming back to one is instant (`wake-queue.ts`).
 *
 * Pure: no page, no signals, so it is tested on its own (`live-cards.test.ts`).
 */
export interface LiveCards {
	/** Live cards, by path: the selected one first, then nearest the middle first. */
	live: readonly string[];
	/** Cards let go, kept asleep with their roots, the latest first. */
	kept: readonly string[];
}

export const NO_LIVE_CARDS: LiveCards = { live: [], kept: [] };

export interface LiveCardsChoice {
	/** What the R-tree answers: indices into `items` touching a rectangle (`render/spatial.ts`, `BoxIndex`). */
	index: { search(rect: Rect): number[] };
	/** The placed items the index was built over, cards and not: only cards are chosen. */
	items: ReadonlyArray<Rect & { path: string; card?: boolean | undefined }>;
	/** The camera at rest. */
	rest: Camera;
	view: Viewport;
	/** The selected item's path, if any: live at any zoom when it is a card. */
	selected?: string | undefined;
	/** How many are live besides the selected one, and how many let go are kept. */
	budget: { live: number; kept: number };
	/** The last choice, for `kept`. */
	was?: LiveCards | undefined;
}

/** How far round the window a card is near: half a window on each side. */
const MARGIN = 0.5;

export function chooseLive(choice: LiveCardsChoice): LiveCards {
	const { index, items, rest, view, selected, budget } = choice;
	const live: string[] = [];
	if (selected !== undefined) {
		const at = items.findIndex((item) => item.path === selected);
		if (at >= 0 && items[at]!.card) live.push(selected);
	}
	if (rest.zoom >= CARD_LIVE_ZOOM && view.width > 0 && view.height > 0 && budget.live > 0) {
		const corner = toWorld(rest, view, { x: -view.width * MARGIN, y: -view.height * MARGIN });
		const span = 1 + 2 * MARGIN;
		const near = index.search({ x: corner.x, y: corner.y, w: (span * view.width) / rest.zoom, h: (span * view.height) / rest.zoom });
		const mx = view.width / 2;
		const my = view.height / 2;
		const ranked: Array<{ path: string; d: number; at: number }> = [];
		for (const at of near) {
			const item = items[at];
			if (!item?.card || item.path === selected) continue;
			const a = toScreen(rest, view, { x: item.x, y: item.y });
			const b = toScreen(rest, view, { x: item.x + item.w, y: item.y + item.h });
			// From the middle of the screen to the nearest point of the card: 0 under it.
			const dx = Math.max(a.x - mx, 0, mx - b.x);
			const dy = Math.max(a.y - my, 0, my - b.y);
			ranked.push({ path: item.path, d: Math.hypot(dx, dy), at });
		}
		// Nearest first; the same distance (two under the middle) in file order, so a choice is stable.
		ranked.sort((p, q) => p.d - q.d || p.at - q.at);
		for (const one of ranked.slice(0, budget.live)) live.push(one.path);
	}
	const exists = new Set(items.filter((item) => item.card).map((item) => item.path));
	const kept: string[] = [];
	const was = choice.was ?? NO_LIVE_CARDS;
	for (const path of [...was.live, ...was.kept]) {
		if (kept.length >= budget.kept) break;
		if (!live.includes(path) && !kept.includes(path) && exists.has(path)) kept.push(path);
	}
	return { live, kept };
}

/** Whether two choices hold the same cards in the same roles, so a rest that changes nothing reaches no card. */
export function sameLive(a: LiveCards, b: LiveCards): boolean {
	const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((path) => y.includes(path));
	return same(a.live, b.live) && same(a.kept, b.kept);
}
