import { probes } from "../base/debug.ts";
import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor, type Component } from "solid-js";
import { toScreen, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import type { ItemSlotProps } from "../items/item-slot-props.ts";
import { AWAKE, DEVICE, ENGINE, MOVING } from "../render/device.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import { createItemNodes } from "./item-nodes.tsx";
import { createCardSizing } from "./card-sizing.ts";
import { createPageNode } from "./page-node.tsx";
import { createLiveFiles } from "./live-files.ts";
import { createRendered } from "./rendered.ts";
import { createAwakeCards } from "./awake-cards.ts";
import { createCovering } from "./covering.ts";
import { createPlayingBox } from "./playing-box.ts";
import { createAppStates } from "./app-states.ts";
import { createMedia } from "./media.ts";

/** What the items layer needs of the stage around it. */
type ItemsLayerDeps = {
	props: CanvasViewProps;
	/** The host's slot for one placed item (`props.frame`, read once). */
	Frame: Component<ItemSlotProps>;
	/** The stage element, set once it is mounted. */
	element: () => HTMLDivElement | undefined;
	ctl: CameraController;
	view: () => Viewport;
	editor: CanvasEditor;
	penLayer: CanvasEngine;
	/** Counted up each time the engine lays the drawing out. */
	penDrawn: Accessor<number>;
	/** A writer's colour as the sheet can paint it (`CanvasView.tsx`). */
	resolveColour: (colour: string) => string;
	/** Fit boxes into the canvas column (`CanvasView.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** What an item's slot asks of the stage's fingers (`input.ts`). */
	gestures: ItemSlotProps["gestures"];
};

/** A file shown live (`liveFiles`): which item, what it is, and its deck path. */
export type LiveFile = { id: string; file: string; name: string };

/**
 * The placed items: cards, documents, apps and boards, which of them are near, have a slot and are
 * awake, how the sheet draws each, their sizes easing, the SVGs shown live, and the one film or sound
 * playing. Made inside `CanvasView`, after the editor, which it reads.
 */
export function createItemsLayer(deps: ItemsLayerDeps) {
	const { props, Frame, ctl, view, editor, penLayer, penDrawn, resolveColour, frame, gestures } = deps;
	const { moving, scaling, gliding, panning, push: pushCamera } = ctl;
	/** How many of each kind are awake at once besides the selected one, and how many let go are kept: this device's (`render/device.ts`). */
	const BUDGET = AWAKE[DEVICE];
	/**
	 * A pinch on pictures: while the scale moves, the awake cards are hidden and the sheet draws each as
	 * its picture, so the page stretches one sheet and lays out, paints and layers no card.
	 *
	 * By the engine's table (`render/device.ts`, `MOVING`): off everywhere today. Measured in a simulated
	 * iPad (`scripts/card-zoom.mjs`, Playwright's iPad Pro 11, CPU 4×, 3 cards awake): it changed nothing
	 * a pinch costs. Late frames in WebKit 2.0 and 2.0 per pinch off against 2.0 and 0.2 on, noise
	 * either way; Chromium's paint, raster and layer work 4, 15 and 7 ms per pinch off, 5, 14 and 7 on;
	 * the main thread's 71–98 ms off, 84–117 on, since each pinch tells the engine twice that its cards
	 * changed. `?card-pictures=1` or `=0` in the page's address tries the other way, for a measure on a real device.
	 */
	const PINCH_ON_PICTURES = (() => {
		const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("card-pictures");
		return asked === "1" ? true : asked === "0" ? false : MOVING[ENGINE].card === "cover";
	})();
	/** Whether an app's window or a document's editor is covered by its picture while the camera moves (`MOVING`). */
	const COVER = { app: MOVING[ENGINE].app === "cover", document: MOVING[ENGINE].document === "cover" };
	/** The awake cards are hidden: from the first step of a scale until it rests (`canvas.css`, `data-card-pictures`). */
	const cardsHidden = createMemo(() => PINCH_ON_PICTURES && scaling());
	/**
	 * The sheet draws the awake cards as pictures rather than holes: from the first step of a scale, and
	 * two frames past its rest, so a card shown again has painted under its picture before the hole
	 * opens over it, and no frame shows it blank.
	 */
	const [cardPictures, setCardPictures] = createSignal(false);
	{
		let raf: number | undefined;
		createEffect(
			on(cardsHidden, (hidden) => {
				if (raf !== undefined) cancelAnimationFrame(raf);
				raf = undefined;
				if (hidden) return setCardPictures(true);
				if (!untrack(cardPictures)) return;
				raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => ((raf = undefined), setCardPictures(false)))));
			}),
		);
		onCleanup(() => raf !== undefined && cancelAnimationFrame(raf));
	}

	/**
	 * How many awake items may be put on layers of their own while the scale moves before it stops being a saving.
	 *
	 * A layer is a picture the compositor keeps and can stretch without waking the main
	 * thread, and that trade is a good one until there are so many that compositing them
	 * costs more than drawing them. It reverses, and it was measured rather than guessed —
	 * 1400×900 at 4× CPU throttle, milliseconds of work per finger movement while pinching:
	 *
	 *     12 documents in view   56 on layers · 134 without
	 *     40 documents in view  126 on layers · 181 without
	 *    120 documents in view  700 on layers · 523 without   ← the trade has reversed
	 *
	 * Those documents were boards' iframes, which the canvas no longer runs. What goes on a layer now
	 * is an awake card's root, a document's editor or an app's window (`canvas.css`, `data-scaling`),
	 * a few elements each, and only those are counted: a board is its picture on the sheet and has no
	 * layer to make. Measured on a canvas of 65 cards, all on screen below 25%, a ctrl-wheel zoom
	 * across 2%–400% in headed Chrome: with the cards over the old 48 and so off layers, Chrome drew
	 * every card again at every step and a third of the frames were late (97 of 300 over 16.7 ms,
	 * p95 35 ms); on layers, 0–6 of 495, and a frame mid-zoom as sharp as at rest. 128 is twice what
	 * was measured.
	 */
	const LAYER_BUDGET = 128;

	/**
	 * Cards whose surfaces are showing, by how many of their slots say so: the sheet is a hole over each
	 * of them, and the card's picture everywhere else. A count and not a set, so a slot that goes as
	 * another comes for the same card never leaves it wrongly unmarked.
	 */
	const [liveCards, setLiveCards] = createSignal<ReadonlyMap<string, number>>(new Map());
	const markLive = (path: string, on: boolean) =>
		setLiveCards((was) => {
			const next = new Map(was);
			const count = (next.get(path) ?? 0) + (on ? 1 : -1);
			if (count > 0) next.set(path, count);
			else next.delete(path);
			return next;
		});

	/** The file items whose holes the sheet is showing, as of the frame on screen (`liveFiles`): their elements show then and not before. */
	const [holesShown, setHolesShown] = createSignal<ReadonlySet<string>>(new Set());
	let holesAsked: { ids: ReadonlySet<string>; mark: number } | undefined;
	const media = createMedia({

	});
	const { playing, setPlaying, playedTo, toggleMedia } = media;

	const { appStates } = createAppStates({
		props,
	});

	createCovering({
		COVER, moving, panning, scaling, gliding, liveCards, cardPictures, appStates, editor, penLayer, props, resolveColour,
		get pageIndex() { return pageIndex; },
		get isLive() { return isLive; },
	});
	// The boards a drag carries go with it on the engine's carried layer (`editor/dom/controller.ts`).
	/** The items whose carried picture is on screen: their slots hide where they were picked up (`item-slot.tsx`). */
	const [carriedPages, setCarriedPages] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.carrying = setCarriedPages;
	/** The cards the sheet is drawing as their pictures, as of the frame on screen (`CanvasEngine.pictured`). */
	const [picturedNow, setPicturedNow] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.pictured = setPicturedNow;
	/** For the browser checks: the items the sheet is drawing as their pictures now. */
	probes.pictured = () => [...untrack(picturedNow)];
	/*
	 * An item a drag carries while the sheet draws it as its picture (not awake): its picture goes with the drag, so its slot waits unseen too, or its
	 * title stayed on screen where the drag began (a finger on a phone, `item-slot.tsx`, `fingerDrag`).
	 */
	const draggedAsPicture = createMemo<ReadonlySet<string>>(() => {
		const paths = [...(editor.pageDrag()?.paths ?? []), ...(editor.ownDrag() ? [editor.ownDrag()!.path] : [])];
		const live = liveCards();
		return new Set(paths.filter((path) => !live.has(path)));
	});

	/** The most file items alive at once, the nearest the middle of the screen: a frame each is a page's worth of work. */
	const LIVE_FILES = 12;
	/**
	 * For the browser checks: every card, document and app on the canvas and where it is on screen, node or
	 * picture (`rendered`).
	 */
	const cardsOnScreen = () => {
		const element = deps.element();
		if (!element) return [];
		const r = element.getBoundingClientRect();
		const nodes = renderedPaths();
		return props.boards
			.map((board) => {
				const a = toScreen(ctl.now(), view(), { x: board.x, y: board.y });
				const b = toScreen(ctl.now(), view(), { x: board.x + board.w, y: board.y + board.h });
				return { path: board.path, node: nodes.has(board.path), rev: board.rev, sized: board.sized, rect: new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y) };
			});
	};
	probes.cards = cardsOnScreen;

	const { playingBox } = createPlayingBox({ penDrawn, playing, penLayer, editor, setPlaying });

	const { pageIndex, isLive, pageSlot, livePaths, keptPaths, leavingPaths, isVisible, isKept, isLeaving, isPictured, isNear, liveNow } = createAwakeCards({
		ctl, view, props, BUDGET, editor, liveCards, picturedNow,
	});
	const { renderedPaths, restCamera, isRendered, layered } = createRendered({
		props, view, moving, panning, scaling, gliding, pageSlot, editor, liveCards, livePaths, keptPaths, leavingPaths, penLayer,
		cardsHidden, isVisible, LAYER_BUDGET,
	});

	const { liveFiles, liveBox, openLiveFile } = createLiveFiles({
		penDrawn, restCamera, props, view, penLayer, LIVE_FILES, scaling, editor,
		get holesAsked() { return holesAsked; },
		set holesAsked(next) { holesAsked = next; },
	});

	const { pageNode } = createPageNode({
		props, Frame, ctl, isLive, isKept, isLeaving, isPictured, isNear, markLive, carriedPages, draggedAsPicture, gestures, editor,
		pushCamera, frame,
	});

	const { sizingPaths } = createCardSizing({
		editor,
		props,
	});

	const { presented, slots, fileNodes, player } = createItemNodes({
		penLayer, setHolesShown, props, isRendered, pageNode, liveFiles, liveBox, holesShown, playingBox, playedTo, setPlaying,
		get holesAsked() { return holesAsked; },
		set holesAsked(next) { holesAsked = next; },
		get playingElement() { return media.playingElement; },
		set playingElement(next) { media.playingElement = next; },
	});

	return { isLive, renderedPaths, pageIndex, liveNow, layered, cardsHidden, sizingPaths, toggleMedia, openLiveFile, presented, slots, fileNodes, player };
}
