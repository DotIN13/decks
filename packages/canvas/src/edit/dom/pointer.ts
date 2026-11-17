/**
 * The editor's half of the stage's pointer: a press followed to its lift (`follow`, with pointer
 * capture, window listeners, and the last step replayed when the camera moves under a held press),
 * the hover outline, the double-click, a finger's taps and carries on the drawing, and the presses
 * on what the overlay draws (handles, the radius, an arrow's ends and middle, a block's grip).
 *
 * Which gesture a press starts is decided in `core/dispatch.ts`; the gestures are stepped in
 * `core/gesture.ts` through the controller (`dom/controller.ts`). The stage keeps the camera: it
 * hands this its finger pool and its pan (`PointerHost`), and tells it when the camera moves
 * (`cameraMoved`) and when it was dragged (`panned`).
 *
 * A board's frame reads what the editor says about it through `pageView(path)`, and nothing else.
 */
import { type MediaItem, type PenNode } from "@decks/pen";
import { onCleanup } from "solid-js";
import { type BareTap, type LastTap } from "../core/dispatch.ts";
import type { ArrowHandles } from "../core/arrows.ts";
import type { PageBox, PenTool, Pt } from "../core/model.ts";
import type { PageHandles, Outline, RadiusHandle } from "../core/overlay.ts";
import { blockAt, pickAt, pictureAt, type Picked, type PickOptions } from "../core/pick.ts";
import type { SceneQuery } from "../core/scene.ts";
import { type Editor } from "./controller.ts";
import { createPageViews } from "./page-views.ts";
import { createDoubleClick } from "./double-click.ts";
import { createTouchOnDrawing } from "./touch-on-drawing.ts";
import { createTapToDeselect } from "./tap-to-deselect.ts";
import { createHover } from "./hover.ts";
import { createStarts } from "./starts.ts";
import { createFollow } from "./follow.ts";
import { createPress } from "./press.ts";
import { createPenPress } from "./pen-press.ts";

/** A point on the screen, as a pointer or mouse event has it. */
export type Client = { clientX: number; clientY: number };

/** What a double-click or a double tap opens, the page's (`CanvasView.tsx`): each answers whether it was one. */
export type Openers = {
	/** A file shown live: a web page taken into, an SVG opened in a tab. */
	liveFile: (id: string) => boolean;
	/** A file's chip: the file opens in a tab of its own. */
	file: (id: string) => boolean;
	/** A card, at its words or with a new line in a gap. */
	cardAt: (hit: Picked, at: Pt, client: Pt) => boolean;
	/** A shape's words, made if it has none. */
	shapeWords: (shape: string) => void;
	text: (hit: Picked) => void;
	/** The shape an item is, or is part of. */
	shapeOf: (id: string) => string | undefined;
	/** The card an item is a block of. */
	cardOf: (id: string) => PenNode | undefined;
};

export type PointerHost = {
	scene: SceneQuery;
	/** The stage's element: what a press is captured by, unless said otherwise. */
	element: () => HTMLElement;
	/** Where a screen point is on the stage, from the camera now. */
	worldAt: (event: Client) => Pt;
	/** Whether the drawing can be edited here (`CanvasView`'s `onPenEdit`). */
	editable: () => boolean;
	/** The draw tool is out. */
	drawing: () => boolean;
	/**
	 * A Pencil pressed on bare canvas while the select tool is in hand: the host turns the pen on
	 * and hands the press to the ink sheet, and says whether it did (`touch-rules`, step 7).
	 */
	pencil?: (event: PointerEvent) => boolean;
	mode: () => "browse" | "edit";
	tool: () => PenTool;
	spaceHeld: () => boolean;
	/** The boards near a stage point, in file order (the stage's spatial index): candidates for the picture under it. */
	pagesNear: (at: Pt) => readonly PageBox[];
	/** The boards that have a node of their own to take a press. */
	rendered: () => ReadonlySet<string>;
	/** The item open for typing, whose blocks have no grip. */
	typing: () => string | undefined;
	linkAt: (at: Pt) => string | undefined;
	/** The app's selected board. */
	onSelect: (path: string | undefined) => void;
	/** The stage's finger pool: how many fingers are down, a finger the camera must not pan with, a finger handed to it. */
	fingers: () => number;
	/** The first finger caught a moving canvas (a glide or a coast): its lift is no tap, as a hand stopping a list does not press it. */
	caught?: () => boolean;
	claim: (pointer: number) => void;
	beginTouch: (event: PointerEvent) => void;
	/** A finger's press is the editor's (an item, a handle, a board): the stage keeps it from scrolling natively. */
	keepTouch?: (event: PointerEvent) => void;
	/** The camera dragged from this press (`decidePress`, `pan`). */
	pan: (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => void;
	/** A tool armed: the item made from this press (`CanvasView`'s `penCreate`). */
	make: (event: PointerEvent, tool: Exclude<PenTool, "select">, at: Pt) => void;
	/** When a tool last made an item. */
	madeAt: () => number;
	/** A note at a screen point, open for typing: what the Note tool and a click there make (`InsertMenu`'s `noteAt`). */
	noteAt: (event: Client) => void;
	/** A finger held still for `HOLD_MS` (`touch-rules.ts`): the item's menu at the finger, or the canvas's with no item (`ui/HoldMenu.tsx`). */
	/** The hold menu at the finger, or none: a finger that moves after its hold puts it away. */
	holdMenu?: (menu: { ids: string[]; at: Pt; stage: Pt } | undefined) => void;
	toggleMedia: (id: string, media: MediaItem) => void;
	open: Openers;
	/** The handles the overlay draws, as drawn, for the presses on them. */
	handles: {
		item: () => Outline | undefined;
		board: () => PageHandles | undefined;
		radius: () => RadiusHandle | undefined;
		arrow: () => ArrowHandles | undefined;
	};
};



export function createPointer(editor: Editor, host: PointerHost) {
	/**
	 * Presses in hand that want to hear the camera move. A wheel or a glide during a drag moves the
	 * world under a pointer that has not moved, so `follow` replays its last step against the new
	 * camera, and what is carried stays under the cursor.
	 */
	const cameraWatchers = new Set<() => void>();
	/**
	 * When the camera was last dragged, so a double-click can tell itself apart from a pan.
	 *
	 * Chromium fires `dblclick` after two presses whatever happened between them, and a quick
	 * pan is two presses with a lot happening between them — so without this, dragging the
	 * canvas about would leave a new note behind at the end of it.
	 */
	let pannedAt = 0;
	/**
	 * What the last press landed on, before anything it did moved: a double-click's second press on a
	 * handle whose edit is drawn at once (an arrow's bend put back) leaves bare canvas under the
	 * pointer by the time `dblclick` comes, and that is not a double-click on the canvas or on what is
	 * under it now (a note there would open for typing).
	 */
	let pressedOn: EventTarget | null = null;
	const notePress = (event: PointerEvent) => {
		pressedOn = event.target;
	};
	addEventListener("pointerdown", notePress, true);
	onCleanup(() => removeEventListener("pointerdown", notePress, true));
	let lastBareTap: BareTap | undefined;
	/** The last tap on a drawn item, so a second one soon after on the same item opens its words. */
	let lastTap: LastTap | undefined;

	const worldAt = host.worldAt;
	const pickAtHere = (at: Pt, options?: PickOptions) => pickAt(host.scene, at, options);
	/**
	 * The board whose picture is under a point and that has no node of its own to take the press
	 * (below the live zoom, `rendered`): the last in file order, as the sheet draws it on top.
	 */
	const pictureUnder = (event: Client): string | undefined => {
		const at = worldAt(event);
		// The spatial index finds the few boards near the point; core decides among them, in paint order.
		return pictureAt(host.pagesNear(at), at, host.rendered());
	};
	/**
	 * A press on a drawn item's click shape (`render/engine.ts`, `attachHits`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === host.element() || onDrawn(target);

	const { followEditor, fingerIn, follow } = createFollow({
		host,
		cameraWatchers,
		editor,
		worldAt,
	});

	const { penPress } = createPenPress({
		worldAt,
		host,
		editor,
		followEditor,
	});

	const { dragPage, selectPage, dragBlock, resizeFrom, radiusFrom, resizePage, dragArrowEnd, dragArrowBend } = createStarts({
		editor,
		worldAt,
		followEditor,
		host,
		fingerIn,
	});

	/**
	 * The text block of a card at a stage point: the one under it, or in the card's margin, the one
	 * level with it. Not while the card is open for typing, which has its own way of moving things.
	 */
	const blockUnder = (at: Pt): string | undefined => blockAt(host.scene, at, host.typing());

	const { onHover, onLeave } = createHover({
		editor,
		host,
		worldAt,
		blockUnder,
		pictureUnder,
		pickAtHere,
	});

	const { tapToDeselect } = createTapToDeselect({
		host,
		worldAt,
		editor,
		get lastBareTap() {
			return lastBareTap;
		},
		set lastBareTap(next) {
			lastBareTap = next;
		},
	});

	const { touchOnDrawing } = createTouchOnDrawing({
		worldAt,
		pickAtHere,
		editor,
		host,
		get lastTap() {
			return lastTap;
		},
		set lastTap(next) {
			lastTap = next;
		},
	});

	const { onDblClick } = createDoubleClick({
		get pressedOn() {
			return pressedOn;
		},
		host,
		pickAtHere,
		worldAt,
		onDrawn,
		onCanvas,
		editor,
		pictureUnder,
		get pannedAt() {
			return pannedAt;
		},
	});

	const { onPointerDown } = createPress({
		host,
		onCanvas,
		pickAtHere,
		worldAt,
		pictureUnder,
		penPress,
		dragPage,
		selectPage,
		touchOnDrawing,
		tapToDeselect,
	});

	const { pageView } = createPageViews({
		host,
		editor,
		dragPage,
		selectPage,
	});

	return {
		follow,
		/** The camera moved: every press in hand runs its last step again. */
		cameraMoved: () => {
			for (const watch of [...cameraWatchers]) watch();
		},
		/** The camera was dragged, or something carried: a double-click soon after is not one. */
		panned: () => {
			pannedAt = performance.now();
		},
		onPointerDown,
		onPointerMove: onHover,
		onPointerLeave: onLeave,
		onDblClick,
		/** The presses on what the overlay draws (`OverlayLayer`). */
		onGrip: dragBlock,
		onHandle: resizeFrom,
		onRadius: radiusFrom,
		onPageHandle: resizePage,
		onArrowEnd: dragArrowEnd,
		onArrowBend: dragArrowBend,
		selectPage,
		pageView,
		pictureUnder,
	};
}

export type Pointer = ReturnType<typeof createPointer>;
