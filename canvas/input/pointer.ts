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
import { mediaOf, type MediaItem, type PenNode } from "@decks/pen";
import { batch, onCleanup, untrack } from "solid-js";
import { decideHover, decidePress, isBareSecondTap, isSecondTap, MADE_MS, PANNED_MS, TAP_MS, TAP_SLOP_PX, type BareTap, type LastTap, type PressTarget } from "../editor/core/dispatch.ts";
import { HOLD_MS, slopFor } from "./touch-rules.ts";
import type { ArrowHandles } from "../editor/core/arrows.ts";
import type { PageBox, Offset, PenTool, Pt, Rect } from "../editor/core/model.ts";
import type { PageHandles, Outline, RadiusHandle } from "../editor/core/overlay.ts";
import { glideShift } from "../editor/core/overlay.ts";
import { blockAt, pickAt, pictureAt, type Picked, type PickOptions } from "../editor/core/pick.ts";
import type { Handle } from "../editor/core/resize.ts";
import type { SceneQuery } from "../editor/core/scene.ts";
import { pointerInput, type Editor } from "../editor/dom/controller.ts";

/** A point on the screen, as a pointer or mouse event has it. */
type Client = { clientX: number; clientY: number };

/** What the editor reads of a board, and says back about it: all a board's frame (`PageFrame`) knows of the editor. */
export type PageView = {
	/** How far a drag of the selection carries this board, while it does. */
	shift: () => Offset | undefined;
	/** The box the stage's handles are asking for, drawn before the file has it. */
	resized: () => Rect | undefined;
	/** The pointer came onto the board or its title bar, or left both: the hover outline. */
	hover: (on: boolean) => void;
	/**
	 * A mouse or pen press on the title bar or the edge, offered to the editor first: it moves the
	 * board with the rest of a selection and snaps it. True means it took the drag. `on` is the element
	 * that follows the drag, when the press was heard somewhere that is not one (a card's own root).
	 */
	press: (event: PointerEvent, on?: HTMLElement) => boolean;
	/** A drag of the board's own (a finger on its edge): where it is carried, `null` when it ends. */
	dragging: (at: Pt | null) => void;
	/** A press on the board: it is selected, alone unless it is part of the selection already. */
	select: () => void;
};

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
	/** Whether the drawing can be edited here (`Stage`'s `onPenEdit`). */
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
	/** A tool armed: the item made from this press (`Stage`'s `penCreate`). */
	make: (event: PointerEvent, tool: Exclude<PenTool, "select">, at: Pt) => void;
	/** When a tool last made an item. */
	madeAt: () => number;
	/** A note at a screen point, open for typing: what the Note tool and a click there make (`InsertMenu`'s `noteAt`). */
	noteAt: (event: Client) => void;
	/** A finger held still for `HOLD_MS` (`touch-rules.ts`): the item's menu at the finger, or the canvas's with no item (`chrome/HoldMenu.tsx`); none puts it away, as a finger that moves after its hold does. */
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

const TEXTY = new Set(["text", "note", "prompt", "context"]);

/** Where an event landed, in `core/dispatch.ts`'s words. */
function pressTarget(element: HTMLElement, target: EventTarget | null): PressTarget {
	if (target === element) return "stage";
	return (target as Element | null)?.closest?.(".pen-hits") ? "drawn" : "other";
}


export function createPointer(editor: Editor, host: PointerHost) {
	const c: PointerCtx = {
		editor,
		host,
		cameraWatchers: new Set(),
		pannedAt: 0,
		pressedOn: null,
		lastBareTap: undefined,
		lastTap: undefined,
		hoverFrame: undefined,
		hoverAt: undefined,
		hoverPoint: undefined,
		hoverLights: false,
		hoverNode: undefined,
	};
	listen(c);
	const bound = <A extends unknown[], R>(part: (c: PointerCtx, ...args: A) => R) => (...args: A): R => part(c, ...args);
	return {
		follow: bound(follow),
		/** The camera moved: every press in hand runs its last step again. */
		cameraMoved: () => {
			for (const watch of [...c.cameraWatchers]) watch();
		},
		/** The camera was dragged, or something carried: a double-click soon after is not one. */
		panned: () => {
			c.pannedAt = performance.now();
		},
		onPointerDown: bound(onPointerDown),
		onPointerMove: bound(onHover),
		onPointerLeave: bound(onLeave),
		onDblClick: bound(onDblClick),
		/** The presses on what the overlay draws (`OverlayLayer`). */
		onGrip: bound(dragBlock),
		onHandle: bound(resizeFrom),
		onRadius: bound(radiusFrom),
		onPageHandle: bound(resizePage),
		onArrowEnd: bound(dragArrowEnd),
		onArrowBend: bound(dragArrowBend),
		selectPage: bound(selectPage),
		pageView: bound(pageView),
		pictureUnder: bound(pictureUnder),
	};
}

/** What the pointer keeps between presses, handed to each of its parts. */
type PointerCtx = {
	editor: Editor;
	host: PointerHost;
	/** Presses in hand that want to hear the camera move: a wheel or a glide during a drag replays the last step (`follow`). */
	cameraWatchers: Set<() => void>;
	/** When the camera was last dragged, so a double-click can tell itself apart from a pan. */
	pannedAt: number;
	/** What the last press landed on, before anything it did moved, for a double-click to read. */
	pressedOn: EventTarget | null;
	/** The last tap on bare canvas, so a second one soon after is a double tap. */
	lastBareTap: BareTap | undefined;
	/** The last tap on a drawn item, so a second one soon after on the same item opens its words. */
	lastTap: LastTap | undefined;
	/** The hover in hand: its frame, where the pointer is in the world and on screen, and what it lit. */
	hoverFrame: number | undefined;
	hoverAt: Pt | undefined;
	hoverPoint: Client | undefined;
	hoverLights: boolean;
	hoverNode: string | undefined;
};

/** The window listeners the pointer keeps while it lives: what each press landed on, and Alt for distances. */
function listen(c: PointerCtx): void {
	const noted = (event: PointerEvent) => notePress(c, event);
	const alt = (event: KeyboardEvent) => altKey(c, event);
	const altLost = () => altGone(c);
	addEventListener("pointerdown", noted, true);
	addEventListener("keydown", alt);
	addEventListener("keyup", alt);
	addEventListener("blur", altLost);
	onCleanup(() => {
		removeEventListener("pointerdown", noted, true);
		removeEventListener("keydown", alt);
		removeEventListener("keyup", alt);
		removeEventListener("blur", altLost);
		if (c.hoverFrame !== undefined) cancelAnimationFrame(c.hoverFrame);
	});
}

// What every press reads: where a point is, what is under it, and following a press to its release.
function notePress(c: PointerCtx, event: PointerEvent) {
	c.pressedOn = event.target;
}

/** Where a screen point is on the stage, from the camera now. */
function worldAt(c: PointerCtx, event: Client): Pt {
	return c.host.worldAt(event);
}

function pickAtHere(c: PointerCtx, at: Pt, options?: PickOptions) {
return pickAt(c.host.scene, at, options);
}

/**
 * The board whose picture is under a point and that has no node of its own to take the press
 * (below the live zoom, `rendered`): the last in file order, as the sheet draws it on top.
 */
function pictureUnder(c: PointerCtx, event: Client) : string | undefined {
	const at = worldAt(c, event);
	// The spatial index finds the few boards near the point; core decides among them, in paint order.
	return pictureAt(c.host.pagesNear(at), at, c.host.rendered());
}

/**
 * A press on a drawn item's click shape (`render/engine.ts`, `attachHits`). Only items over a board have one, to take
 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
 */
function onDrawn(c: PointerCtx, target: EventTarget | null) {
return !!(target as Element | null)?.closest?.(".pen-hits");
}

/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
function onCanvas(c: PointerCtx, target: EventTarget | null) {
return target === c.host.element() || onDrawn(c, target);
}

/**
 * Follow one press to its release: `move` on each step past the pointer's slop (`touch-rules.ts`: 3 px for a mouse, 8 for a finger), `done` at the end.
 *
 * The pointer is captured by `on`, the stage unless said otherwise, and the click that ends the
 * press goes to whatever captured it — so a press on a board's title bar keeps it on the bar, or
 * its double-click would reach the canvas and make a note.
 *
 * The camera can move while the press is held (a wheel, a glide), and then the last step runs
 * again: a `move` that reads the pointer in world space (`worldAt`) follows the cursor.
 */
function follow(c: PointerCtx, event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void, on: HTMLElement = c.host.element(), abandon?: () => void) {
	try {
		on.setPointerCapture(event.pointerId);
	} catch {
		// Refused for a pointer the browser no longer has; the listeners still end the press.
	}
	const start = { x: event.clientX, y: event.clientY };
	const slop = slopFor(event.pointerType);
	let moved = false;
	let last: PointerEvent | undefined;
	let over = false;
	const onMove = (e: PointerEvent) => {
		if (e.pointerId !== event.pointerId || released(e)) return;
		if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < slop) return;
		moved = true;
		last = e;
		move(e);
	};
	const replay = () => {
		if (moved && last) move(last);
	};
	/** A mouse move with no button held: the release went somewhere this never heard, so it is over. */
	const released = (e: PointerEvent) => {
		if (e.pointerType !== "mouse" || (e.buttons & 1) !== 0) return false;
		finish(e);
		return true;
	};
	const watch = (e: PointerEvent) => {
		if (e.pointerId === event.pointerId) released(e);
	};
	/*
	 * A second finger landing while one follows a press is a pinch, which the stage's pool takes
	 * from here (`canvas-input.ts`): the press is abandoned, not released where it was, so a resize or a
	 * carry that had begun is put back rather than landed half done.
	 */
	const other = (e: PointerEvent) => {
		if (!abandon || e.pointerType !== "touch" || e.pointerId === event.pointerId || over) return;
		over = true;
		c.cameraWatchers.delete(replay);
		on.removeEventListener("pointermove", onMove);
		on.removeEventListener("pointerup", finish);
		on.removeEventListener("pointercancel", finish);
		on.removeEventListener("lostpointercapture", finish);
		window.removeEventListener("pointermove", watch, true);
		window.removeEventListener("pointerup", finish, true);
		window.removeEventListener("pointercancel", finish, true);
		window.removeEventListener("pointerdown", other, true);
		abandon();
	};
	if (abandon && event.pointerType === "touch") window.addEventListener("pointerdown", other, true);
	c.cameraWatchers.add(replay);
	/*
	 * Ended once, by whichever of these comes first: the release or a cancel at the element that
	 * captured the pointer, the same anywhere in the window, the capture being lost (the element
	 * left the page, or the browser took it back), or a move with no button held. Listening on
	 * the captured element alone, a release it never heard left the drag following the cursor and
	 * the camera after the button was up: zoomed out to 20%, moving a board or a group.
	 */
	const finish = (e: PointerEvent) => {
		if (over || e.pointerId !== event.pointerId) return;
		over = true;
		c.cameraWatchers.delete(replay);
		on.removeEventListener("pointermove", onMove);
		on.removeEventListener("pointerup", finish);
		on.removeEventListener("pointercancel", finish);
		on.removeEventListener("lostpointercapture", finish);
		window.removeEventListener("pointermove", watch, true);
		window.removeEventListener("pointerup", finish, true);
		window.removeEventListener("pointercancel", finish, true);
		window.removeEventListener("pointerdown", other, true);
		done(moved, e);
	};
	on.addEventListener("pointermove", onMove);
	on.addEventListener("pointerup", finish);
	on.addEventListener("pointercancel", finish);
	on.addEventListener("lostpointercapture", finish);
	window.addEventListener("pointermove", watch, true);
	window.addEventListener("pointerup", finish, true);
	window.addEventListener("pointercancel", finish, true);
}

/**
 * Follow a press the editor took to its lift (`editor/core/gesture.ts`): each move and the lift
 * told to it, in stage coordinates. `on` captures the pointer, the stage unless said otherwise.
 */
function followEditor(c: PointerCtx, event: PointerEvent, on?: HTMLElement) {
return follow(c, 
			event,
			(e) => c.editor.input({ type: "move", ...pointerInput(e, worldAt(c, e)) }),
			(_moved, e) => c.editor.input({ type: "release", ...pointerInput(e, worldAt(c, e)) }),
			on,
			() => c.editor.input({ type: "cancel" }),
		);
}

/*
 * A finger pressing a handle, an arrow's end or a block's grip is the editor's, and these presses
 * stop at their element: the stage never hears them, so the finger was not in its pool, and a
 * pinch begun on a handle could not happen. Put in the pool here, and kept from the browser's
 * scroll (`keepTouch`); a second finger then makes the pinch and abandons the press (`follow`).
 */
function fingerIn(c: PointerCtx, event: PointerEvent) {
	if (event.pointerType !== "touch") return;
	c.host.keepTouch?.(event);
	c.host.beginTouch(event);
}

/**
 * The text block of a card at a stage point: the one under it, or in the card's margin, the one
 * level with it. Not while the card is open for typing, which has its own way of moving things.
 */
function blockUnder(c: PointerCtx, at: Pt) : string | undefined {
return blockAt(c.host.scene, at, c.host.typing());
}

// Moving and resizing what is pressed: pages, frames, corners, arrow ends and bends, blocks.
/**
 * A press on the drawing; true when it was the drawing's to handle. A tool makes its item; with
 * the select tool the editor picks up what is under the press, or draws a marquee on bare canvas.
 */
function penPress(c: PointerCtx, event: PointerEvent) : boolean {
	const at = worldAt(c, event);
	const tool = c.host.tool();
	if (tool !== "select") {
		event.preventDefault();
		c.host.onSelect(undefined);
		c.editor.pickPages([]);
		c.host.make(event, tool, at);
		return true;
	}
	event.preventDefault();
	if (c.editor.input({ type: "press-canvas", ...pointerInput(event, at) })) followEditor(c, event);
	return true;
}

/**
 * A press on a board's title bar (`PageFrame`), with a mouse or a pen: the stage moves it, so it
 * moves with whatever else is selected and snaps like everything else. Shift adds the board to the
 * selection or takes it out. A finger's drag stays the board's own, where a pinch can take it back.
 */
function dragPage(c: PointerCtx, path: string, event: PointerEvent, on = event.currentTarget as HTMLElement) : boolean {
	if (event.button !== 0) return false;
	event.stopPropagation();
	event.preventDefault();
	if (c.editor.input({ type: "press-board", path, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event, on);
	return true;
}

/** A board selected by a press on it, as `PageFrame`'s own `onSelect` does: alone, unless it is part of the selection already. */
function selectPage(c: PointerCtx, path: string) {
	if (!untrack(c.editor.pagePicks).includes(path) && (untrack(c.editor.pagePicks).length || untrack(c.editor.items).length)) {
		c.editor.pickPages([]);
		c.editor.select([]);
	}
	c.host.onSelect(path);
}

/** An item's handle dragged (`editor/core/gesture.ts`, `resize`); two presses on a frame's top or bottom handle hug it again. */
function resizeFrom(c: PointerCtx, event: PointerEvent, handle: Handle) {
	const box = c.host.handles.item();
	if (event.button !== 0 || !box) return;
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	if (c.editor.input({ type: "press-handle", handle, box, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event);
}

/**
 * How round the corners are, dragged. The handle starts inside the top-left corner; pulling it
 * along the diagonal rounds every corner by as much, up to half the shorter side, where the
 * straight sides are gone. A shape from the library keeps it in its own `metadata.radius`, which
 * is what redraws its outline (`@decks/pen`, `fitShapes`); pen's rectangle and frame have a
 * `cornerRadius` of their own. It is written on the lift, not while dragging, so one drag is one
 * edit in the file's history.
 */
function radiusFrom(c: PointerCtx, event: PointerEvent) {
	const start = c.host.handles.radius();
	if (event.button !== 0 || !start) return;
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	if (c.editor.input({ type: "press-radius", handle: start, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event);
}

/**
 * A board's handles, as an item's: every edge and corner, snapping to what is around, ⌘ or Ctrl
 * to not snap, Shift to keep the shape. The board is drawn at the new box at once; letting go
 * moves it if a left or top edge was dragged, and writes the size to its file, and the box is held
 * until the board is at it (`editor/core/gesture.ts`, `landPageResize`).
 */
function resizePage(c: PointerCtx, event: PointerEvent, handle: Handle) {
	const box = c.host.handles.board();
	if (event.button !== 0 || !box) return;
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	if (c.editor.input({ type: "press-board-handle", handle, box, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event);
}

/**
 * An arrow's end, picked up and put down somewhere else: on an item or a board it joins it, and
 * follows it from then on; on bare canvas it stays at that point. Along the side it joins, the
 * drag slides the join. What it would join lights up while it is carried, as it does while the
 * arrow is drawn. A double-click on a joined end puts the join back in the middle of its side.
 */
function dragArrowEnd(c: PointerCtx, event: PointerEvent, which: "from" | "to") {
	const ends = c.host.handles.arrow();
	if (event.button !== 0 || !ends) return;
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	if (c.editor.input({ type: "press-arrow-end", which, ends, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event);
}

/**
 * The handle in an arrow's middle, dragged: an elbow's middle segment slides along its run, a
 * curve's middle is pulled, and a straight line pulled there becomes a curve (`bendAt`). A
 * double-click puts it back on the automatic route.
 */
function dragArrowBend(c: PointerCtx, event: PointerEvent) {
	const ends = c.host.handles.arrow();
	if (event.button !== 0 || !ends?.middle) return;
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	if (c.editor.input({ type: "press-arrow-bend", ends, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event);
}

/** A press on a block's grip picks the block up and carries it, into another place in the card or out of it. */
function dragBlock(c: PointerCtx, event: PointerEvent, id: string) {
	event.preventDefault();
	event.stopPropagation();
	fingerIn(c, event);
	const on = event.currentTarget as HTMLElement;
	if (c.editor.input({ type: "press-block", id, ...pointerInput(event, worldAt(c, event)) })) followEditor(c, event, on);
}

// What the pointer is over without pressing, and Alt for the distances it shows.
function onHover(c: PointerCtx, event: PointerEvent) {
	if (event.pointerType !== "touch") c.editor.hover({ alt: event.altKey });
	/*
	 * The pointer on a sleeping item's own node (its bar above the box, its edge band): the item
	 * stays hovered, though the point is outside its picture and the target is not the canvas, or
	 * the node would go as the pointer reached the bar it is there for.
	 */
	c.hoverNode = (event.target as Element | null)?.closest?.(".card-node[data-state='picture']")?.getAttribute("data-path") ?? undefined;
	const decided = decideHover({
		pointer: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse",
		editable: c.host.editable(),
		editing: c.host.mode() === "edit",
		drawing: c.host.drawing(),
		// The pointer on a block's grip keeps the grip, and the block it belongs to.
		onGrip: !!(event.target as Element | null)?.closest?.(".pen-grip"),
		buttons: event.buttons,
		tool: c.host.tool(),
		target: pressTarget(c.host.element(), event.target),
		hand: c.host.spaceHeld(),
	});
	if (decided.do === "none") return;
	if (decided.do === "clear") {
		c.hoverAt = undefined;
		/*
		 * The sleeping item under the pointer keeps its node through a press: its bar is what the press
		 * is on, and the bar's own handler runs after this one (Solid delegates it to the document), so
		 * clearing it here took the node away before the press could move or select the item.
		 */
		c.editor.hover({ ...(decided.block ? { block: undefined } : {}), item: undefined, ...(event.buttons === 0 ? { picture: c.hoverNode } : {}), link: false });
		return;
	}
	c.hoverAt = worldAt(c, event);
	c.hoverPoint = { clientX: event.clientX, clientY: event.clientY };
	c.hoverLights = decided.outlines;
	c.hoverFrame ??= requestAnimationFrame(() => {
		c.hoverFrame = undefined;
		const href = c.hoverAt ? c.host.linkAt(c.hoverAt) : undefined;
		// Browsing, the hand over a link and a card block's grip, but no outline; the sleeping item under the pointer still, which gets its bar to move it by (`items-layer.tsx`, `rendered`).
		if (!c.hoverLights) {
			c.editor.hover({ link: !!href && c.host.mode() === "browse", block: c.hoverAt ? blockUnder(c, c.hoverAt) : undefined, item: undefined, picture: (c.hoverAt && c.hoverPoint && c.host.mode() !== "edit" ? pictureUnder(c, c.hoverPoint) : undefined) ?? c.hoverNode });
			return;
		}
		c.editor.hover({ link: !!href && c.host.mode() === "browse", block: c.hoverAt ? blockUnder(c, c.hoverAt) : undefined });
		const hit = c.hoverAt ? pickAtHere(c, c.hoverAt) : undefined;
		// A board with no node says nothing when the pointer is over it, so the stage asks.
		c.editor.hover({ item: hit && !c.editor.items().includes(hit.id) ? hit.id : undefined, picture: (!hit && c.hoverAt && c.hoverPoint ? pictureUnder(c, c.hoverPoint) : undefined) ?? c.hoverNode });
	});
}

/*
 * Alt, held or let go, for the distances it shows from the selection to what is hovered
 * (`core/overlay.ts`, `distances`): from the keys, and from each pointer move, which also says
 * so when the key went down or up while the window was not listening.
 */
function altKey(c: PointerCtx, event: KeyboardEvent) {
	if (event.key === "Alt") c.editor.hover({ alt: event.type === "keydown" });
}

function altGone(c: PointerCtx) {
return c.editor.hover({ alt: false });
}

function onLeave(c: PointerCtx) {
	c.editor.hover({ item: undefined, link: false });
}

// A finger on bare canvas or the drawing: a tap lets go or selects, a hold or a drag carries.
/**
 * A tap on bare canvas lets go of the drawn items and boards selected, as a click there does
 * (`penPress`, the marquee). On the lift, not the landing: a finger that pans or becomes a pinch
 * keeps the selection, so you can look around something you have picked.
 */
function tapToDeselect(c: PointerCtx, event: PointerEvent) {
	const pointer = event.pointerId;
	const from = { x: event.clientX, y: event.clientY };
	const since = performance.now();
	let pinched = false;
	let travelled = false;
	let held = false;
	/** Held, then moved: the finger draws a marquee from where it was held (`editor/core/gesture.ts`). */
	let boxing = false;
	const stopping = c.host.caught?.() ?? false;
	const second = (e: PointerEvent) => {
		if (e.pointerType === "touch" && e.pointerId !== pointer) pinched = true;
	};
	window.addEventListener("pointerdown", second, true);
	/*
	 * A finger held still on bare canvas: the canvas's menu at the finger (`holdMenu`), and the finger is
	 * the editor's from here, kept from scrolling the canvas. Lifted, nothing more happens; moved, the menu
	 * goes and the finger selects, drawing a marquee from where it was held. One finger alone pans.
	 */
	const hold = setTimeout(() => {
		if (pinched || travelled || !c.host.editable() || c.host.drawing()) return;
		held = true;
		c.host.claim(pointer);
		c.host.keepTouch?.(event);
		c.host.holdMenu?.({ ids: [], at: from, stage: worldAt(c, event) });
	}, HOLD_MS);
	const done = () => {
		clearTimeout(hold);
		window.removeEventListener("pointerdown", second, true);
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", cancel);
	};
	const cancel = (e: PointerEvent) => {
		if (e.pointerId !== pointer) return;
		done();
		if (boxing) c.editor.input({ type: "cancel" });
	};
	const move = (e: PointerEvent) => {
		if (held && e.pointerId === pointer) {
			if (!boxing) {
				if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < slopFor("touch")) return;
				boxing = true;
				c.host.holdMenu?.(undefined);
				if (!c.editor.input({ type: "press-canvas", ...pointerInput(event, worldAt(c, event)) })) return;
			}
			c.editor.input({ type: "move", ...pointerInput(e, worldAt(c, e)) });
			return;
		}
		if (e.pointerId !== pointer && e.pointerType === "touch") pinched = true;
		// Judged on the furthest the finger went: a pan that comes back to where it began is still a pan.
		else if (e.pointerId === pointer && Math.hypot(e.clientX - from.x, e.clientY - from.y) >= TAP_SLOP_PX) travelled = true;
		if (pinched || travelled) clearTimeout(hold);
	};
	const up = (e: PointerEvent) => {
		if (e.pointerId !== pointer) return;
		done();
		if (boxing) return void c.editor.input({ type: "release", ...pointerInput(e, worldAt(c, e)) });
		if (held) return;
		if (pinched || travelled || stopping || performance.now() - since > TAP_MS) return;
		batch(() => {
			c.editor.select([]);
			c.editor.pickPages([]);
		});
		// A second tap close by, soon after: a note there, as a double-click is with a mouse.
		const now = performance.now();
		const twice = isBareSecondTap(c.lastBareTap, { x: e.clientX, y: e.clientY }, now);
		c.lastBareTap = twice ? undefined : { x: e.clientX, y: e.clientY, at: now };
		if (twice && c.host.editable() && !c.host.drawing()) c.host.noteAt(e);
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", cancel);
}

/**
 * A finger on the drawing. On an item already selected it moves the selection (the finger is
 * claimed, so the camera stays put); anywhere else it is a pan unless it lifts where it landed,
 * which is a tap: the item is selected, and a second tap on words opens them for typing.
 */
function touchOnDrawing(c: PointerCtx, event: PointerEvent) {
	const at = worldAt(c, event);
	const hit = pickAtHere(c, at);
	if (!hit) return;
	const pointer = event.pointerId;
	const from = { x: event.clientX, y: event.clientY };
	const since = performance.now();
	const selected = c.editor.items();
	/*
	 * One finger pans, whatever it lands on, selected or not: the finger is the stage's to scroll with,
	 * and a tap selects. Held still first, it selects what it is on (`hold`), and moving from there
	 * carries it: the finger is the editor's from the hold.
	 */
	let carrying = false;
	let moved = false;
	let held = false;
	// A second finger anywhere makes this a pinch, even if this finger never moves; a finger that caught a moving canvas only stopped it.
	let pinched = false;
	const stopping = c.host.caught?.() ?? false;
	const second = (e: PointerEvent) => {
		if (e.pointerType === "touch" && e.pointerId !== pointer) pinched = true;
	};
	window.addEventListener("pointerdown", second, true);
	/*
	 * Held still for `HOLD_MS`: the item is selected and its menu opens at the finger (`holdMenu`); the
	 * finger is claimed so the lift neither taps nor pans, and a carry it had begun is let go.
	 */
	const hold = setTimeout(() => {
		// A finger that stopped a moving canvas and then held still means the hold: only its tap is kept back.
		if (moved || pinched || c.host.fingers() > 1) return;
		held = true;
		holdOnDrawing(c, event, hit.id, at, selected);
	}, HOLD_MS);
	const done = () => {
		clearTimeout(hold);
		window.removeEventListener("pointerdown", second, true);
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", cancel);
	};
	const abandon = () => {
		done();
		c.editor.input({ type: "cancel" });
	};
	const move = (e: PointerEvent) => {
		if (e.pointerId !== pointer) return;
		// A second finger: this was the start of a pinch, and whatever it carried goes back.
		if (c.host.fingers() > 1) return abandon();
		// A finger may wobble its slop (8 px) before it means to move; past it the carry begins.
		if (!moved && Math.hypot(e.clientX - from.x, e.clientY - from.y) < slopFor("touch")) return;
		clearTimeout(hold);
		// Moved after its hold: the menu goes, and the editor carries the selection from where the finger was held (`editor/core/gesture.ts`, a finger's carry).
		if (!moved && held) {
			carrying = true;
			c.host.holdMenu?.(undefined);
			c.editor.input({ type: "carry", from: { at, client: from }, ...pointerInput(e, worldAt(c, e)) });
		}
		moved = true;
		if (!carrying) return;
		c.editor.input({ type: "move", ...pointerInput(e, worldAt(c, e)) });
	};
	const up = (e: PointerEvent) => {
		if (e.pointerId !== pointer) return;
		done();
		if (held && !moved) return;
		if (moved) {
			if (carrying) c.editor.input({ type: "release", ...pointerInput(e, worldAt(c, e)) });
			else c.editor.input({ type: "cancel" });
			return;
		}
		if (pinched || stopping || performance.now() - since > TAP_MS) return;
		tapOnDrawing(c, e, hit, at, selected);
	};
	const cancel = (e: PointerEvent) => {
		if (e.pointerId === pointer) abandon();
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", cancel);
}


/** A finger held still on a drawn item: it is claimed, the item selected, and its menu opens at the finger. */
function holdOnDrawing(c: PointerCtx, event: PointerEvent, id: string, at: Pt, selected: readonly string[]): void {
	c.host.claim(event.pointerId);
	c.host.keepTouch?.(event);
	c.host.onSelect(undefined);
	c.editor.pickPages([]);
	// What it is on joins nothing: it is selected alone, unless it was part of the selection already.
	if (!selected.includes(id)) c.editor.select([id]);
	c.host.holdMenu?.({ ids: c.editor.items().slice(), at: { x: event.clientX, y: event.clientY }, stage: at });
}
/** A finger's tap on a drawn item: it plays a film or a sound, opens words or a card on a second tap, follows a link while browsing, or selects. */
function tapOnDrawing(c: PointerCtx, e: PointerEvent, hit: NonNullable<ReturnType<typeof pickAtHere>>, at: Pt, selected: readonly string[]): void {
	const deep = pickAtHere(c, at, { deep: true });
	// A film or a sound: a tap plays it or pauses it, and selects it as any tap does.
	const playable = deep && mediaOf(deep.node) ? deep : mediaOf(hit.node) ? hit : undefined;
	const media = playable ? mediaOf(playable.node) : undefined;
	if (playable && media) {
		c.lastTap = undefined;
		c.host.toggleMedia(playable.id, media);
		c.host.onSelect(undefined);
		c.editor.pickPages([]);
		c.editor.select([hit.id]);
		return;
	}
	if (isSecondTap(c.lastTap, hit.id, performance.now()) && deep && (c.host.open.liveFile(deep.id) || c.host.open.file(deep.id))) {
		c.lastTap = undefined;
		return;
	}
	if (isSecondTap(c.lastTap, hit.id, performance.now()) && deep && (deep.node.type !== "rectangle" || !c.host.open.cardOf(deep.id)) && c.host.open.cardAt(deep, at, { x: e.clientX, y: e.clientY })) {
		c.lastTap = undefined;
		return;
	}
	if (isSecondTap(c.lastTap, hit.id, performance.now()) && deep && (TEXTY.has(deep.node.type) || c.host.open.shapeOf(deep.id))) {
		c.lastTap = undefined;
		const shape = c.host.open.shapeOf(deep.id);
		if (shape && !TEXTY.has(deep.node.type)) c.host.open.shapeWords(shape);
		else c.host.open.text(deep);
		return;
	}
	const href = c.host.mode() === "browse" ? c.host.linkAt(at) : undefined;
	if (href) return c.editor.openLink(href);
	c.lastTap = { id: hit.id, at: performance.now() };
	// A second tap on the one thing selected keeps it selected.
	if (selected.length === 1 && selected[0] === hit.id) return;
	c.host.onSelect(undefined);
	c.editor.pickPages([]);
	c.editor.select([hit.id]);
}

// The press and the double-click that start it all.
/**
 * A press on the stage (`core/dispatch.ts` decides what it starts). The drawing, in either mode:
 * an armed tool makes its item; otherwise a press on an item picks it up, a shift-press adds it
 * to the selection or takes it out, and a drag on empty canvas draws a marquee. A finger goes to
 * the stage's pool, and on the drawing it taps and carries. The camera pans with Space and a
 * drag, the middle button, a scroll or a pinch: that is the stage's (`PointerHost`, `pan`).
 *
 * Touch is asked of the event rather than of the screen size: a laptop with a touchscreen has
 * both, and each pointer should mean what it means. `preventDefault` is not called for a finger —
 * the frames' `touch-action` is what stops the browser scrolling, and swallowing the default
 * here would take focus away from the composer mid-sentence.
 */
function onPointerDown(c: PointerCtx, event: PointerEvent) {
	const element = c.host.element();
	const kind = event.pointerType;
	/*
	 * A Pencil on bare canvas is a stroke, whatever tool is in hand: the pen comes on by itself and
	 * the press starts the stroke, as on an iPad's own apps. On an item it still selects and moves
	 * as a pointer does, and a finger is never this.
	 */
	if (kind === "pen" && event.button === 0 && c.host.editable() && !c.host.drawing() && c.host.tool() === "select" && onCanvas(c, event.target) && !pickAtHere(c, worldAt(c, event)) && !pictureUnder(c, event) && c.host.pencil?.(event)) return;
	const act = decidePress({
		pointer: kind === "touch" || kind === "pen" ? kind : "mouse",
		button: event.button,
		target: pressTarget(element, event.target),
		editable: c.host.editable(),
		drawing: c.host.drawing(),
		tool: c.host.tool(),
		space: c.host.spaceHeld(),
		fingers: c.host.fingers(),
		onItem: () => !!pickAtHere(c, worldAt(c, event)),
		picture: () => pictureUnder(c, event),
	});
	// A finger that presses something rather than the canvas is the editor's, not the browser's to scroll with.
	if (kind === "touch" && act.do !== "touch" && act.do !== "pan") c.host.keepTouch?.(event);
	switch (act.do) {
		case "make":
		case "press":
			penPress(c, event);
			return;
		case "picture":
			if (!act.carry || !dragPage(c, act.path, event, element)) selectPage(c, act.path);
			return;
		case "touch":
			// The touch first: it clears the selection for a finger on bare stage, which a board's picture lies on,
			// so selecting the board before it was undone by the same press.
			c.host.beginTouch(event);
			if (act.picture) {
				selectPage(c, act.picture);
				return;
			}
			if (act.then === "drawing") touchOnDrawing(c, event);
			else if (act.then === "deselect") tapToDeselect(c, event);
			return;
		case "pan":
			c.host.pan(event, { deselect: act.deselect, middle: act.middle });
			return;
		case "nothing":
			return;
	}
}

/**
 * A double-click on empty canvas: a note there, open for typing — what the Note tool and a
 * click there make (`InsertMenu`'s `noteAt`). A double-click on an item reaches into it instead.
 *
 * "Empty" is the stage's own element with no board's picture under the point: not a board, its
 * title bar, something drawn, or anything laid over the drawing (the editor a note's words are
 * typed in is one, and a double-click there picks a word).
 */
function onDblClick(c: PointerCtx, event: MouseEvent) {
	// Pressed on something else (a handle whose edit moved it away): not a double-click on what is under the pointer now.
	// A press on the drawing's hit shapes is captured by the stage, so its click lands on the stage: the same place.
	// So is a press on a size handle that the first click put over a small item: the item is still under it.
	const sizer = (c.pressedOn as Element | null)?.closest?.(".pen-handle[data-handle]");
	const overItem = !!sizer && sizer.getAttribute("data-handle") !== "radius" && event.target === c.host.element() && !!pickAtHere(c, worldAt(c, event), { deep: true });
	const sameSpot = c.pressedOn === event.target || (onDrawn(c, c.pressedOn) && event.target === c.host.element()) || overItem;
	if (!sameSpot) return;
	if (c.host.editable() && !c.host.drawing() && onCanvas(c, event.target)) {
		// The second press of a quick double-click on a tool's first item is not a request for a note.
		if (performance.now() - c.host.madeAt() < MADE_MS) return;
		// A double-click reaches into what is one thing (a shape, a file, a card): words open for rewriting, anything else is selected on its own.
		const hit = pickAtHere(c, worldAt(c, event), { deep: true });
		// A film or a sound starts: a double-click is how a board is opened too, so it is the same gesture.
		// A film or a sound: its first press already started it, so the second is only a press.
		if (hit && mediaOf(hit.node)) {
			c.editor.select([hit.id]);
			return;
		}
		// A file shown live: a web page taken into, an SVG opened in a tab.
		if (hit && c.host.open.liveFile(hit.id)) return;
		// A file's chip opens the file, in a tab of its own.
		if (hit && c.host.open.file(hit.id)) return;
		// A card opens for typing: at the words, or with a new line in the gap that was double-clicked.
		if (hit && (hit.node.type !== "rectangle" || !c.host.open.cardOf(hit.id)) && c.host.open.cardAt(hit, worldAt(c, event), { x: event.clientX, y: event.clientY })) return;
		// A shape's words open for typing, and a shape with none gets them (`openShapeWords`).
		const shape = hit ? c.host.open.shapeOf(hit.id) : undefined;
		if (shape && !(hit && TEXTY.has(hit.node.type))) {
			c.host.open.shapeWords(shape);
			return;
		}
		if (hit && TEXTY.has(hit.node.type)) {
			c.host.open.text(hit);
			return;
		}
		if (hit && !c.editor.items().includes(hit.id)) {
			c.editor.select([hit.id]);
			return;
		}
	}
	// Nothing can be added where nothing can be written: a canvas opened from a file.
	if (!c.host.editable() || c.host.drawing()) return;
	if (event.target !== c.host.element() || pictureUnder(c, event)) return;
	// On an item that took none of the above (one already selected, say): it is not empty canvas.
	if (pickAtHere(c, worldAt(c, event), { deep: true })) return;
	if (performance.now() - c.pannedAt < PANNED_MS) return;
	// A finger's two taps already made it (`tapToDeselect`); a touch screen's own dblclick is the same gesture.
	if (performance.now() - c.host.madeAt() < MADE_MS) return;
	c.host.noteAt(event);
}

// What a page's frame reads of the editor and says back to it.
/** The item on the drawing that is this page, by its path as the item names it or by its end. */
function pageItemId(c: PointerCtx, path: string) : string | undefined {
	if (c.host.scene.pageItem) return c.host.scene.pageItem(path);
	let ends: string | undefined;
	for (const one of c.host.scene.items()) {
		const own = (one.node.metadata as { path?: unknown } | undefined)?.path;
		if (typeof own !== "string") continue;
		if (own === path) return one.node.id;
		if (!ends && path.endsWith(own)) ends = one.node.id;
	}
	return ends;
}

function pageView(c: PointerCtx, path: string) : PageView {
return ({
		// Carried by the page drag in hand, or gliding to where a change put its item (`editor.glide`, by the item or an ancestor's shift).
		shift: () => {
			const drag = c.editor.pageDrag()?.paths.includes(path) ? c.editor.pageDrag() : undefined;
			const glide = c.editor.glide();
			if (!glide?.size) return drag;
			const id = pageItemId(c, path);
			const gliding = id ? glideShift(glide, c.host.scene, id) : undefined;
			if (!gliding || (!gliding.dx && !gliding.dy)) return drag;
			return { dx: (drag?.dx ?? 0) + gliding.dx, dy: (drag?.dy ?? 0) + gliding.dy };
		},
		resized: () => (c.editor.pageResize()?.path === path ? c.editor.pageResize() : undefined),
		hover: (on) => {
			if (on) c.editor.hover({ board: path });
			else if (untrack(c.editor.hoverPage) === path) c.editor.hover({ board: undefined });
		},
		press: (event, on) => (c.host.editable() ? dragPage(c, path, event, on) : false),
		dragging: (at) => c.editor.setOwnDrag(at ? { path, ...at } : undefined),
		select: () => selectPage(c, path),
	});
}

export type Pointer = ReturnType<typeof createPointer>;
