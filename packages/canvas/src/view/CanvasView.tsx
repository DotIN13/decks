import type { JSX } from "solid-js";
import type { Page, Camera } from "@decks/protocol";
import { Show, createEffect, type Component, createMemo, createSignal, untrack } from "solid-js";
import { boxOf, fitInto, toWorld, type Viewport } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { viewPoint } from "../camera/coords.ts";
import type { ItemSlotProps } from "../items/item-slot-props.ts";
import type { DocEdits } from "../model/drawing.ts";
import type { DrawingWriter } from "../render/types.ts";
import { docIndex } from "../model/doc-index.ts";
import { CanvasInk } from "../ink/CanvasInk.tsx";
import { strokeOf } from "../model/ink.ts";
import { penLive, penTool, setInsertPanel, setPenTool, setPropsOpen, type PenTool } from "../edit/pen-tools.ts";
import { HoldMenu, type HoldAction } from "../ui/HoldMenu.tsx";
import { ids as penIds, newId, type PenDocument } from "@decks/pen";
import { CanvasEngine } from "../render/engine.ts";
import { ENGINE, LAYERS } from "../render/device.ts";
import {
	createCanvasEditor,
	dropSlot as dropSlotIn,
	frameUnder as frameUnderIn,
	idMaker,
	InsertMenu,
	moveOps,
	OverlayLayer,
	TextEditor,
	tsScene,
	tsSeam,
} from "../edit/dom/index.ts";
import { createViewInput } from "./input.ts";
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
export type { InkRequest, CanvasComment, CanvasShots } from "./types.ts";
import type { InkRequest, CanvasComment, CanvasShots } from "./types.ts";
import { setViewProbes } from "./probes.ts";
import { createEngineColours } from "./engine-colours.ts";
import { wireEditor } from "./editor-wiring.ts";
import { createWorld } from "./world.ts";
import { feedEngine } from "./engine-feeds.ts";
import { createResolvedColours } from "./resolved-colours.ts";
import { createEngine } from "./engine-setup.ts";


/** What the stage is given by its host. */
export type CanvasViewProps = {
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
	 * place of finding what changed (`stage/engine.ts`, `setDoc`).
	 */
	pen?: { doc: PenDocument; base: string; edits?: DocEdits; writer?: DrawingWriter; /** The person's own edit or step, drawn by their hand already: nothing to glide. */ own?: true };
	/**
	 * The person's edits to the drawing, as pen operations (`canvas.edit` on the wire, `decks.canvas.batch` for an agent). Absent
	 * means the drawing is read-only here. Edits are made in edit mode only, so browsing the canvas
	 * never picks a note up by accident.
	 */
	onPenEdit?: (ops: unknown[]) => void;
	/** Take back the person's last edit to the drawing, or put it back (`canvas.step`). */
	onPenStep?: (direction: "undo" | "redo") => void;
	/** The draw tool is on: pen, marker, eraser and lasso draw on the stage (`pen/CanvasInk.tsx`). */
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
	shots: () => CanvasShots;
	/**
	 * Comment on a board or on drawn items, from the button in a bar or a pill: `path` is the board
	 * (or the drawing's file, with the item ids in `items`), `anchor` where the button is on screen.
	 * Absent: no comment buttons.
	 */
	onComment?: (comment: CanvasComment) => void;
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
	onEngine?: (engine: CanvasEngine) => void;
	/** A picture of a card to download, from the card pill's ⋯ menu (absent: no Export there). */
	onExport?: (ids: string[], format?: "png" | "pdf") => void;
	/** Delete a board: off the canvas and its file gone (the board pill's Delete). */
	onDeleteCard?: (path: string) => void;
	/** The stage being shown, by folder name: a drawing act is drawn only on its own stage. */
	canvasName?: string | undefined;
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

/*
 * The stage is four files: this one, which wires the pieces together and draws the tree; `input.ts`,
 * what the stage hears from the person; `items-layer.tsx`, the placed items; and `selection.tsx`, what
 * is drawn over the selection and under the pointer.
 */
export function CanvasView(props: CanvasViewProps) {
	/* The host's board, read once: a component, not a value that changes. */
	const Frame = untrack(() => props.frame);
	let element!: HTMLDivElement;
	let worldEl!: HTMLDivElement;
	/** The camera moved: a press in hand runs its last step again (`editor/dom/pointer.ts`, `follow`). */
	const cameraChanged = () => editor.cameraMoved();
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	const { ctl, scrolled, panning, scaling, moving, gliding, worldOrigin, worldPlaced } = createWorld({
		props,
		get worldEl() {
			return worldEl;
		},
		get element() {
			return element;
		},
		view,
		get penLayer() {
			return penLayer;
		},
		cameraChanged,
	});

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

	/** A hold's menu, open at the finger (`ui/HoldMenu.tsx`): the items held, or none for bare canvas. */
	const [holdMenu, setHoldMenu] = createSignal<{ ids: string[]; at: { x: number; y: number }; stage: { x: number; y: number } } | undefined>();
	const penEdit = (ops: unknown[]) => {
		if (ops.length) props.onPenEdit?.(ops);
	};
	const worldAt = (event: { clientX: number; clientY: number }) => toWorld(ctl.now(), view(), viewPoint(event as PointerEvent));
	const freshId = () => newId(props.pen ? penIds(props.pen.doc) : new Set());
	/** Ids for several new items at once, none the same as another, as any on the stage, or as `also`. */
	const freshIds = (...also: string[]) => idMaker([...(props.pen ? penIds(props.pen.doc) : []), ...also]);
	/** An item as the file has it, not as a preview has drawn it. */
	const penNode = (id: string) => (props.pen ? docIndex(props.pen.doc).get(id)?.node : undefined);

	/* What the stage hears from the person (`input.ts`): made where its listeners were, before the engine. */
	const input = createViewInput({
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
		scrollBy: (at, by) => penLayer.questions.scrollBy(at, by),
		worldAt,
	});
	const { grabbing } = input;

	const { penLayer, scene, penDrawn, setPenDrawn, engineNotice } = createEngine({
		props,
		view,
	});
	const { editor } = wireEditor({
		scene,
		penLayer,
		props,
		ctl,
		view,
		freshIds,
		penEdit,
		get element() {
			return element;
		},
		get items() {
			return items;
		},
		worldAt,
		grabbing,
		input,
		setHoldMenu,
		get selection() {
			return selection;
		},
		get armPenTool() {
			return armPenTool;
		},
		get worldEl() {
			return worldEl;
		},
		penDrawn,
		freshId,
	});
	const { resolveColour } = createResolvedColours({
		props,
		penLayer,
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
	const { coloursFor, setEngineOverlays, engineOverlays } = createEngineColours({

	});
	feedEngine({
		get element() {
			return element;
		},
		coloursFor,
		get selection() {
			return selection;
		},
		ctl,
		setEngineOverlays,
		penLayer,
		editor,
		props,
		setPenDrawn,
	});

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
		penLayer.previews.preview(live?.length ? new Map(live.map((change) => [change.id, { dx: 0, dy: 0, set: change.set }])) : undefined);
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
	setViewProbes({
		penLayer,
		get element() {
			return element;
		},
		ctl,
		view,
		worldAt,
		get frameUnder() {
			return frameUnder;
		},
		editor,
		penNode,
		get dropSlot() {
			return dropSlot;
		},
	});
	/** The ink on the stage, each stroke in stage pixels, for the eraser and the lasso. */
	const inkStrokes = createMemo(() => {
		penDrawn();
		return [...penLayer.placed.values()].flatMap((placed) => {
			const stroke = placed.node.id.includes("/") ? undefined : strokeOf(placed);
			return stroke ? [stroke] : [];
		});
	});

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
				 * `render/engine.ts`.
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
				<svg class="pen-hits" aria-hidden="true" width="1" height="1" ref={(svg) => penLayer.questions.attachHits(svg)} />
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
				{/*
				 * The host's layer (others' cursors, outlines), in canvas units: in the world, so a pan carries it,
				 * placed as the world's children are, from the origin at the world's own origin and at the zoom.
				 */}
				<Show when={props.world}>
					{(world) => {
						/*
						 * In canvas units whatever the world's transform says: the world is written for an origin
						 * and a zoom (`placeWorld`), and while a zoom is held still it keeps an older pair, so a
						 * child in canvas units goes through the difference. Nothing when they agree.
						 */
						const transform = () => {
							const z = ctl.zoom();
							const o = worldOrigin();
							const w = worldPlaced();
							const s = z / w.zoom;
							return `translate(${w.x - o.x * s}px, ${w.y - o.y * s}px) scale(${s})`;
						};
						return (
							<div class="world-host" style={{ position: "absolute", left: "0", top: "0", "transform-origin": "0 0", transform: transform() }}>
								{world()()}
							</div>
						);
					}}
				</Show>
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
			<Show when={holdMenu()} keyed>
				{(menu) => {
					const node = menu.ids[0] ? penNode(menu.ids[0]) : undefined;
					const words = node ? String((node as { content?: unknown; name?: unknown }).content ?? (node as { name?: unknown }).name ?? "") : "";
					const preview = words ? words.slice(0, 80) : undefined;
					const tops = () => props.pen?.doc?.children?.length ?? 0;
					const actions: HoldAction[] = menu.ids.length
						? [
								{ label: "Properties", hint: "drawer", run: () => setPropsOpen(true) },
								{ label: "Duplicate", run: () => selection.penDuplicate() },
								{ label: "Bring to front", run: () => penEdit(menu.ids.map((id) => ({ op: "move", id, parent: null, index: Math.max(0, tops() - 1) }))) },
								...(props.onComment ? [{ label: "Ask the agent", hint: "→", run: () => props.onComment?.({ path: props.canvasName ? `canvases/${props.canvasName}/canvas.pen` : "the canvas", items: menu.ids, quote: preview ?? "", title: preview ?? "An item", anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(), open: true }) }] : []),
								{ label: "Delete", danger: true, run: () => selection.penDeleteSelected() },
							]
						: [
								{ label: "Add a shape…", run: () => setInsertPanel({ tab: "shapes", at: menu.stage, client: menu.at }) },
								{ label: "Add an icon…", run: () => setInsertPanel({ tab: "icons", at: menu.stage, client: menu.at }) },
							];
					return <HoldMenu at={menu.at} preview={preview} actions={actions} onClose={() => setHoldMenu(undefined)} />;
				}}
			</Show>
			<Show when={props.drawing && props.onPenEdit}>
				<CanvasInk
					camera={props.camera}
					view={view()}
					toView={(event) => toWorld(ctl.now(), view(), viewPoint(event))}
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