import type { Camera } from "@decks/protocol";
import { LIVE_ZOOM, toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import type { Rect } from "../render/spatial.ts";

/**
 * Which placed items are awake, chosen from the camera at rest (`camera/controller.ts`, `rest`): one
 * rule for a card, an app and a document.
 *
 * An awake item is a surface of its own on the page: a card's root of elements, an app's sandboxed
 * iframe, a document's editor. Each is fetched, laid out, painted and, while the camera moves, either
 * stretched on a layer or covered by its picture. Every other item is its picture on the sheet. So the
 * awake ones are few, and chosen only when the camera has stopped, never while it moves:
 *
 * - **Near the window**: items touching the window or half a window round it, from the R-tree.
 * - **Nearest the middle first**: by how far the item is from the middle of the screen, 0 for one
 *   under it; the same distance in file order, so a choice is stable.
 * - **Within its kind's budget** (`render/device.ts`, `AWAKE`): so many cards, so many apps, so many documents.
 * - **None below `LIVE_ZOOM`**: under 40% every item is its picture, whatever its kind.
 * - **The selected item** is awake at any zoom and wherever it is, beside its kind's budget: it is
 *   what the person is working on.
 *
 * `kept` are the items let go most recently, the latest first, up to the budget's `kept`: their
 * surfaces stay on the page, hidden under their pictures, so coming back to one is instant and an
 * app never reloads under you.
 *
 * Pure: no page, no signals, so it is tested on its own (`awake.test.ts`).
 */
export type Kind = "card" | "app" | "document";

export interface AwakeItem extends Rect {
	path: string;
	/** What the item is; an old board, which is only ever its picture, has none. */
	kind?: Kind | undefined;
}

export interface Awake {
	/** Awake items, by path: the selected one first, then nearest the middle first. */
	live: readonly string[];
	/** Items let go, kept with their surfaces, the latest first. */
	kept: readonly string[];
}

export const NO_AWAKE: Awake = { live: [], kept: [] };

export interface AwakeBudget {
	/** How many of each kind are awake at once besides the selected one. */
	live: Record<Kind, number>;
	/** How many let go are kept, of any kind. */
	kept: number;
}

export interface AwakeChoice {
	/** What the R-tree answers: indices into `items` touching a rectangle (`render/spatial.ts`, `BoxIndex`). */
	index: { search(rect: Rect): number[] };
	/** The placed items the index was built over. */
	items: ReadonlyArray<AwakeItem>;
	/** The camera at rest. */
	rest: Camera;
	view: Viewport;
	/** The selected item's path, if any: awake at any zoom when it has a kind. */
	selected?: string | undefined;
	budget: AwakeBudget;
	/** The last choice, for `kept`. */
	was?: Awake | undefined;
}

/** How far round the window an item is near: half a window on each side. */
const MARGIN = 0.5;

export function chooseAwake(choice: AwakeChoice): Awake {
	const { index, items, rest, view, selected, budget } = choice;
	const live: string[] = [];
	if (selected !== undefined) {
		const at = items.findIndex((item) => item.path === selected);
		if (at >= 0 && items[at]!.kind) live.push(selected);
	}
	if (rest.zoom >= LIVE_ZOOM && view.width > 0 && view.height > 0) {
		const corner = toWorld(rest, view, { x: -view.width * MARGIN, y: -view.height * MARGIN });
		const span = 1 + 2 * MARGIN;
		const near = index.search({ x: corner.x, y: corner.y, w: (span * view.width) / rest.zoom, h: (span * view.height) / rest.zoom });
		const mx = view.width / 2;
		const my = view.height / 2;
		const ranked: Array<{ path: string; kind: Kind; d: number; at: number }> = [];
		for (const at of near) {
			const item = items[at];
			if (!item?.kind || item.path === selected) continue;
			const a = toScreen(rest, view, { x: item.x, y: item.y });
			const b = toScreen(rest, view, { x: item.x + item.w, y: item.y + item.h });
			// From the middle of the screen to the nearest point of the item: 0 under it.
			const dx = Math.max(a.x - mx, 0, mx - b.x);
			const dy = Math.max(a.y - my, 0, my - b.y);
			ranked.push({ path: item.path, kind: item.kind, d: Math.hypot(dx, dy), at });
		}
		ranked.sort((p, q) => p.d - q.d || p.at - q.at);
		const taken: Record<Kind, number> = { card: 0, app: 0, document: 0 };
		for (const one of ranked) {
			if (taken[one.kind] >= budget.live[one.kind]) continue;
			taken[one.kind]++;
			live.push(one.path);
		}
	}
	const exists = new Set(items.filter((item) => item.kind).map((item) => item.path));
	const kept: string[] = [];
	const was = choice.was ?? NO_AWAKE;
	for (const path of [...was.live, ...was.kept]) {
		if (kept.length >= budget.kept) break;
		if (!live.includes(path) && !kept.includes(path) && exists.has(path)) kept.push(path);
	}
	return { live, kept };
}

/** Whether two choices hold the same items in the same roles, so a rest that changes nothing reaches no item. */
export function sameAwake(a: Awake, b: Awake): boolean {
	const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((path) => y.includes(path));
	return same(a.live, b.live) && same(a.kept, b.kept);
}

/**
 * The state one placed item is in, from what the stage knows of it: the five states of the one
 * lifecycle, as the item's node is marked (`data-state`) and the checks read it.
 *
 * - `picture`: not awake; the sheet draws its picture (or its placeholder, until one comes).
 * - `waking`: chosen awake, its surface made but not yet shown: still covered by its picture.
 * - `live`: its surface shows, and the sheet has a hole for it.
 * - `kept`: let go lately, its surface kept hidden under its picture.
 * - `leaving`: let go, waiting for the sheet to draw its picture over it before its surface goes.
 */
export type SurfaceState = "picture" | "waking" | "live" | "kept" | "leaving";

export function surfaceState(of: { live: boolean; kept: boolean; leaving: boolean; shown: boolean }): SurfaceState {
	if (of.live) return of.shown ? "live" : "waking";
	if (of.kept) return "kept";
	if (of.leaving) return "leaving";
	return "picture";
}
