import { probes } from "../base/debug.ts";
import type { Page } from "@decks/protocol";
import { createEffect, createMemo, createSelector, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { LIVE_ZOOM, toWorld, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { chooseAwake, NO_AWAKE, sameAwake, type Awake, type AwakeItem } from "../items/awake.ts";
import { missing } from "../base/missing.ts";
import { BoxIndex } from "../render/spatial.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createAwakeCards` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface AwakeCardsNeeds {
	readonly ctl: CameraController;
	readonly view: () => Viewport;
	readonly props: CanvasViewProps;
	readonly BUDGET: { live: { card: number; app: number; document: number; }; kept: number; };
	readonly editor: CanvasEditor;
	readonly liveCards: Accessor<ReadonlyMap<string, number>>;
	readonly picturedNow: Accessor<ReadonlySet<string>>;
}

export function createAwakeCards(d: AwakeCardsNeeds) {
	/** The camera boards and their bookkeeping see: the settled one (`camera/controller.ts`). */
	const pageCamera = d.ctl.settled;

	/**
	 * The boards and cards within a window of the screen, by path, from the R-tree, as of the settled
	 * camera. A new set only when one enters or leaves it, so what reads it through `isNear` hears only
	 * about its own item, and a pan that keeps the same ones near reaches none of them.
	 */
	const nearPaths = createMemo<ReadonlySet<string>>(
		() => {
			if (d.view().width === 0) return new Set();
			const boards = d.props.boards;
			return new Set(pageIndex().search(reach()).map((at) => boards[at]!.path));
		},
		new Set(),
		{ equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)) },
	);

	/** Whether a board is in `nearPaths`: each board is told only when its own answer changes. */
	const isNear = createSelector(nearPaths, (path: string, near) => near.has(path));

	/** On screen, or within a window of it: the R-tree's answer, not each board's own arithmetic. */
	const isVisible = (board: Page) => isNear(board.path);

	/** At or above the live zoom (`LIVE_ZOOM`): items may be awake, and files near the window show live. */
	const liveNow = createMemo(() => d.ctl.zoom() >= LIVE_ZOOM);

	const pageIndex = createMemo(() => new BoxIndex(d.props.boards));

	const pageSlot = createMemo(() => new Map(d.props.boards.map((board, i) => [board.path, i])));

	/** The stage rectangle `isVisible` answers for: the window, and one window more on each side. */
	const reach = () => {
		const v = d.view();
		const cam = pageCamera();
		const corner = toWorld(cam, v, { x: -v.width, y: -v.height });
		return { x: corner.x, y: corner.y, w: (3 * v.width) / cam.zoom, h: (3 * v.height) / cam.zoom };
	};

	/** The placed items as the chooser sees them: the same order as `props.boards` and `pageIndex`, each with its kind. */
	// A card its host has no copy of (`base/missing.ts`) is never woken, as a board is not: its page would be blank paper, and the sheet paints why.
	const awakeItems = createMemo<readonly AwakeItem[]>(() => d.props.boards.map((board) => ({ path: board.path, x: board.x, y: board.y, w: board.w, h: board.h, kind: board.card ? (missing().has(board.path) ? undefined : "card") : board.item })));

	/*
	 * Which items are awake (`items/awake.ts`): chosen from the camera at rest, so nothing mounts or
	 * unmounts while a pinch, a pan or a glide moves it; the nearest the middle of the screen, each kind
	 * cut to this device's budget, none below `LIVE_ZOOM`, and the selected item at any zoom. Every other
	 * card, app or document sleeps as its picture. A board is never awake: the sheet draws it as its
	 * picture, and the canvas runs no board's page.
	 */
	const cardChoice = createMemo<Awake>((was) => {
		const v = d.view();
		if (v.width === 0) return was;
		const next = chooseAwake({ index: pageIndex(), items: awakeItems(), rest: d.ctl.rest(), view: v, selected: d.props.selected, budget: d.BUDGET, was });
		return sameAwake(was, next) ? was : next;
	}, NO_AWAKE);

	/** For the browser checks: the items chosen awake and kept asleep, of every kind. */
	probes.liveCards = () => untrack(cardChoice);

	probes.awake = () => ({ ...untrack(cardChoice), selected: d.props.selected, hover: untrack(d.editor.hoverPicture), held: [...untrack(d.editor.heldPages)], shown: [...untrack(d.liveCards).entries()].map(([path, n]) => `${path}:${n}`), leaving: [...untrack(leaving).keys()] });

	const livePaths = createMemo<ReadonlySet<string>>(() => new Set(cardChoice().live), new Set(), {
		equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)),
	});

	/** Cards let go lately and kept with their roots, asleep (`cardChoice().kept`): waking one again is instant. */
	const keptPaths = createMemo<ReadonlySet<string>>(() => new Set(cardChoice().kept), new Set(), {
		equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)),
	});

	/*
	 * Cards just let go, kept on the page until the sheet draws their pictures over them: put away at once,
	 * a card left a frame or more of bare canvas in its place (the sheet still had a hole there, or its
	 * picture was not drawn yet), a flicker each time one went to sleep. A second at most.
	 */
	const [leaving, setLeaving] = createSignal<ReadonlyMap<string, number>>(new Map());

	let awakeBefore = new Set<string>();

	createEffect(() => {
		const now = new Set([...livePaths(), ...keptPaths()]);
		const gone = [...awakeBefore].filter((path) => !now.has(path));
		awakeBefore = now;
		const at = performance.now();
		setLeaving((was) => {
			const next = new Map([...was].filter(([path]) => !now.has(path)));
			for (const path of gone) next.set(path, at);
			return next.size === was.size && [...next.keys()].every((path) => was.has(path)) ? was : next;
		});
	});

	// One timer for the card that leaves soonest, not one more for every pass that let none go.
	let expiry: ReturnType<typeof setTimeout> | undefined;
	const expire = () => {
		expiry = undefined;
		const was = untrack(leaving);
		const next = new Map([...was].filter(([, since]) => performance.now() - since < 1000));
		if (next.size !== was.size) setLeaving(next);
		else if (was.size) expiry = setTimeout(expire, 50);
	};
	onCleanup(() => clearTimeout(expiry));
	createEffect(() => {
		const drawn = d.picturedNow();
		const left = leaving();
		if (left.size === 0) return;
		const at = performance.now();
		const next = new Map([...left].filter(([path, since]) => !drawn.has(path) && at - since < 1000));
		if (next.size !== left.size) setLeaving(next);
		else if (expiry === undefined) expiry = setTimeout(expire, Math.max(0, Math.min(...left.values()) + 1000 - at));
	});

	const leavingPaths = createMemo<ReadonlySet<string>>(() => new Set(leaving().keys()), new Set(), {
		equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)),
	});

	const isLeaving = createSelector(leavingPaths, (path: string, paths) => paths.has(path));

	const isPictured = createSelector(d.picturedNow, (path: string, paths) => paths.has(path));

	const isKept = createSelector(keptPaths, (path: string, paths) => paths.has(path));

	/** Whether a card is awake: each slot is told only when its own answer changes. */
	const isLive = createSelector(livePaths, (path: string, paths) => paths.has(path));

	return {
		pageIndex,
		isLive,
		pageSlot,
		livePaths,
		keptPaths,
		leavingPaths,
		isVisible,
		isKept,
		isLeaving,
		isPictured,
		isNear,
		liveNow,
	};
}
