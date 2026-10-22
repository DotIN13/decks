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
 * A board's frame reads what the editor says about it through `boardView(path)`, and nothing else.
 */
import { mediaOf, type MediaItem, type PenNode } from "@decks/pen";
import { batch, onCleanup, untrack } from "solid-js";
import { setPenSheet } from "../../state/pen-tools.ts";
import { decideHover, decidePress, DRAG_SLOP_PX, isBareSecondTap, isSecondTap, MADE_MS, PANNED_MS, TAP_MS, TAP_SLOP_PX, type BareTap, type LastTap, type PressTarget } from "../core/dispatch.ts";
import type { ArrowHandles } from "../core/arrows.ts";
import type { BoardBox, Offset, PenTool, Pt, Rect } from "../core/model.ts";
import type { BoardHandles, Outline, RadiusHandle } from "../core/overlay.ts";
import { blockAt, pickAt, pictureAt, type Picked, type PickOptions } from "../core/pick.ts";
import type { Handle } from "../core/resize.ts";
import type { SceneQuery } from "../core/scene.ts";
import { pointerInput, type Editor } from "./controller.ts";

/** A point on the screen, as a pointer or mouse event has it. */
type Client = { clientX: number; clientY: number };

/** What the editor reads of a board, and says back about it: all a board's frame (`BoardFrame`) knows of the editor. */
export type BoardView = {
	/** How far a drag of the selection carries this board, while it does. */
	shift: () => Offset | undefined;
	/** The box the stage's handles are asking for, drawn before the file has it. */
	resized: () => Rect | undefined;
	/** The pointer came onto the board or its title bar, or left both: the hover outline. */
	hover: (on: boolean) => void;
	/**
	 * A mouse or pen press on the title bar or the edge, offered to the editor first: it moves the
	 * board with the rest of a selection and snaps it. True means it took the drag.
	 */
	press: (event: PointerEvent) => boolean;
	/** A drag of the board's own (a finger on its edge): where it is carried, `null` when it ends. */
	dragging: (at: Pt | null) => void;
	/** A press on the board: it is selected, alone unless it is part of the selection already. */
	select: () => void;
};

/** What a double-click or a double tap opens, the page's (`Stage.tsx`): each answers whether it was one. */
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
	mode: () => "browse" | "edit";
	tool: () => PenTool;
	spaceHeld: () => boolean;
	/** The boards near a stage point, in file order (the stage's spatial index): candidates for the picture under it. */
	boardsNear: (at: Pt) => readonly BoardBox[];
	/** The boards that have a node of their own to take a press. */
	rendered: () => ReadonlySet<string>;
	/** The item open for typing, whose blocks have no grip. */
	typing: () => string | undefined;
	linkAt: (at: Pt) => string | undefined;
	/** The app's selected board. */
	onSelect: (path: string | undefined) => void;
	/** Whether the app makes boards here (`Stage`'s `onCreateBoard`). */
	canCreate: () => boolean;
	/** The stage's finger pool: how many fingers are down, a finger the camera must not pan with, a finger handed to it. */
	fingers: () => number;
	claim: (pointer: number) => void;
	beginTouch: (event: PointerEvent) => void;
	/** The camera dragged from this press (`decidePress`, `pan`). */
	pan: (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => void;
	/** A tool armed: the item made from this press (`Stage`'s `penCreate`). */
	make: (event: PointerEvent, tool: Exclude<PenTool, "select">, at: Pt) => void;
	/** When a tool last made an item. */
	madeAt: () => number;
	/** The canvas menu, and opening it at a screen point. */
	menuOpen: () => boolean;
	openMenu: (event: Client) => void;
	toggleMedia: (id: string, media: MediaItem) => void;
	open: Openers;
	/** The handles the overlay draws, as drawn, for the presses on them. */
	handles: {
		item: () => Outline | undefined;
		board: () => BoardHandles | undefined;
		radius: () => RadiusHandle | undefined;
		arrow: () => ArrowHandles | undefined;
	};
};

const TEXTY = new Set(["text", "note", "prompt", "context"]);

/** Where an event landed, in `core/dispatch.ts`'s words. */
export function pressTarget(element: HTMLElement, target: EventTarget | null): PressTarget {
	if (target === element) return "stage";
	return (target as Element | null)?.closest?.(".pen-hits") ? "drawn" : "other";
}

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
	 * canvas about would leave a new board behind at the end of it.
	 */
	let pannedAt = 0;
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
		return pictureAt(host.boardsNear(at), at, host.rendered());
	};
	/**
	 * A press on a drawn item's click shape (`pen/layer.ts`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === host.element() || onDrawn(target);

	/**
	 * Follow one press to its release: `move` on each step past a 3px slop, `done` at the end.
	 *
	 * The pointer is captured by `on`, the stage unless said otherwise, and the click that ends the
	 * press goes to whatever captured it — so a press on a board's title bar keeps it on the bar, or
	 * its double-click would reach the canvas and make a board.
	 *
	 * The camera can move while the press is held (a wheel, a glide), and then the last step runs
	 * again: a `move` that reads the pointer in world space (`worldAt`) follows the cursor.
	 */
	const follow = (event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void, on: HTMLElement = host.element()) => {
		try {
			on.setPointerCapture(event.pointerId);
		} catch {
			// Refused for a pointer the browser no longer has; the listeners still end the press.
		}
		const start = { x: event.clientX, y: event.clientY };
		let moved = false;
		let last: PointerEvent | undefined;
		let over = false;
		const onMove = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId || released(e)) return;
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_SLOP_PX) return;
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
		cameraWatchers.add(replay);
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
			cameraWatchers.delete(replay);
			on.removeEventListener("pointermove", onMove);
			on.removeEventListener("pointerup", finish);
			on.removeEventListener("pointercancel", finish);
			on.removeEventListener("lostpointercapture", finish);
			window.removeEventListener("pointermove", watch, true);
			window.removeEventListener("pointerup", finish, true);
			window.removeEventListener("pointercancel", finish, true);
			done(moved, e);
		};
		on.addEventListener("pointermove", onMove);
		on.addEventListener("pointerup", finish);
		on.addEventListener("pointercancel", finish);
		on.addEventListener("lostpointercapture", finish);
		window.addEventListener("pointermove", watch, true);
		window.addEventListener("pointerup", finish, true);
		window.addEventListener("pointercancel", finish, true);
	};

	/**
	 * Follow a press the editor took to its lift (`editor/core/gesture.ts`): each move and the lift
	 * told to it, in stage coordinates. `on` captures the pointer, the stage unless said otherwise.
	 */
	const followEditor = (event: PointerEvent, on?: HTMLElement) =>
		follow(
			event,
			(e) => editor.input({ type: "move", ...pointerInput(e, worldAt(e)) }),
			(_moved, e) => editor.input({ type: "release", ...pointerInput(e, worldAt(e)) }),
			on,
		);

	/**
	 * A press on the drawing; true when it was the drawing's to handle. A tool makes its item; with
	 * the select tool the editor picks up what is under the press, or draws a marquee on bare canvas.
	 */
	const penPress = (event: PointerEvent): boolean => {
		const at = worldAt(event);
		const tool = host.tool();
		if (tool !== "select") {
			event.preventDefault();
			host.onSelect(undefined);
			editor.pickBoards([]);
			host.make(event, tool, at);
			return true;
		}
		event.preventDefault();
		if (editor.input({ type: "press-canvas", ...pointerInput(event, at) })) followEditor(event);
		return true;
	};

	/**
	 * A press on a board's title bar (`BoardFrame`), with a mouse or a pen: the stage moves it, so it
	 * moves with whatever else is selected and snaps like everything else. Shift adds the board to the
	 * selection or takes it out. A finger's drag stays the board's own, where a pinch can take it back.
	 */
	const dragBoard = (path: string, event: PointerEvent, on = event.currentTarget as HTMLElement): boolean => {
		if (event.button !== 0) return false;
		event.stopPropagation();
		event.preventDefault();
		if (editor.input({ type: "press-board", path, ...pointerInput(event, worldAt(event)) })) followEditor(event, on);
		return true;
	};

	/** A board selected by a press on it, as `BoardFrame`'s own `onSelect` does: alone, unless it is part of the selection already. */
	const selectBoard = (path: string) => {
		if (!untrack(editor.boardPicks).includes(path) && (untrack(editor.boardPicks).length || untrack(editor.items).length)) {
			editor.pickBoards([]);
			editor.select([]);
		}
		host.onSelect(path);
	};

	/** An item's handle dragged (`editor/core/gesture.ts`, `resize`); two presses on a frame's top or bottom handle hug it again. */
	const resizeFrom = (event: PointerEvent, handle: Handle) => {
		const box = host.handles.item();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.input({ type: "press-handle", handle, box, ...pointerInput(event, worldAt(event)) })) followEditor(event);
	};

	/**
	 * How round the corners are, dragged. The handle starts inside the top-left corner; pulling it
	 * along the diagonal rounds every corner by as much, up to half the shorter side, where the
	 * straight sides are gone. A shape from the library keeps it in its own `metadata.radius`, which
	 * is what redraws its outline (`@decks/pen`, `fitShapes`); pen's rectangle and frame have a
	 * `cornerRadius` of their own. It is written on the lift, not while dragging, so one drag is one
	 * edit in the file's history.
	 */
	const radiusFrom = (event: PointerEvent) => {
		const start = host.handles.radius();
		if (event.button !== 0 || !start) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.input({ type: "press-radius", handle: start, ...pointerInput(event, worldAt(event)) })) followEditor(event);
	};

	/**
	 * A board's handles, as an item's: every edge and corner, snapping to what is around, ⌘ or Ctrl
	 * to not snap, Shift to keep the shape. The board is drawn at the new box at once; letting go
	 * moves it if a left or top edge was dragged, and writes the size to its file, and the box is held
	 * until the board is at it (`editor/core/gesture.ts`, `landBoardResize`).
	 */
	const resizeBoard = (event: PointerEvent, handle: Handle) => {
		const box = host.handles.board();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.input({ type: "press-board-handle", handle, box, ...pointerInput(event, worldAt(event)) })) followEditor(event);
	};

	/**
	 * An arrow's end, picked up and put down somewhere else: on an item or a board it joins it, and
	 * follows it from then on; on bare canvas it stays at that point. Along the side it joins, the
	 * drag slides the join. What it would join lights up while it is carried, as it does while the
	 * arrow is drawn. A double-click on a joined end puts the join back in the middle of its side.
	 */
	const dragArrowEnd = (event: PointerEvent, which: "from" | "to") => {
		const ends = host.handles.arrow();
		if (event.button !== 0 || !ends) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.input({ type: "press-arrow-end", which, ends, ...pointerInput(event, worldAt(event)) })) followEditor(event);
	};

	/**
	 * The handle in an arrow's middle, dragged: an elbow's middle segment slides along its run, a
	 * curve's middle is pulled, and a straight line pulled there becomes a curve (`bendAt`). A
	 * double-click puts it back on the automatic route.
	 */
	const dragArrowBend = (event: PointerEvent) => {
		const ends = host.handles.arrow();
		if (event.button !== 0 || !ends?.middle) return;
		event.preventDefault();
		event.stopPropagation();
		if (editor.input({ type: "press-arrow-bend", ends, ...pointerInput(event, worldAt(event)) })) followEditor(event);
	};

	/** A press on a block's grip picks the block up and carries it, into another place in the card or out of it. */
	const dragBlock = (event: PointerEvent, id: string) => {
		event.preventDefault();
		event.stopPropagation();
		const on = event.currentTarget as HTMLElement;
		if (editor.input({ type: "press-block", id, ...pointerInput(event, worldAt(event)) })) followEditor(event, on);
	};

	/**
	 * The text block of a card at a stage point: the one under it, or in the card's margin, the one
	 * level with it. Not while the card is open for typing, which has its own way of moving things.
	 */
	const blockUnder = (at: Pt): string | undefined => blockAt(host.scene, at, host.typing());

	/**
	 * The outline a design tool draws round what the pointer is over, before anything is pressed:
	 * what a press there would select, and a card block's grip. The outline is edit mode's
	 * (`decideHover`): browsing selects and edits the drawing all the same, and before a press only
	 * the hand over a link and a card block's grip answer the pointer. A mouse or a pen with no button down, over the drawing; a
	 * board says when it is under the pointer (`BoardFrame`), and anything else clears the item's.
	 * Once per frame at most.
	 */
	let hoverFrame: number | undefined;
	let hoverAt: Pt | undefined;
	let hoverPoint: Client | undefined;
	let hoverLights = false;
	const onHover = (event: PointerEvent) => {
		if (event.pointerType !== "touch") editor.hover({ alt: event.altKey });
		const decided = decideHover({
			pointer: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse",
			editable: host.editable(),
			editing: host.mode() === "edit",
			drawing: host.drawing(),
			// The pointer on a block's grip keeps the grip, and the block it belongs to.
			onGrip: !!(event.target as Element | null)?.closest?.(".pen-grip"),
			buttons: event.buttons,
			tool: host.tool(),
			target: pressTarget(host.element(), event.target),
		});
		if (decided.do === "none") return;
		if (decided.do === "clear") {
			hoverAt = undefined;
			editor.hover({ ...(decided.block ? { block: undefined } : {}), item: undefined, picture: undefined, link: false });
			return;
		}
		hoverAt = worldAt(event);
		hoverPoint = { clientX: event.clientX, clientY: event.clientY };
		hoverLights = decided.outlines;
		hoverFrame ??= requestAnimationFrame(() => {
			hoverFrame = undefined;
			const href = hoverAt ? host.linkAt(hoverAt) : undefined;
			// Browsing, the hand over a link and a card block's grip, but no outline.
			if (!hoverLights) {
				editor.hover({ link: !!href && host.mode() === "browse", block: hoverAt ? blockUnder(hoverAt) : undefined, item: undefined, picture: undefined });
				return;
			}
			editor.hover({ link: !!href && host.mode() === "browse", block: hoverAt ? blockUnder(hoverAt) : undefined });
			const hit = hoverAt ? pickAtHere(hoverAt) : undefined;
			// A board with no node says nothing when the pointer is over it, so the stage asks.
			editor.hover({ item: hit && !editor.items().includes(hit.id) ? hit.id : undefined, picture: !hit && hoverAt && hoverPoint ? pictureUnder(hoverPoint) : undefined });
		});
	};
	onCleanup(() => {
		if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
	});
	/*
	 * Alt, held or let go, for the distances it shows from the selection to what is hovered
	 * (`core/overlay.ts`, `distances`): from the keys, and from each pointer move, which also says
	 * so when the key went down or up while the window was not listening.
	 */
	const altKey = (event: KeyboardEvent) => {
		if (event.key === "Alt") editor.hover({ alt: event.type === "keydown" });
	};
	const altGone = () => editor.hover({ alt: false });
	addEventListener("keydown", altKey);
	addEventListener("keyup", altKey);
	addEventListener("blur", altGone);
	onCleanup(() => {
		removeEventListener("keydown", altKey);
		removeEventListener("keyup", altKey);
		removeEventListener("blur", altGone);
	});
	const onLeave = () => {
		editor.hover({ item: undefined, link: false });
	};

	/**
	 * A tap on bare canvas lets go of the drawn items and boards selected, as a click there does
	 * (`penPress`, the marquee). On the lift, not the landing: a finger that pans or becomes a pinch
	 * keeps the selection, so you can look around something you have picked.
	 */
	const tapToDeselect = (event: PointerEvent) => {
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		let pinched = false;
		let travelled = false;
		const done = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", done);
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointer && e.pointerType === "touch") pinched = true;
			// Judged on the furthest the finger went: a pan that comes back to where it began is still a pan.
			else if (e.pointerId === pointer && Math.hypot(e.clientX - from.x, e.clientY - from.y) >= TAP_SLOP_PX) travelled = true;
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (pinched || travelled || performance.now() - since > TAP_MS) return;
			batch(() => {
				editor.select([]);
				editor.pickBoards([]);
			});
			// A second tap close by, soon after: the canvas menu, as a double-click is with a mouse.
			const now = performance.now();
			const twice = isBareSecondTap(lastBareTap, { x: e.clientX, y: e.clientY }, now);
			lastBareTap = twice ? undefined : { x: e.clientX, y: e.clientY, at: now };
			if (twice) host.openMenu(e);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", done);
	};

	/**
	 * A finger on the drawing. On an item already selected it moves the selection (the finger is
	 * claimed, so the camera stays put); anywhere else it is a pan unless it lifts where it landed,
	 * which is a tap: the item is selected, and a second tap on words opens them for typing.
	 */
	const touchOnDrawing = (event: PointerEvent) => {
		const at = worldAt(event);
		const hit = pickAtHere(at);
		if (!hit) return;
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		const selected = editor.items();
		const carrying = selected.includes(hit.id);
		if (carrying) host.claim(pointer);
		let moved = false;
		const done = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
		};
		const abandon = () => {
			done();
			editor.input({ type: "cancel" });
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			// A second finger: this was the start of a pinch, and whatever it carried goes back.
			if (host.fingers() > 1) return abandon();
			if (!moved && Math.hypot(e.clientX - from.x, e.clientY - from.y) < TAP_SLOP_PX) return;
			// The editor carries the selection from here (`editor/core/gesture.ts`, a finger's carry): picked up as it first moves.
			if (!moved && carrying) editor.input({ type: "carry", from: { at, client: from }, ...pointerInput(e, worldAt(e)) });
			moved = true;
			if (!carrying) return;
			editor.input({ type: "move", ...pointerInput(e, worldAt(e)) });
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (moved) {
				if (carrying) editor.input({ type: "release", ...pointerInput(e, worldAt(e)) });
				else editor.input({ type: "cancel" });
				return;
			}
			if (performance.now() - since > TAP_MS) return;
			const deep = pickAtHere(at, { deep: true });
			// A film or a sound: a tap plays it or pauses it, and selects it as any tap does.
			const playable = deep && mediaOf(deep.node) ? deep : mediaOf(hit.node) ? hit : undefined;
			const media = playable ? mediaOf(playable.node) : undefined;
			if (playable && media) {
				lastTap = undefined;
				host.toggleMedia(playable.id, media);
				host.onSelect(undefined);
				editor.pickBoards([]);
				editor.select([hit.id]);
				return;
			}
			if (isSecondTap(lastTap, hit.id, performance.now()) && deep && (host.open.liveFile(deep.id) || host.open.file(deep.id))) {
				lastTap = undefined;
				return;
			}
			if (isSecondTap(lastTap, hit.id, performance.now()) && deep && (deep.node.type !== "rectangle" || !host.open.cardOf(deep.id)) && host.open.cardAt(deep, at, { x: e.clientX, y: e.clientY })) {
				lastTap = undefined;
				return;
			}
			if (isSecondTap(lastTap, hit.id, performance.now()) && deep && (TEXTY.has(deep.node.type) || host.open.shapeOf(deep.id))) {
				lastTap = undefined;
				const shape = host.open.shapeOf(deep.id);
				if (shape && !TEXTY.has(deep.node.type)) host.open.shapeWords(shape);
				else host.open.text(deep);
				return;
			}
			const href = host.mode() === "browse" ? host.linkAt(at) : undefined;
			if (href) return editor.openLink(href);
			lastTap = { id: hit.id, at: performance.now() };
			// A second tap on the one thing selected asks for its properties: on a phone, the sheet.
			if (selected.length === 1 && selected[0] === hit.id) {
				setPenSheet(true);
				return;
			}
			host.onSelect(undefined);
			editor.pickBoards([]);
			editor.select([hit.id]);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId === pointer) abandon();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
	};

	/**
	 * A double-click on empty canvas: the canvas menu, there (`canvasMenu`).
	 *
	 * "Empty" is anything that is not inside a `.board-node`. The stage's own background is the
	 * common case, but a board's title bar is in *this* document too — a keystroke that lands in
	 * a board never reaches here at all, because that is another document and its events do not
	 * bubble out of a frame. So the test is the node, not the element.
	 */
	const onDblClick = (event: MouseEvent) => {
		if (host.editable() && !host.drawing() && onCanvas(event.target)) {
			// The second press of a quick double-click on a tool's first item is not a request for a board.
			if (performance.now() - host.madeAt() < MADE_MS) return;
			// A double-click reaches into what is one thing (a shape, a file, a card): words open for rewriting, anything else is selected on its own.
			const hit = pickAtHere(worldAt(event), { deep: true });
			// A film or a sound starts: a double-click is how a board is opened too, so it is the same gesture.
			// A film or a sound: its first press already started it, so the second is only a press.
			if (hit && mediaOf(hit.node)) {
				editor.select([hit.id]);
				return;
			}
			// A file shown live: a web page taken into, an SVG opened in a tab.
			if (hit && host.open.liveFile(hit.id)) return;
			// A file's chip opens the file, in a tab of its own.
			if (hit && host.open.file(hit.id)) return;
			// A card opens for typing: at the words, or with a new line in the gap that was double-clicked.
			if (hit && (hit.node.type !== "rectangle" || !host.open.cardOf(hit.id)) && host.open.cardAt(hit, worldAt(event), { x: event.clientX, y: event.clientY })) return;
			// A shape's words open for typing, and a shape with none gets them (`openShapeWords`).
			const shape = hit ? host.open.shapeOf(hit.id) : undefined;
			if (shape && !(hit && TEXTY.has(hit.node.type))) {
				host.open.shapeWords(shape);
				return;
			}
			if (hit && TEXTY.has(hit.node.type)) {
				host.open.text(hit);
				return;
			}
			if (hit && !editor.items().includes(hit.id)) {
				editor.select([hit.id]);
				return;
			}
		}
		// Nothing can be added where nothing can be written: a canvas opened from a file.
		if (!host.canCreate() && !host.editable()) return;
		/*
		 * Only on the bare stage itself. Not on a board, its title bar, something drawn, or anything
		 * laid over the drawing — the editor a note's words are typed in is one, and a double-click
		 * to pick a word in it opened the menu.
		 */
		if (event.target !== host.element() || pictureUnder(event)) return;
		if (performance.now() - pannedAt < PANNED_MS) return;
		// A finger's two taps already opened it (`onPointerDown`); a touch screen's own dblclick is the same gesture.
		if (host.menuOpen()) return;
		host.openMenu(event);
	};

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
	const onPointerDown = (event: PointerEvent) => {
		const element = host.element();
		const kind = event.pointerType;
		const act = decidePress({
			pointer: kind === "touch" || kind === "pen" ? kind : "mouse",
			button: event.button,
			target: pressTarget(element, event.target),
			editable: host.editable(),
			drawing: host.drawing(),
			tool: host.tool(),
			space: host.spaceHeld(),
			fingers: host.fingers(),
			onItem: () => !!pickAtHere(worldAt(event)),
			picture: () => pictureUnder(event),
		});
		switch (act.do) {
			case "make":
			case "press":
				penPress(event);
				return;
			case "picture":
				if (!act.carry || !dragBoard(act.path, event, element)) selectBoard(act.path);
				return;
			case "touch":
				if (act.picture) selectBoard(act.picture);
				host.beginTouch(event);
				if (act.picture) return;
				if (act.then === "drawing") touchOnDrawing(event);
				else if (act.then === "deselect") tapToDeselect(event);
				return;
			case "pan":
				host.pan(event, { deselect: act.deselect, middle: act.middle });
				return;
			case "nothing":
				return;
		}
	};

	/** What a board's frame reads of the editor and says back to it (`BoardView`). */
	const boardView = (path: string): BoardView => ({
		shift: () => (editor.boardDrag()?.paths.includes(path) ? editor.boardDrag() : undefined),
		resized: () => (editor.boardResize()?.path === path ? editor.boardResize() : undefined),
		hover: (on) => {
			if (on) editor.hover({ board: path });
			else if (untrack(editor.hoverBoard) === path) editor.hover({ board: undefined });
		},
		press: (event) => (host.editable() ? dragBoard(path, event) : false),
		dragging: (at) => editor.setOwnDrag(at ? { path, ...at } : undefined),
		select: () => selectBoard(path),
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
		onBoardHandle: resizeBoard,
		onArrowEnd: dragArrowEnd,
		onArrowBend: dragArrowBend,
		selectBoard,
		boardView,
		pictureUnder,
	};
}

export type Pointer = ReturnType<typeof createPointer>;
