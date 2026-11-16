// The canvas element: its props, the component that makes each part in order and draws the outer element,
// and the parts made here: input, the engine, the items, the overlay's colours, the selection, probes, the pen.
import { probes } from "../debug.ts";
import type { JSX } from "solid-js";
import type { Page, Camera } from "@decks/protocol-old";
import { createEffect, type Component, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { boxOf, fitInto, toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { stagePoint } from "../camera/coords.ts";
import type { ItemSlotProps } from "../items/item-slot.tsx";
import type { DocEdits, DrawingWriter } from "../render/types.ts";
import { docIndex } from "../drawing/doc-index.ts";
import { strokeOf } from "../ink/model.ts";
import { penLive, penTool, setPenLive, setPenTool, type PenTool } from "../editor/pen-tools.ts";
import { overlayJson } from "../editor/core/overlay-json.ts";
import { rgbOf } from "../editor/dom/colours.ts";
import { COARSE, HANDLE_DOT_PX } from "../input/touch-rules.ts";
import { ANCHOR_OUT, ANCHOR_PX } from "../editor/dom/OverlayLayer.tsx";
import { scheme } from "../theme.ts";
import { isCard, ids as penIds, newId, type PenDocument } from "@decks/pen";
import { StageEngine } from "../render/engine.ts";
import { ENGINE, LAYERS } from "../render/device.ts";
import { dropSlot as dropSlotIn, frameUnder as frameUnderIn, idMaker, moveOps, tsScene } from "../editor/index.ts";
import { createStageInput } from "../input/canvas-input.ts";
import { createItemsLayer } from "./items-layer.tsx";
import { createSelection } from "./selection.tsx";
import type { InkRequest, StageComment, StageShots } from "../types.ts";
import { worldHostOf, worldLayerOf, fixedLayerOf } from "./canvas-markup.tsx";
import { builtOnce } from "./built-once.ts";
import { editorEffectsOf, editorPointerOf, editorOf } from "./canvas-editor.ts";
import { elementAndEngine, worldPlacement, cameraOf, scrollFollows } from "./canvas-camera.ts";

export type { InkRequest, StageComment, StageShots } from "../types.ts";

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
	boards: Page[];
	/**
	 * This chat's stage drawing: its `.pen` document and the folder URL its image fills are read
	 * against (`render/engine.ts`). Drawn under the boards, with the same camera. `edits`, when the
	 * host has them: what made this drawing from the one it gave before, applied by the engines in
	 * place of finding what changed (`render/engine-doc.ts`, `setDoc`).
	 */
	pen?: { doc: PenDocument; base: string; edits?: DocEdits; writer?: DrawingWriter; /** The person's own edit or step, drawn by their hand already: nothing to glide. */ own?: true };
	/**
	 * The person's edits to the drawing, as pen operations (`stage.pen.edit` on the wire, `decks.canvas.batch` for an agent). Absent
	 * means the drawing is read-only here. Edits are made in edit mode only, so browsing the canvas
	 * never picks a note up by accident.
	 */
	onPenEdit?: (ops: unknown[]) => void;
	/** Take back the person's last edit to the drawing, or put it back (`stage.pen.step`). */
	onPenStep?: (direction: "undo" | "redo") => void;
	/** The draw tool is on: pen, marker, eraser and lasso draw on the stage (`ink/InkLayer.tsx`). */
	drawing?: boolean;
	/** A Pencil pressed bare canvas with the select tool: turn the pen on (and leave edit mode), so the press can start a stroke. */
	onPencil?: () => void;
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
	/** The host's own layer in the world, in canvas units (`CanvasOptions.world`). */
	world?: () => JSX.Element;
	/** The stage's engine, once made: for what the editor's handle answers from its layout (`itemBox`). */
	onEngine?: (engine: StageEngine) => void;
	/** A picture of a card to download, from the card pill's ⋯ menu (absent: no Export there). */
	onExport?: (ids: string[], format?: "png" | "pdf") => void;
	/** Delete a board: off the canvas and its file gone (the board pill's Delete). */
	onDeleteCard?: (path: string) => void;
	/** The stage being shown, by folder name: a drawing act is drawn only on its own stage. */
	stageName?: string | undefined;
	/** The boards that are news, by path, each with the colour its glow is drawn in (`items/news.ts`). */
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
	onRefer?: (pills: Array<{ kind: "card" | "item"; id: string; label: string; name?: string }>) => void;
};

/** The props, as the parts take them. */
export type Props = StageProps;

/*
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
/**
 * The canvas, made part by part in order: its camera (`canvas-camera.ts`), input, editor's host
 * (`canvas-editor.ts`), placed items, selection, and the world and chrome (`canvas-markup.tsx`).
 */
export function Stage(props: Props) {
	const { Frame, element, worldEl, penLayer, ahead, cameraChanged, view, setView } = elementAndEngine({ props });
	const { origin, worldOrigin, setWorldOrigin, worldPlaced, ownScroll, placeWorld, placeScroll, zoomScroll, zoomStill, placedZoom } = worldPlacement({ element, props, view, worldEl });
	const { ctl } = cameraOf({ cameraChanged, element, origin, penLayer, placedZoom, placeScroll, placeWorld, props, setWorldOrigin, view, worldEl, zoomScroll, zoomStill });
	const { moving, scaling, gliding, panning, scrolled } = scrollFollows({ ctl, element, origin, ownScroll, penLayer, placeScroll, placeWorld, setWorldOrigin, view, zoomScroll, zoomStill });
	const { frame, holdMenu, setHoldMenu, penEdit, worldAt, freshId, freshIds, penNode, input, grabbing } = editsAndInput({ ahead, ctl, element, penLayer, props, scrolled, setView, view });
	const { engineNotice, scene } = engineOf({ penLayer, props, view });
	const { penDrawn, setPenDrawn, editorEffects } = editorEffectsOf({ ahead, ctl, element, penLayer, props, view });
	const { editorPointer } = editorPointerOf({ ahead, element, grabbing, input, penLayer, props, setHoldMenu, worldAt });
	// A part whose effects read what a later part makes gets a forwarder, `(...a) => x(...a)`, so each part keeps its place in the order the effects were made.
	const { editor } = editorOf({ ahead, armPenTool: (...a: Parameters<typeof armPenTool>) => armPenTool(...a), ctl, editorEffects, editorPointer, freshId, freshIds, penDrawn, penEdit, penLayer, props, scene, view, worldAt, worldEl });
	const { items } = itemsOf({ ahead, ctl, editor, element, frame, Frame, gliding, input, moving, panning, penDrawn, penLayer, props, scaling, view });
	const { engineOverlays } = overlayColours({ ahead, ctl, editor, element, penLayer, props, setPenDrawn });
	const { selection } = selectionOf({ ahead, ctl, editor, frame, freshIds, input, items, penDrawn, penEdit, penLayer, penNode, props, scene, view });
	const { inkStrokes } = checkProbes({ ctl, dropSlot: (...a: Parameters<typeof dropSlot>) => dropSlot(...a), editor, element, frameUnder: (...a: Parameters<typeof frameUnder>) => frameUnder(...a), penDrawn, penLayer, penNode, view, worldAt });
	readingNews({ props });
	const { armPenTool, penMoveBy, frameUnder, dropSlot, overLink } = penTools({ editor, penEdit, props, scene });
	openingFit({ frame, props, view });
	const { worldHost } = worldHostOf({ ctl, props, worldOrigin, worldPlaced });
	const { worldLayer } = worldLayerOf({ ctl, editor, items, penLayer, selection, worldEl, worldHost });
	const { fixedLayer } = fixedLayerOf({ ctl, editor, engineNotice, freshId, holdMenu, inkStrokes, penEdit, penLayer, penMoveBy, penNode, props, selection, setHoldMenu, view });

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
			data-engine-overlays={engineOverlays() ? "true" : undefined}
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
			ref={element.now}
			onWheel={input.onWheel}
			onPointerDown={editor.onPointerDown}
			onPointerMove={editor.onPointerMove}
			onPointerLeave={editor.onPointerLeave}
			onDblClick={editor.onDblClick}
			style={{ cursor: grabbing() ? "grab" : overLink() ? "pointer" : undefined }}
		>
			{/* The scrolled content: the world in it, and over it the stage's own chrome held to the window (`camera/scroll-area.ts`). */}
			<div class="stage-content">
				{/* Built once, untracked (`built-once.ts`): a signal read at their top would rebuild every card. */}
				{builtOnce(worldLayer)}
				{builtOnce(fixedLayer)}
			</div>
		</div>
	);
}

/** Fitting into the canvas column, editing the drawing, new ids, and what the stage hears from the person. */
export function editsAndInput(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; ctl: ReturnType<typeof cameraOf>["ctl"];
	element: ReturnType<typeof elementAndEngine>["element"]; penLayer: ReturnType<typeof elementAndEngine>["penLayer"];
	props: Props; scrolled: ReturnType<typeof scrollFollows>["scrolled"];
	setView: ReturnType<typeof elementAndEngine>["setView"]; view: ReturnType<typeof elementAndEngine>["view"];
}) {
	const { ahead, ctl, element, penLayer, props, scrolled, setView, view } = ctx;

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

	/** A hold's menu, open at the finger (`chrome/HoldMenu.tsx`): the items held, or none for bare canvas. */
	const [holdMenu, setHoldMenu] = createSignal<{ ids: string[]; at: { x: number; y: number }; stage: { x: number; y: number } } | undefined>();
	const penEdit = (ops: unknown[]) => {
		if (ops.length) props.onPenEdit?.(ops);
	};
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(ctl.now(), view(), stagePoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());
	/** Ids for several new items at once, none the same as another, as any on the stage, or as `also`. */
	const freshIds = (...also: string[]) => idMaker([...(props.pen ? penIds(props.pen.doc) : []), ...also]);
	/** An item as the file has it, not as a preview has drawn it. */
	const penNode = (id: string) => (props.pen ? docIndex(props.pen.doc).get(id)?.node : undefined);

	/* What the stage hears from the person (`canvas-input.ts`): made where its listeners were, before the engine. */
	const input = createStageInput({
		props,
		element: () => element.now,
		ctl,
		view,
		frame,
		editor: () => ahead.editor,
		scrolled,
		measured: (viewport) => {
			setView(viewport);
			props.onViewport?.(viewport);
		},
		scrollBy: (at, by) => penLayer.scrollBy(at, by),
		worldAt,
	});
	const { grabbing } = input;
	return { frame, holdMenu, setHoldMenu, penEdit, worldAt, freshId, freshIds, penNode, input, grabbing };
}

/** The engine told who holds it, what it says when it cannot start, and the scene the editor asks of it. */
export function engineOf(ctx: {
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; props: Props;
	view: ReturnType<typeof elementAndEngine>["view"];
}) {
	const { penLayer, props, view } = ctx;

	props.onEngine?.(penLayer);
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
		penLayer.setDoc(props.pen?.doc, props.pen?.base ?? "", props.pen?.edits, props.pen?.own === true);
		// The drawing has the change in it now, so the panel is no longer showing one (`penLive`).
		if (untrack(penLive)) setPenLive(undefined);
	});
	return { engineNotice, scene };
}

/** Writers' colours as the sheet paints them, and the placed items. */
export function itemsOf(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; ctl: ReturnType<typeof cameraOf>["ctl"];
	editor: ReturnType<typeof editorOf>["editor"]; element: ReturnType<typeof elementAndEngine>["element"];
	frame: ReturnType<typeof editsAndInput>["frame"]; Frame: ReturnType<typeof elementAndEngine>["Frame"];
	gliding: ReturnType<typeof scrollFollows>["gliding"]; input: ReturnType<typeof editsAndInput>["input"];
	moving: ReturnType<typeof scrollFollows>["moving"]; panning: ReturnType<typeof scrollFollows>["panning"];
	penDrawn: ReturnType<typeof editorEffectsOf>["penDrawn"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; props: Props;
	scaling: ReturnType<typeof scrollFollows>["scaling"]; view: ReturnType<typeof elementAndEngine>["view"];
}) {
	const { ahead, ctl, editor, element, frame, Frame, gliding, input, moving, panning, penDrawn, penLayer, props, scaling, view } = ctx;

	const resolvedColours = new Map<string, string>();
	/**
	 * A writer's colour as the sheet can paint it. A board with no writer's colour glows in
	 * `var(--canvas-accent)`, which a canvas does not understand: the 2D one drew it in its default
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
		const color = resolveColour(writer?.color ?? "var(--canvas-accent)");
		penLayer.setWriter(writer?.name ? { name: writer.name, color } : { color });
	});

	/* The placed items (`items-layer.tsx`): which are near, have a slot and are awake, and the one playing. */
	const items = createItemsLayer({
		props,
		Frame,
		element: () => element.now,
		ctl,
		view,
		editor,
		penLayer,
		penDrawn,
		resolveColour,
		frame,
		gestures: input.gestures,
	});
	ahead.items = items;

	createEffect(() => penLayer.setMoving(panning() || scaling() || moving() || gliding()));
	return { items };
}

/** The editor's outlines painted by the engine, in the colours read through the browser, and each drawn frame. */
function overlayColours(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; ctl: ReturnType<typeof cameraOf>["ctl"];
	editor: ReturnType<typeof editorOf>["editor"]; element: ReturnType<typeof elementAndEngine>["element"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; props: Props;
	setPenDrawn: ReturnType<typeof editorEffectsOf>["setPenDrawn"];
}) {
	const { ahead, ctl, editor, element, penLayer, props, setPenDrawn } = ctx;
	/*
	 * The editor's outlines, handles and guides are painted by the engine with the drawing, in the same
	 * frame (`editor/core/overlay-json.ts`): written again when the overlay or the zoom changes, and the
	 * DOM's own are made invisible once the engine has them (`data-engine-overlays`, `canvas.css`).
	 */
	const [engineOverlays, setEngineOverlays] = createSignal(false);
	/*
	 * The overlay's colours, read through the browser once a scheme: on a probe of their own inside the stage
	 * (it inherits the stage's custom properties), never the stage itself. Setting `color` on the stage to read
	 * one back restyled everything under it, every card included, and it was read at every overlay change: four
	 * times a move while dragging out a shape or an arrow, which on a large screen held frames to about 48 ms.
	 */
	let colourProbe: HTMLSpanElement | undefined;
	let colours: { dark: string; accent: [number, number, number]; panel: [number, number, number]; guide: [number, number, number] } | undefined;
	const coloursFor = (dark: string, stage: HTMLElement) => {
		if (colours?.dark === dark && colourProbe?.isConnected) return colours;
		if (!colourProbe?.isConnected) {
			colourProbe = document.createElement("span");
			colourProbe.className = "stage-colour-probe";
			colourProbe.style.display = "none";
			stage.append(colourProbe);
		}
		const vars = getComputedStyle(stage);
		colours = {
			dark,
			accent: rgbOf(vars.getPropertyValue("--canvas-accent").trim() || "#2563eb", colourProbe),
			panel: rgbOf(vars.getPropertyValue("--canvas-panel").trim() || "#fff", colourProbe),
			guide: [0.949, 0.306, 0.118],
		};
		return colours;
	};
	createEffect(() => {
		const dark = scheme();
		if (!element.now) return;
		const { accent, panel, guide } = untrack(() => coloursFor(dark, element.now!));
		const json = overlayJson(ahead.selection.overlay(), ctl.zoom(), { coarse: COARSE, accent, panel, guide, handlePx: HANDLE_DOT_PX, anchorPx: ANCHOR_PX, anchorOut: ANCHOR_OUT });
		setEngineOverlays(penLayer.setOverlay(json));
	});
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
	return { engineOverlays };
}

/** Edits in both modes, the drag and glide the editor follows, and the selection drawn over it all. */
export function selectionOf(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; ctl: ReturnType<typeof cameraOf>["ctl"];
	editor: ReturnType<typeof editorOf>["editor"]; frame: ReturnType<typeof editsAndInput>["frame"];
	freshIds: ReturnType<typeof editsAndInput>["freshIds"]; input: ReturnType<typeof editsAndInput>["input"];
	items: ReturnType<typeof itemsOf>["items"]; penDrawn: ReturnType<typeof editorEffectsOf>["penDrawn"];
	penEdit: ReturnType<typeof editsAndInput>["penEdit"]; penLayer: ReturnType<typeof elementAndEngine>["penLayer"];
	penNode: ReturnType<typeof editsAndInput>["penNode"]; props: Props;
	scene: ReturnType<typeof engineOf>["scene"]; view: ReturnType<typeof elementAndEngine>["view"];
}) {
	const { ahead, ctl, editor, frame, freshIds, input, items, penDrawn, penEdit, penLayer, penNode, props, scene, view } = ctx;
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
	 * up is on its way (`render/engine.ts`, `onCarryPending`), so outlines and handles stay on the items, which
	 * the sheet still draws where they were, and both go with the pointer from the same frame.
	 */
	penLayer.onCarryPending = editor.carryPending;
	// A drop's glide: the outlines, handles and size round what glides ride with it, frame by frame.
	penLayer.onGlide = editor.setGlide;

	/* What is drawn over the selection and under the pointer, and the pills (`selection.tsx`). */
	const selection = createSelection({ props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, freshIds, penNode, pressHeld: input.pressHeld });
	ahead.selection = selection;

	/*
	 * A colour being dragged in the properties panel, drawn on the sheet before it is saved
	 * (`editor/pen-tools.ts`, `penLive`). The same preview a drag of an item uses, so the sheet draws
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
			// The dashed outline of what a tool drew goes once the item is drawn (`chrome/InsertMenu.tsx`).
			editor.insert.presented();
		};
	}
	return { selection };
}

/** For the browser checks: where drawn items, frames, pictures and cards are on screen. */
export function checkProbes(ctx: {
	ctl: ReturnType<typeof cameraOf>["ctl"]; dropSlot: ReturnType<typeof penTools>["dropSlot"];
	editor: ReturnType<typeof editorOf>["editor"]; element: ReturnType<typeof elementAndEngine>["element"];
	frameUnder: ReturnType<typeof penTools>["frameUnder"];
	penDrawn: ReturnType<typeof editorEffectsOf>["penDrawn"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; penNode: ReturnType<typeof editsAndInput>["penNode"];
	view: ReturnType<typeof elementAndEngine>["view"]; worldAt: ReturnType<typeof editsAndInput>["worldAt"];
}) {
	const { ctl, dropSlot, editor, element, frameUnder, penDrawn, penLayer, penNode, view, worldAt } = ctx;
	/** For the browser checks: where a drawn item is on screen, since most have no click shape to measure. */
	probes.penBox = (id) => {
		const placed = penLayer.placed.get(id);
		if (!placed || !element.now) return undefined;
		const box = penLayer.bounds.get(id) ?? placed.box;
		const a = toScreen(ctl.now(), view(), { x: box.x, y: box.y });
		const b = toScreen(ctl.now(), view(), { x: box.x + box.w, y: box.y + box.h });
		const r = element.now.getBoundingClientRect();
		return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
	};
	/** For the browser checks: the frame a drop at a point on the screen would go into, and its box. */
	probes.frameUnder = (clientX, clientY) => {
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

	probes.pictureAt = (x, y) => (element.now ? editor.pictureUnder({ clientX: x, clientY: y }) : undefined);
	/*
	 * The card under a screen point and the slot between its blocks there, for files dropped from the
	 * desktop (`harness/page/state/types/files.ts`): they go into the card where they land, as a picture or a file dragged
	 * from the canvas does.
	 */
	probes.cardAt = (x, y) => {
		if (!element.now) return undefined;
		const at = toWorld(ctl.now(), view(), stagePoint({ clientX: x, clientY: y } as MouseEvent));
		const id = frameUnder(at, []);
		const card = id ? penNode(id) : undefined;
		if (!id || !card || !isCard(card)) return undefined;
		return { card: id, index: dropSlot(id, at, [])?.index ?? (card.children ?? []).length, inner: editor.textEditing.cardInner(card) };
	};
	return { inkStrokes };
}

/** A card that is news, read when it is selected: said once for each change of it. */
export function readingNews(ctx: { props: Props }) {
	const { props } = ctx;
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
}

/** The pen's tools on this page: arming one, moving and dropping items, and a link under the pointer. */
export function penTools(ctx: {
	editor: ReturnType<typeof editorOf>["editor"]; penEdit: ReturnType<typeof editsAndInput>["penEdit"]; props: Props;
	scene: ReturnType<typeof engineOf>["scene"];
}) {
	const { editor, penEdit, props, scene } = ctx;

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
	return { armPenTool, penMoveBy, frameUnder, dropSlot, overLink };
}

/** Where the canvas opens, the first time this conversation's cards arrive. */
export function openingFit(ctx: { frame: ReturnType<typeof editsAndInput>["frame"]; props: Props; view: ReturnType<typeof elementAndEngine>["view"] }) {
	const { frame, props, view } = ctx;
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
}