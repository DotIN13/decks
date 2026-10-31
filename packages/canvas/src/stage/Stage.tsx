import type { Board, Camera } from "@decks/protocol";
import { Show, createEffect, type Component, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import { boxOf, fitInto, toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { createCameraController } from "../camera/controller.ts";
import { cameraFor, nearEdge, originFor, scrollFor, worldTransform, type Origin } from "../camera/scroll-area.ts";
import { stagePoint } from "../camera/coords.ts";
import type { ItemSlotProps } from "../items/item-slot.tsx";
import type { DocEdits, DrawingWriter } from "../render/types.ts";
import { docIndex } from "../model/doc-index.ts";
import { StageInk } from "../edit/StageInk.tsx";
import { strokeOf } from "../model/ink.ts";
import { penLive, penTool, setPenLive, setPenTool, type PenTool } from "../edit/pen-tools.ts";
import { scheme } from "../lib/theme.ts";
import { isCard, ids as penIds, newId, type PenDocument } from "@decks/pen";
import { StageEngine } from "../render/engine.ts";
import { ENGINE, LAYERS } from "../render/device.ts";
import {
	createStageEditor,
	dropSlot as dropSlotIn,
	frameUnder as frameUnderIn,
	idMaker,
	InsertMenu,
	moveOps,
	OverlayLayer,
	TextEditor,
	tsScene,
	tsSeam,
} from "../edit/index.ts";
import { createStageInput } from "./input.ts";
import { createItemsLayer } from "./items-layer.tsx";
import { createSelection } from "./selection.tsx";


/**
 * The stage: one transform over the boards, and the gestures that move it.
 *
 * The boards live in world coordinates and never learn about the camera except to
 * counter-scale their title bars; everything else is a single CSS transform on one
 * wrapper. That is what keeps a pan at 60fps with a dozen live documents on
 * screen — the browser composites one layer instead of re-laying-out twelve.
 *
 * Gestures follow the trackpad, because that is what this is used on: two-finger
 * scroll pans, pinch zooms, and a plain wheel zooms only when a modifier says so.
 * Space or middle-button drag pans from anywhere, including across a board.
 *
 * **And they follow a hand, because a phone has no trackpad either.** A touchscreen
 * sends no wheel events at all, so every one of those gestures was missing: pinching
 * the canvas moved it about instead of zooming it, since two fingers were two
 * independent one-finger pans. Two fingers are now one gesture (`touch.ts` reduces
 * them, `pinchCamera` moves the camera) and one finger pans — the rule being that a
 * finger on the canvas moves the canvas unless it landed on something that says
 * otherwise, which on a board means a title bar or a component already selected.
 */
export type { InkRequest, StageComment, StageShots } from "../types.ts";
import type { InkRequest, StageComment, StageShots } from "../types.ts";


/** What the stage is given by its host. */
export type StageProps = {
	/**
	 * Browse or edit. The stage draws the difference so it cannot be entered unnoticed.
	 *
	 * This is the guard that replaces a confirmation dialog: pressing the pencil is one
	 * press and immediately reversible, so what stops an accident is that the canvas *looks*
	 * different for as long as it lasts, not a question you learn to dismiss.
	 */
	mode: "browse" | "edit";
	/**
	 * What the canvas should do when this conversation's boards first arrive.
	 *
	 * `undefined` means *not known yet* — see the opening effect below — and an object with no
	 * `camera` means nothing was remembered, so the canvas fits what it has.
	 */
	opening?: { camera?: Camera };
	boards: Board[];
	/**
	 * This chat's stage drawing: its `.pen` document and the folder URL its image fills are read
	 * against (`canvas/pen/layer.ts`). Drawn under the boards, with the same camera. `edits`, when the
	 * host has them: what made this drawing from the one it gave before, applied by the engines in
	 * place of finding what changed (`stage/engine.ts`, `setDoc`).
	 */
	pen?: { doc: PenDocument; base: string; edits?: DocEdits; writer?: DrawingWriter };
	/**
	 * The person's edits to the drawing, as pen operations (`stage.pen.edit` on the wire, `decks.canvas.batch` for an agent). Absent
	 * means the drawing is read-only here. Edits are made in edit mode only, so browsing the canvas
	 * never picks a note up by accident.
	 */
	onPenEdit?: (ops: unknown[]) => void;
	/** Take back the person's last edit to the drawing, or put it back (`stage.pen.step`). */
	onPenStep?: (direction: "undo" | "redo") => void;
	/** The draw tool is on: pen, marker, eraser and lasso draw on the stage (`pen/StageInk.tsx`). */
	drawing?: boolean;
	camera: Camera;
	setCamera: (camera: Camera) => void;
	/**
	 * A camera to *arrive* at rather than jump to, when the app has asked for one.
	 *
	 * A request with a token, so the stage can tell a new one from the one it is already carrying
	 * out, and the duration. See `state/camera.ts` for who asks; this file owns the pixels and the
	 * clock, which is why the arithmetic is a pure function in `camera/camera.ts` and the loop is
	 * here.
	 */
	glide?: { token: number; ms: number };
	selected?: string;
	/**
	 * What draws one placed item's slot: the stage says where it is and what it may do, the host adds
	 * what it knows of its file (`item-slot.tsx`, `editor.tsx`).
	 */
	frame: Component<ItemSlotProps>;
	/** Where the picture of a board or a card comes from, for the sheet that draws every one not awake. */
	shots: () => StageShots;
	/**
	 * Comment on a board or on drawn items, from the button in a bar or a pill: `path` is the board
	 * (or the drawing's file, with the item ids in `items`), `anchor` where the button is on screen.
	 * Absent: no comment buttons.
	 */
	onComment?: (comment: StageComment) => void;
	onSelect: (path: string | undefined) => void;
	onMove: (path: string, x: number, y: number) => void;
	/** The board dragged to a new size, in board units. The file is what changes. */
	onResize?: (path: string, size: { w: number; h: number }) => void;
	onHide?: (path: string) => void;
	/**
	 * Ink selected, handed to the agent on screen (`inkAgent`): redraw it as a drawing, make a board of it,
	 * or send it as it is, to be read and acted on. Without both, the pill has no such actions.
	 */
	onInk?: (request: InkRequest) => void;
	inkAgent?: string;
	/** Delete a board: off the canvas and its file gone (the board pill's Delete). */
	onDeleteCard?: (path: string) => void;
	/** The stage being shown, by folder name: a drawing act is drawn only on its own stage. */
	stageName?: string | undefined;
	/** The boards that are news, by path, each with the colour its glow is drawn in (`board/glow.ts`). */
	news?: Record<string, string>;
	/** A card that was news was looked at (selected): said once for each change of it. */
	onRead?: (path: string) => void;
	/** So the server can answer `decks.view.camera()` with what the user can see. */
	onViewport?: (viewport: Viewport) => void;
	/** How much room a card's content took, measured where it is drawn. */
	onExtent?: (path: string, extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** A tool picked by its key, which the palette's tooltips have always claimed. */
	onTool?: (tool: "select") => void;
	/**
	 * A link on a card or in the drawing pointing at a board or card of the deck — `true` once the
	 * deck has opened it. `false` is a path this deck does not hold, which the app has already said.
	 */
	onOpenPage?: (path: string, from: string) => boolean;
	/**
	 * Dropped on the composer: talk about it rather than move it.
	 *
	 * Dragging a note or a board onto the box you are typing in is not a request to park it
	 * there, it is a request to mention it — so the drop is undone as a move and what was
	 * dragged arrives here, for the composer to write in. Whole pills rather than ids: what was
	 * dragged is the only thing that knows what to call it, a board by its title and an item by
	 * its name on the stage.
	 */
	onRefer?: (pills: Array<{ kind: "board" | "item"; id: string; label: string; name?: string }>) => void;
};

/*
 * The stage is four files: this one, which wires the pieces together and draws the tree; `input.ts`,
 * what the stage hears from the person; `items-layer.tsx`, the placed items; and `selection.tsx`, what
 * is drawn over the selection and under the pointer.
 */
export function Stage(props: StageProps) {
	/* The host's board, read once: a component, not a value that changes. */
	const Frame = untrack(() => props.frame);
	let element!: HTMLDivElement;
	let worldEl!: HTMLDivElement;
	/** The camera moved: a press in hand runs its last step again (`editor/dom/pointer.ts`, `follow`). */
	const cameraChanged = () => editor.cameraMoved();
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	/**
	 * The camera: where it is, whether it is moving, and the one place that moves it (`camera/controller.ts`).
	 * The stage hands it the window, how to place the world and the drawing at a camera, and its host's
	 * camera to follow.
	 */
	/*
	 * The stage scrolls (`camera/scroll-area.ts`): the camera's position is the stage's scroll, and the
	 * world is placed in the scrolled content at `origin`, scaled by the zoom. A pan is the browser
	 * scrolling, which moves the world on its compositor; a step of ours (a zoom, a key, a glide, a
	 * drag) sets the scroll and, when the zoom or the origin changed, the world's transform.
	 */
	let origin: Origin = { x: props.camera.x, y: props.camera.y };
	/** The origin and zoom the world's transform was last written for. */
	let worldFor: { x: number; y: number; zoom: number } | undefined;
	/** The scroll this file last set, so the scroll event that answers it is not taken for the person's. */
	let ownScroll: { left: number; top: number } | undefined;
	const placeWorld = (zoom: number, force = false) => {
		if (!force && worldFor && worldFor.x === origin.x && worldFor.y === origin.y && worldFor.zoom === zoom) return;
		worldFor = { x: origin.x, y: origin.y, zoom };
		worldEl.style.transform = worldTransform(origin, zoom);
	};
	const placeScroll = (cam: Camera) => {
		if (!element || view().width === 0) return;
		const to = scrollFor(cam, origin, view());
		ownScroll = to;
		element.scrollTo(to.left, to.top);
	};
	/**
	 * While the zoom is changing, the scroll it found when it began (read once): the view then changes
	 * by the world's origin alone (`originFor`), and the scroll is left where it is until the zoom rests.
	 * One rule for every zoom: fingers, a trackpad's pinch, Ctrl and the wheel, Safari's gesture events,
	 * the zoom keys, a glide. Setting the scroll at each step made the browser lay out and scroll the
	 * whole area: a third of a pinch's script time on an iPad mini, and 8 to 27% of a zoom's on a Mac.
	 */
	let zoomScroll: { left: number; top: number } | undefined;
	/** The zoom the world was last placed at, to tell a zoom step from a pan. */
	let placedZoom: number | undefined;
	const ctl = createCameraController({
		view,
		place: (cam) => {
			const zooming = placedZoom !== undefined && cam.zoom !== placedZoom;
			placedZoom = cam.zoom;
			if (zooming && !zoomScroll && element) zoomScroll = { left: element.scrollLeft, top: element.scrollTop };
			if (zoomScroll) {
				origin = originFor(cam, zoomScroll, view());
				placeWorld(cam.zoom, true);
				penLayer.setCamera(cam);
				return;
			}
			placeWorld(cam.zoom);
			placeScroll(cam);
			// The drawing moves in the same call as the boards, so the two can never be a frame apart.
			penLayer.setCamera(cam);
		},
		follow: (cam) => penLayer.setCamera(cam),
		moved: () => cameraChanged(),
		publish: (cam) => props.setCamera(cam),
		asked: () => ({ camera: props.camera, glide: props.glide }),
		flush: () => penLayer.flush(),
	});
	/*
	 * For the browser checks: the camera as the world's transform said it before the stage scrolled
	 * (`translate(half the window) scale(zoom) translate(−camera)`), which they read and parse; the
	 * world's own transform now holds only the origin and the zoom (`camera/scroll-area.ts`).
	 */
	(globalThis as { __decksCameraTransform?: () => string }).__decksCameraTransform = () => {
		const c = ctl.now();
		const v = view();
		return `translate(${v.width / 2}px, ${v.height / 2}px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
	};
	/*
	 * Back to the middle of the scroll area once the camera rests near an edge of it: the origin moves
	 * to the camera and the scroll to the middle in one task, so nothing on screen moves.
	 */
	createEffect(
		on(ctl.moving, (moving) => {
			if (moving || !element || view().width === 0) return;
			if (!nearEdge({ left: element.scrollLeft, top: element.scrollTop }, view())) return;
			const cam = ctl.now();
			origin = { x: cam.x, y: cam.y };
			placeWorld(cam.zoom, true);
			placeScroll(cam);
			// A zoom not yet rested keeps the scroll it now has.
			if (zoomScroll) zoomScroll = scrollFor(cam, origin, view());
		}, { defer: true }),
	);
	// The camera's motion, as the controller tracks it (`camera/controller.ts`).
	const { moving, scaling, gliding, panning } = ctl;
	// The zoom has rested: from here the scroll and the camera agree again, and a pan sets the scroll as before.
	createEffect(
		on(scaling, (now) => {
			if (!now) zoomScroll = undefined;
		}, { defer: true }),
	);
	/*
	 * The stage scrolled: the browser has moved the world already, and the camera follows. A scroll
	 * this file set (`placeScroll`) comes back here too, and is not the person's.
	 */
	const scrolled = () => {
		const at = { left: element.scrollLeft, top: element.scrollTop };
		const own = ownScroll;
		if (own && Math.abs(at.left - own.left) < 1 && Math.abs(at.top - own.top) < 1) return;
		ownScroll = undefined;
		// A scroll in the middle of a zoom (fingers, a wheel): its later steps keep the view at the scroll it moved to.
		if (zoomScroll) zoomScroll = at;
		ctl.scrolled(cameraFor(at, origin, ctl.now().zoom, view()));
	};

	/*
	 * Fit into the canvas column rather than into the whole stage.
	 *
	 * Every `fit` on this page goes through here, which is the point: the stage element is
	 * the full window, and half of what it framed used to end up behind a panel. What the
	 * boards should be framed into is the window minus the chrome standing beside it, and
	 * `camera/insets.ts` is the only thing that knows how much that is.
	 */
	const frame = (boxes: Array<{ x: number; y: number; w: number; h: number }>) =>
		fitInto(boxes, view(), canvasBox(view()));

	const penEdit = (ops: unknown[]) => {
		if (ops.length) props.onPenEdit?.(ops);
	};
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(ctl.now(), view(), stagePoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());
	/** Ids for several new items at once, none the same as another, as any on the stage, or as `also`. */
	const freshIds = (...also: string[]) => idMaker([...(props.pen ? penIds(props.pen.doc) : []), ...also]);
	/** An item as the file has it, not as a preview has drawn it. */
	const penNode = (id: string) => (props.pen ? docIndex(props.pen.doc).get(id)?.node : undefined);

	/* What the stage hears from the person (`input.ts`): made where its listeners were, before the engine. */
	const input = createStageInput({
		props,
		element: () => element,
		ctl,
		view,
		frame,
		editor: () => editor,
		scrolled,
		measured: (viewport) => {
			setView(viewport);
			props.onViewport?.(viewport);
		},
		scrollBy: (at, by) => penLayer.scrollBy(at, by),
		worldAt,
	});
	const { grabbing } = input;

	/*
	 * The stage's engine (`stage/engine.ts`): the drawing and the boards' pictures, drawn with WebGPU
	 * on two canvases, one under the item slots and one over them, in the same call that moves the
	 * slots (`writeTransform`). The document, the window's size and the colour scheme reach it here.
	 */
	const penLayer = new StageEngine();
	/* An engine that cannot start says so over the stage (`stage/backends/notice.ts`): no WebGPU and no WebGL 2, most often. */
	const [engineNotice, setEngineNotice] = createSignal<string>();
	penLayer.failed = (notice) => setEngineNotice(notice);
	onCleanup(() => penLayer.dispose());
	/** What the editor asks of the scene (`editor/core/scene.ts`), answered from the engine. */
	const scenePages = createMemo(() =>
		props.boards.map((board) => ({ path: board.path, x: board.x, y: board.y, w: board.w, h: board.h })),
	);
	const scene = tsScene(penLayer, () => props.pen?.doc, scenePages);
	createEffect(() => penLayer.setView(view()));
	createEffect(() => penLayer.setScheme(scheme()));
	/*
	 * The over canvas is inside the world only to sit after the item slots and before the
	 * selection's outlines and handles. The engine places it, in stage units, at the rectangle it last
	 * drew (the window and a margin round it), so a pan moves it with the world until it is drawn again.
	 */
	createEffect(() => {
		penLayer.setDoc(props.pen?.doc, props.pen?.base ?? "", props.pen?.edits);
		// The drawing has the change in it now, so the panel is no longer showing one (`penLive`).
		if (untrack(penLive)) setPenLive(undefined);
	});

	/*
	 * Editing the drawing by hand, in edit mode (`state/pen-tools.ts` holds the tool and reads the
	 * editor's selection, `pen/PenBar.tsx` shows them). Every change is sent as the same pen operation an
	 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
	 * or a resize is drawn as a preview.
	 *
	 * The editor (`editor/dom/controller.ts`) holds the selection, what the pointer is over, the
	 * gesture in hand and what is drawn for it, stepped by `editor/core/gesture.ts`. The handlers
	 * here follow the pointer and tell it each step.
	 */
	/** Counted up each time the engine lays the drawing out (`penLayer.drawn`): what reads where items are reads it. */
	const [penDrawn, setPenDrawn] = createSignal(0);
	const editor = createStageEditor({
		scene,
		engine: tsSeam(penLayer),
		mode: () => props.mode,
		tool: penTool,
		zoom: () => ctl.now().zoom,
		view: () => {
			const v = view();
			const a = toWorld(ctl.now(), v, { x: 0, y: 0 });
			const b = toWorld(ctl.now(), v, { x: v.width, y: v.height });
			return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
		},
		nextIds: () => freshIds(),
		boards: () => props.boards,
		onPenEdit: (ops) => penEdit(ops),
		effects: {
			element: () => element,
			toScreen: (point) => toScreen(ctl.now(), view(), point),
			box: (id) => penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box,
			cutFromCarried: (rect) => penLayer.cutFromCarried(rect),
			showCarriedLayer: (on) => penLayer.showCarriedLayer(on),
			pen: () => props.pen,
			get onRefer() {
				return props.onRefer;
			},
			get onOpenPage() {
				return props.onOpenPage;
			},
			onSelect: (path) => props.onSelect(path),
			onMove: (path, x, y) => props.onMove(path, x, y),
			onResize: (path, size) => props.onResize?.(path, size),
			toggleMedia: (id, media) => items.toggleMedia(id, media),
		},
		// The pointer's half (`editor/dom/pointer.ts`): the stage keeps the camera, its finger pool and its pan.
		pointer: {
			element: () => element,
			worldAt: (event) => worldAt(event),
			editable: () => !!props.onPenEdit,
			drawing: () => !!props.drawing,
			mode: () => props.mode,
			tool: penTool,
			spaceHeld: () => grabbing(),
			boardsNear: (at) =>
				items.pageIndex()
					.search({ x: at.x, y: at.y, w: 0, h: 0 })
					.sort((a, b) => a - b)
					.map((index) => props.boards[index]!),
			rendered: () => items.renderedPaths(),
			linkAt: (at) => penLayer.linkAt(at),
			onSelect: (path) => props.onSelect(path),
			fingers: () => input.touches.count(),
			claim: (pointer) => input.claimed.add(pointer),
			beginTouch: (event) => input.beginTouch(event),
			keepTouch: (event) => input.keptTouches.add(event.pointerId),
			pan: (event, how) => input.panFrom(event, how),
			toggleMedia: (id, media) => items.toggleMedia(id, media),
			open: { liveFile: (id) => items.openLiveFile(id) },
			handles: { item: () => selection.penHandles(), board: () => selection.pageHandles(), radius: () => selection.radiusHandle(), arrow: () => selection.arrowEnds() },
		},
		// The drawing's keys (`editor/dom/keys.ts`).
		keys: {
			editable: () => !!props.onPenEdit,
			drawing: () => !!props.drawing,
			tool: penTool,
			pageSelected: () => !!props.selected,
			selectedPage: () => props.selected,
			canStep: () => !!props.onPenStep,
			step: (direction) => props.onPenStep?.(direction),
			deleteSelected: (selected, ops) => selection.penDeleteSelected(selected, ops),
			setTool: (tool) => setPenTool(tool),
			arm: (tool) => armPenTool(tool),
			onMove: (path, x, y) => props.onMove(path, x, y),
		},
		// The words typed over an item (`editor/dom/TextEditing.tsx`).
		text: {
			pen: () => props.pen,
			scheme: () => scheme(),
			world: () => worldEl,
			redrawn: () => penDrawn(),
			editable: () => !!props.onPenEdit,
			freshId: () => freshId(),
		},
		// What a tool and a double-click on bare canvas add (`editor/dom/InsertMenu.tsx`).
		insert: {
			worldAt: (event) => worldAt(event),
			freshId: () => freshId(),
			idsBut: (id) => freshIds(id),
		},
	});
	/*
	 * Boards picked up with the drawing (`editor.pagePicks`): by a marquee, or Shift and a press on a
	 * title bar. They move with the selected items as one selection. The app's own selected board is
	 * a different thing — the one board whose page takes the keys — and a single press on a board is
	 * still only that.
	 */

	const resolvedColours = new Map<string, string>();
	/**
	 * A writer's colour as the sheet can paint it. A board with no writer's colour glows in
	 * `var(--color-accent)`, which a canvas does not understand: the 2D one drew it in its default
	 * black and Skia in nothing. So a `var()` is looked up here, on the page, in the current scheme.
	 */
	const resolveColour = (colour: string) => {
		const name = /^var\((--[\w-]+)/.exec(colour.trim())?.[1];
		if (!name) return colour;
		/* Kept per scheme: reading a computed style makes the page recalculate its styles first, and
		   the sheet's boards are re-sent on every move of a board drag, where that cost 8 ms a move. */
		const key = `${scheme()}|${name}`;
		const known = resolvedColours.get(key);
		if (known) return known;
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#3b5cf6";
		resolvedColours.set(key, value);
		return value;
	};
	/*
	 * The drawing's placeholder frames are drawn unfinished in its last writer's colour, with its name;
	 * with no writer known, in the accent and with no name.
	 */
	createEffect(() => {
		const writer = props.pen?.writer;
		const color = resolveColour(writer?.color ?? "var(--color-accent)");
		penLayer.setWriter(writer?.name ? { name: writer.name, color } : { color });
	});

	/* The placed items (`items-layer.tsx`): which are near, have a slot and are awake, and the one playing. */
	const items = createItemsLayer({
		props,
		Frame,
		element: () => element,
		ctl,
		view,
		editor,
		penLayer,
		penDrawn,
		resolveColour,
		frame,
		gestures: input.gestures,
	});

	createEffect(() => penLayer.setMoving(panning() || scaling() || moving() || gliding()));
	penLayer.drawn = () => {
		editor.textEditing.drawn();
		/*
		 * The answer to a drag has been drawn: the layout is where the drag left things, so the offset
		 * goes (`editor/core/gesture.ts`, `drawn`). Not when the answer *arrives* — the layout is only
		 * redone on the next frame, and for that frame the outline sat on the old layout with no
		 * offset, back where the drag began. A selection of items the drawing no longer has is let
		 * go then too, so the outline goes in the frame the item does.
		 */
		editor.drawn(penLayer.drawnDoc, props.pen?.doc);
		setPenDrawn((n) => n + 1);
	};
	/*
	 * The drawing is edited in both modes — browse keeps the boards' pages as they are, edit opens
	 * them for editing too — but not while the pen is out: ink has its own selection (the lasso).
	 */
	createEffect(() => {
		if (props.drawing) {
			editor.select([]);
			editor.pickPages([]);
			editor.setText(undefined);
			setPenTool("select");
		}
	});
	/*
	 * The drag as far as the canvas shows it: nothing yet while the carried picture of what was picked
	 * up is on its way (`layer.ts`, `onCarryPending`), so outlines and handles stay on the items, which
	 * the sheet still draws where they were, and both go with the pointer from the same frame.
	 */
	penLayer.onCarryPending = editor.carryPending;
	// A drop's glide: the outlines, handles and size round what glides ride with it, frame by frame.
	penLayer.onGlide = editor.setGlide;

	/* What is drawn over the selection and under the pointer, and the pills (`selection.tsx`). */
	const selection = createSelection({ props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, freshIds, penNode, pressHeld: input.pressHeld });

	/*
	 * A colour being dragged in the properties panel, drawn on the sheet before it is saved
	 * (`state/pen-tools.ts`, `penLive`). The same preview a drag of an item uses, so the sheet draws
	 * the item once per frame with the new colour in it, and the file takes one edit when the hand
	 * lifts. The worker lets it go when the saved drawing arrives.
	 */
	createEffect(() => {
		const live = penLive();
		penLayer.preview(live?.length ? new Map(live.map((change) => [change.id, { dx: 0, dy: 0, set: change.set }])) : undefined);
	});

	{
		const before = penLayer.presented;
		penLayer.presented = () => {
			before?.();
			// The typing's still copy goes once the words are on screen (`editor/dom/TextEditing.tsx`).
			editor.textEditing.presented();
			// The live files' holes, once a frame shows them (`items-layer.tsx`).
			items.presented();
			/*
			 * The resize as the sheet has drawn it, which the outline follows: each step is drawn again by
			 * the worker, a frame after the pointer, and an outline on the pointer's size ran a frame ahead
			 * of the shape at every step. Each step waits in the editor for the frame painted with it.
			 */
			editor.presented();
			// The dashed outline of what a tool drew goes once the item is drawn (`editor/dom/InsertMenu.tsx`).
			editor.insert.presented();
		};
	}
	/** For the browser checks: where a drawn item is on screen, since most have no click shape to measure. */
	(globalThis as { __decksPenBox?: (id: string) => DOMRect | undefined }).__decksPenBox = (id) => {
		const placed = penLayer.placed.get(id);
		if (!placed || !element) return undefined;
		const box = penLayer.bounds.get(id) ?? placed.box;
		const a = toScreen(ctl.now(), view(), { x: box.x, y: box.y });
		const b = toScreen(ctl.now(), view(), { x: box.x + box.w, y: box.y + box.h });
		const r = element.getBoundingClientRect();
		return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
	};
	/** For the browser checks: the frame a drop at a point on the screen would go into, and its box. */
	(globalThis as { __decksFrameUnder?: (clientX: number, clientY: number) => { frame: string | null; world: { x: number; y: number } } }).__decksFrameUnder = (clientX, clientY) => {
		const world = worldAt({ clientX, clientY });
		return { frame: frameUnder(world, []), world };
	};
	/** The ink on the stage, each stroke in stage pixels, for the eraser and the lasso. */
	const inkStrokes = createMemo(() => {
		penDrawn();
		return [...penLayer.placed.values()].flatMap((placed) => {
			const stroke = placed.node.id.includes("/") ? undefined : strokeOf(placed);
			return stroke ? [stroke] : [];
		});
	});

	(globalThis as { __decksPictureAt?: (x: number, y: number) => string | undefined }).__decksPictureAt = (x, y) => (element ? editor.pictureUnder({ clientX: x, clientY: y }) : undefined);
	/*
	 * The card under a screen point and the slot between its blocks there, for files dropped from the
	 * desktop (`app/files.ts`): they go into the card where they land, as a picture or a file dragged
	 * from the canvas does.
	 */
	(globalThis as { __decksCardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined }).__decksCardAt = (x, y) => {
		if (!element) return undefined;
		const at = toWorld(ctl.now(), view(), stagePoint({ clientX: x, clientY: y } as MouseEvent));
		const id = frameUnder(at, []);
		const card = id ? penNode(id) : undefined;
		if (!id || !card || !isCard(card)) return undefined;
		return { card: id, index: dropSlot(id, at, [])?.index ?? (card.children ?? []).length, inner: editor.textEditing.cardInner(card) };
	};

	/*
	 * Looking at a card that is news reads it: selected (a press on it, or the page putting the selection
	 * back), it is said to be read (`onRead`) once for each change of it, and its dot goes when the host
	 * hears that it was. A change after that is news again, and selecting it says so again.
	 */
	const readFor = new Map<string, string>();
	createEffect(() => {
		const path = props.selected;
		if (!path || !props.onRead || !props.news?.[path]) return;
		const board = untrack(() => props.boards.find((one) => one.path === path));
		const change = `${board?.rev ?? 0}|${board?.namedAt ?? 0}|${board?.modifiedAt ?? 0}`;
		if (readFor.get(path) === change) return;
		readFor.set(path, change);
		props.onRead(path);
	});

	const armPenTool = (tool: PenTool) => {
		// The board palette's tool goes down first: picking one of its tools puts this one down.
		if (tool !== "select") props.onTool?.("select");
		setPenTool(tool);
	};

	/** Move items by `dx dy`, into a frame or out of one when `into` says (`editor/core/ops.ts`). */
	const penMoveBy = (idsToMove: readonly string[], dx: number, dy: number, into?: string | null, slot?: number) => penEdit(moveOps(scene, idsToMove, dx, dy, into, slot));

	/**
	 * The frame a drop at a point would go into, or `null` for the stage itself (`editor/core/drop.ts`):
	 * what a live drag is aiming at is the editor's (`editor.dropInto`); this answers the page's checks.
	 */
	const frameUnder = (point: { x: number; y: number }, carrying: readonly string[]): string | null => frameUnderIn(scene, point, carrying);
	/** Where in a frame that arranges its children a drop would land (`editor/core/drop.ts`, `dropSlot`). */
	const dropSlot = (frameId: string, point: { x: number; y: number }, carrying: readonly string[]) => dropSlotIn(scene, frameId, point, carrying);

	/** A link is under the pointer: the cursor says so. */
	const overLink = editor.overLink;

	/*
	 * Where the canvas opens, the first time this conversation's boards arrive.
	 *
	 * The view this device left it in, when there is one — and otherwise a fit, so the deck opens
	 * looking at itself rather than at world origin.
	 *
	 * `props.opening` is `undefined` until the focused conversation is known, which is not always
	 * before the boards are: fitting at that moment and being told where to look a frame later is
	 * a canvas that lands somewhere and then jumps. So the effect waits for the answer rather
	 * than for the boards alone.
	 */
	let fitted = false;
	createEffect(() => {
		if (fitted || !props.opening || props.boards.length === 0 || view().width === 0) return;
		fitted = true;
		props.setCamera(props.opening.camera ?? frame(props.boards.map(boxOf)));
	});

	return (
		<div
			class="stage"
			/*
			 * Focusable, and focused when a press lands outside a board.
			 *
			 * A press on the canvas is a press on a `<div>`, and a `<div>` takes no focus — so the board's
			 * frame never learned it had lost it, `focusout` never fired inside it, and an open run or caret
			 * stayed open with its outline on while the person had visibly clicked away. Measured: pressing
			 * bare stage left the run `contenteditable` and its border drawn.
			 *
			 * `-1` because this is a place for focus to *land*, not something to tab to, and the outline is
			 * suppressed because the ring would be chrome nobody asked for.
			 */
			tabindex={-1}
			data-mode={props.mode}
			data-engine="true"
			data-panning={panning()}
			data-pen-tool={props.onPenEdit && !props.drawing && penTool() !== "select" ? penTool() : undefined}
			/* The scale is moving and the awake items go on layers (`canvas.css`), where this engine takes them (`LAYERS` in `render/device.ts`). */
			data-scaling={LAYERS[ENGINE].scaling && items.layered()}
			/* A pinch on pictures (`?card-pictures=1`): the awake cards are hidden and the sheet draws their pictures (`items-layer.tsx`). */
			data-card-pictures={items.cardsHidden() ? "true" : undefined}
			data-gliding={gliding()}
			/* The camera rests at or above this device's live zoom: items near the window have their slots. */
			data-live={items.liveNow() ? "true" : undefined}
			data-moving={moving() || panning() || gliding() ? "true" : undefined}
			/* Moving at one zoom: the world is held as one layer and slid (`canvas.css`), where this engine takes it (`LAYERS`). Off in the frame a zoom starts, so the layer is never stretched. */
			data-sliding={LAYERS[ENGINE].sliding && (moving() || panning() || gliding()) && !scaling() ? "true" : undefined}
			/* A board being moved or sized: its title bars and news glows step aside until it lands (`canvas.css`). */
			data-carrying={editor.carrying() ? "true" : undefined}
			ref={element}
			onWheel={input.onWheel}
			onPointerDown={editor.onPointerDown}
			onPointerMove={editor.onPointerMove}
			onPointerLeave={editor.onPointerLeave}
			onDblClick={editor.onDblClick}
			style={{ cursor: grabbing() ? "grab" : overLink() ? "pointer" : undefined }}
		>
			{/* The scrolled content: the world in it, and over it the stage's own chrome held to the window (`camera/scroll-area.ts`). */}
			<div class="stage-content">
			<div class="world" data-sizing={items.sizingPaths().size > 0 ? "true" : undefined} ref={worldEl}>
				{/*
				 * A place for every board on the canvas, in file order, filled while it is within reach.
				 *
				 * A list of only the boards in reach was reconciled as boards came and went, and the
				 * reconciler kept the order by moving nodes: **moving an iframe reloads its page**, and
				 * zooming out from 60 to 40% reloaded six loaded boards of twenty-three. Even a list that
				 * only gains boards in the middle is diffed with moves. So each board has a slot of its own
				 * that never moves (`display: contents`, so it lays nothing out), filled while the board
				 * is within reach: only a slot's inside changes, and boards still stack in file order.
				 */}
				{items.slots()}
				{/*
				 * The stage's one sheet — the drawing, and each board's picture or a hole over its
				 * document — and the invisible shapes that catch clicks on the drawing: after the boards,
				 * so over them; a click goes through to a board wherever nothing drawn is in the way. See
				 * `pen/layer.ts` and `pen/scene.ts`.
				 */}
				{items.fileNodes()}
				{/* The engine's canvas over the slots (`stage/engine.ts`): the pictures of boards and sleeping cards, the drawing as tiles with a hole for each awake item, and what a gesture is moving. */}
				<canvas
					class="stage-engine stage-engine-over"
					aria-hidden="true"
					ref={(canvas) => {
						penLayer.attachCanvas(canvas);
					}}
				/>
				<svg class="pen-hits" aria-hidden="true" width="1" height="1" ref={(svg) => penLayer.attachHits(svg)} />
				{/* By index, not by box: a drag makes a new box every move, and a new element for it every
				    move made the page restyle what it holds (`Index` keeps the element and moves it). */}
				<OverlayLayer
					overlay={selection.overlay}
					zoom={ctl.zoom()}
					sizing={(path) => items.sizingPaths().has(path)}
					onGrip={editor.onGrip}
					onAnchor={editor.insert.fromAnchor}
					onArrowEnd={editor.onArrowEnd}
					onArrowBend={editor.onArrowBend}
					onHandle={editor.onHandle}
					onRadius={editor.onRadius}
					onPageHandle={editor.onPageHandle}
				>
					{items.player()}
				</OverlayLayer>
				<TextEditor text={editor.textEditing} zoom={ctl.zoom()} />
			</div>
			<div class="stage-fixed" style={{ width: `${view().width}px`, height: `${view().height}px` }}>
			{/* The stage engine could not start (`penLayer.failed`): why, over the stage, where the drawing would be. */}
			<Show when={engineNotice()}>
				{(notice) => (
					<div class="stage-notice" role="alert">
						{notice()}
					</div>
				)}
			</Show>
			<InsertMenu menu={editor.insert} />
			{selection.pills()}
			<Show when={props.drawing && props.onPenEdit}>
				<StageInk
					camera={props.camera}
					view={view()}
					toStage={(event) => toWorld(ctl.now(), view(), stagePoint(event))}
					strokes={inkStrokes}
					layer={penLayer}
					onEdit={(ops) => penEdit(ops)}
					newId={freshId}
					onShift={(ids, dx, dy) => penMoveBy(ids, dx, dy)}
					{...(props.onPenStep ? { onStep: props.onPenStep } : {})}
				/>
			</Show>
			</div>
			</div>
		</div>
	);
}