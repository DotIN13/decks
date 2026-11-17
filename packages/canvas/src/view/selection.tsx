import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, type Accessor } from "solid-js";
import { type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { setPenBoxes } from "../edit/pen-tools.ts";
import { walk, type PenNode } from "@decks/pen";
import type { CanvasEngine } from "../render/engine.ts";
import {
	ANCHOR_OUT,
	ANCHOR_PX,
	arrowAnchors,
	arrowEnds as arrowEndsOf,
	pageHandles as pageHandlesOf,
	deleteOps,
	distances as distancesOf,
	dropBox as dropBoxOf,
	duplicateOps,
	gripBox as gripBoxOf,
	gripHidden,
	hoverBox as hoverBoxOf,
	itemHandles,
	kinOutlines,
	radiusHandle as radiusHandleOf,
	selectionFrame,
	selectionOutlines,
	type Overlay,
	type CanvasEditor,
	type tsScene,
} from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import { createPills } from "./pills.tsx";
import { createOverlayModel } from "./overlay-model.ts";
import { createPenActions } from "./pen-actions.ts";
import { createPillObstacles } from "./pill-obstacles.ts";

/** What the selection's drawing needs of the stage around it. */
type SelectionDeps = {
	props: CanvasViewProps;
	ctl: CameraController;
	view: () => Viewport;
	editor: CanvasEditor;
	scene: ReturnType<typeof tsScene>;
	penLayer: CanvasEngine;
	/** Counted up each time the engine lays the drawing out. */
	penDrawn: Accessor<number>;
	/** Fit boxes into the canvas column (`CanvasView.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** Send the person's edits to the drawing (`CanvasView.tsx`, `penEdit`). */
	penEdit: (ops: unknown[]) => void;
	freshIds: (...also: string[]) => () => string;
	/** An item as the file has it (`CanvasView.tsx`, `penNode`). */
	penNode: (id: string) => PenNode | undefined;
	/** A press is held on the canvas (`input.ts`): the drawn items' pill steps aside. */
	pressHeld: Accessor<boolean>;
};

/**
 * What is drawn over the selection and under the pointer: outlines, handles, anchors, the hover,
 * grip, kin and distance boxes, the overlay they make together, and the pills over a board, drawn
 * items and the lasso, with what the pills do. Made inside `CanvasView`, after the editor, which it reads.
 */
export function createSelection(deps: SelectionDeps) {
	const { props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, freshIds, penNode, pressHeld } = deps;
	const { moving, scaling, gliding, panning, push: pushCamera } = ctl;

	/** More than one thing picked together, boards among them or not: the pill goes over the whole group (`calloutItems`). */
	const groupPicked = () => editor.pagePicks().length + editor.items().length > 1;
	// After the editor, which it reads: a stage made with a board already selected reads it at once.
	const calloutPage = createMemo(() => (props.selected && !groupPicked() ? props.boards.find((board) => board.path === props.selected) : undefined));
	const calloutPath = createMemo(() => calloutPage()?.path);

	/** Select what was just asked for, which the drawing does not have until the server answers. */
	const selectMade = (made: string[]) => editor.selectMade(made);
	const shownDrag = editor.shownDrag;
	/** Where each selected item is now, moved by any drag and sized by any resize in progress (`editor/core/overlay.ts`). */
	const penOutlines = createMemo(() => {
		penDrawn();
		return selectionOutlines(
			{
				selection: editor.items(),
				typing: editor.typing(),
				drag: shownDrag(),
				glide: editor.glide(),
				resize: editor.shownResize(),
				boards: scene.boards(),
				pagePicks: editor.pagePicks(),
				pageDrag: editor.pageDrag(),
				ownDrag: editor.ownDrag(),
				selected: props.selected,
				pageResize: editor.pageResize(),
				marquee: editor.marquee(),
			},
			scene,
		);
	});
	/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
	const penHandles = createMemo(() => itemHandles(penOutlines(), scene, ctl.zoom()));
	/**
	 * A card is as tall as the markdown in it (`@decks/pen`, `textSize`), the way it is when one is
	 * made. So it is sized by its width alone: the two side handles, and no height written to the
	 * file. Dragging a corner used to pin a height on it, and from then on its words were cut off or
	 * swam in space.
	 */
	const penAnchors = createMemo(() => arrowAnchors(penHandles(), { editable: !!props.onPenEdit, drafting: !!editor.draft(), resizing: !!editor.resize() }, scene));
	/*
	 * Where each selected item is, for the properties panel's position and size: the box the stage
	 * draws, kept current as the drawing changes (`state/pen-tools.ts`).
	 */
	createEffect(() => {
		penDrawn();
		const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const id of editor.items()) {
			const box = penLayer.placed.get(id)?.box;
			if (box) boxes.set(id, { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		setPenBoxes(boxes);
	});
	/** The selected board's box, when it alone is selected and can be resized: the same eight handles as an item. */
	const pageHandles = createMemo(() => pageHandlesOf(penOutlines(), { resizable: !!props.onResize, carrying: !!editor.pageDrag() || !!editor.ownDrag(), boards: scene.boards(), zoom: ctl.zoom() }));

	const { pillObstacles } = createPillObstacles({
		props,
		penLayer,
	});

	/** The words an item shows, its own or its children's, on one line: what a comment on it quotes. */
	const quoteOf = (node: PenNode | undefined): string => {
		if (!node) return "";
		const said: string[] = [];
		for (const one of walk([node])) if (typeof one.content === "string" && one.content.trim()) said.push(one.content.trim());
		return said.join(" ").replace(/\s+/g, " ").slice(0, 120);
	};
	const { penDuplicate, penDeleteSelected } = createPenActions({
		editor,
		scene,
		penLayer,
		penEdit,
		freshIds,
		selectMade,
	});

	const { calloutItems, canvasPenPath, lassoItems, radiusHandle, arrowEnds, overlay } = createOverlayModel({
		editor,
		scene,
		penHandles,
		props,
		penLayer,
		groupPicked,
		penOutlines,
		quoteOf,
		penDrawn,
		shownDrag,
		panning,
		penAnchors,
		pageHandles,
	});

	const { pills } = createPills({
		props,
		calloutPath,
		calloutPage,
		pillObstacles,
		moving,
		panning,
		scaling,
		gliding,
		editor,
		ctl,
		view,
		pushCamera,
		frame,
		calloutItems,
		penAnchors,
		pressHeld,
		canvasPenPath,
		penNode,
		penDuplicate,
		penDeleteSelected,
		lassoItems,
		scene,
		freshIds,
		penEdit,
	});

	return { penHandles, pageHandles, radiusHandle, arrowEnds, penDeleteSelected, penDuplicate, overlay, pills };
}
