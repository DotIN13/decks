import type { Offset } from "../edit/core/model.ts";
import { type Outline } from "../edit/core/overlay.ts";
import { type PageHandles } from "../edit/core/overlay.ts";
import { type SceneQuery } from "../edit/core/scene.ts";
import { createMemo, type Accessor } from "solid-js";
import { inkSelection } from "../ink/ink.ts";
import { firstLine } from "../look/look.ts";
import { parseMarkdown } from "../model/markdown.ts";
import { type PenNode } from "@decks/pen";
import type { CanvasEngine } from "../render/engine.ts";
import { arrowEnds as arrowEndsOf, distances as distancesOf, dropBox as dropBoxOf, gripBox as gripBoxOf, gripHidden, hoverBox as hoverBoxOf, kinOutlines, radiusHandle as radiusHandleOf, selectionFrame, type Overlay, type CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createOverlayModel` reads of `createSelection` (`selection.tsx`), each read when it is used. */
export interface OverlayModelNeeds {
	readonly editor: CanvasEditor;
	readonly scene: SceneQuery;
	readonly penHandles: Accessor<Outline | undefined>;
	readonly props: CanvasViewProps;
	readonly penLayer: CanvasEngine;
	readonly groupPicked: () => boolean;
	readonly penOutlines: Accessor<Outline[]>;
	readonly quoteOf: (node: PenNode | undefined) => string;
	readonly penDrawn: Accessor<number>;
	readonly shownDrag: Accessor<Offset>;
	readonly panning: Accessor<boolean>;
	readonly penAnchors: Accessor<Outline | undefined>;
	readonly pageHandles: Accessor<PageHandles | undefined>;
}

export function createOverlayModel(d: OverlayModelNeeds) {
	/** Where the frame a drag would drop into is, for the outline that says so. */
	const dropBox = createMemo(() => dropBoxOf(d.editor.dropInto(), d.scene));

	/**
	 * The one selected item's corner radius, when it has corners to round: a rounded shape from the
	 * library, or pen's own rectangle or frame. The handle that drags it sits inside the top-left
	 * corner, as it does in a drawing program, and every corner follows it.
	 */
	const radiusHandle = createMemo(() => radiusHandleOf(d.penHandles(), { editable: !!d.props.onPenEdit, resizing: !!d.editor.resize(), drag: d.editor.drag() }, d.scene));

	/**
	 * The drawn items the same pill is for, when no board has it, or a group picked together, boards
	 * among them: the box round all of it, and what to call it. Not while one is typed into (its
	 * editor has its own toolbar) or drawn with the pen.
	 */
	/*
	 * What the draw tool's lasso holds (`inkSelection`): the same pill as a selection's, so its strokes can
	 * go to the agent as the select tool's can (Make a drawing, Make a board, Send), and be commented on, duplicated or deleted.
	 */
	const lassoItems = createMemo(() => {
		if (!d.props.drawing || !d.props.onInk || !d.props.inkAgent) return undefined;
		const held = inkSelection();
		const boxes = (held?.ids ?? []).map((id) => d.penLayer.bounds.get(id) ?? d.penLayer.placed.get(id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
		if (!held || boxes.length === 0) return undefined;
		const x = Math.min(...boxes.map((b) => b.x));
		const y = Math.min(...boxes.map((b) => b.y));
		return { ids: [...held.ids], box: { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y } };
	});

	const calloutItems = createMemo(() => {
		if ((d.props.selected && !d.groupPicked()) || d.props.drawing || !d.props.onPenEdit || d.editor.text()) return undefined;
		const all = d.penOutlines().filter((one) => one.id);
		const outlines = all.filter((one) => !one.id.startsWith("page:"));
		const boards = all.length - outlines.length;
		if (outlines.length !== d.editor.items().length || boards !== d.editor.pagePicks().length || !all.length) return undefined;
		const x = Math.min(...all.map((one) => one.x));
		const y = Math.min(...all.map((one) => one.y));
		const box = { x, y, w: Math.max(...all.map((one) => one.x + one.w)) - x, h: Math.max(...all.map((one) => one.y + one.h)) - y };
		const ids = outlines.map((one) => one.id);
		/* The cards picked with them, by path: what a picture of the group takes with the items (`canvas.screenshot`'s `of`). */
		const cards = all.filter((one) => one.id.startsWith("page:")).map((one) => one.id.slice(5));
		const words = ids.map((id) => d.quoteOf(d.penLayer.placed.get(id)?.node)).filter(Boolean).join(" / ").slice(0, 160);
		const first = d.penLayer.placed.get(ids[0]!)?.node;
		const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
		const name = boards
			? [count(boards, "card"), ids.length ? count(ids.length, "item") : ""].filter(Boolean).join(", ")
			: ids.length > 1
				? `${ids.length} items`
				: words || (typeof first?.name === "string" ? first.name : first?.type) || "item";
		return { box, ids, cards, words, name };
	});

	/** One drawn item selected, not a line or a group, and nothing being drawn: it shows where an arrow can leave it. */

	/** The two ends of a selected arrow as drawn, for the handles that pick them up. */
	const arrowEnds = createMemo(() => {
		d.penDrawn();
		return arrowEndsOf({ selection: d.editor.items(), pagePicks: d.editor.pagePicks(), drag: d.shownDrag() }, d.scene);
	});

	/** Where the hovered block's grip goes: in the card's left margin, level with the block's first line. */
	const gripBox = createMemo(() => {
		d.penDrawn();
		return gripBoxOf({ block: d.editor.hoverBlock(), busy: !!d.editor.pageDrag() || d.panning(), editing: d.props.mode === "edit" }, d.scene, (id, node) => {
			// Centred on the block's first line, as the layout sets it: a heading's is taller than a paragraph's.
			const look = d.editor.textEditing.lookOf(node, d.penLayer.placed.get(id));
			return firstLine(parseMarkdown(String(node.content ?? ""))[0], look.size, look.line);
		});
	});

	/** The hovered item's box as it is drawn now, or the board under the pointer. */
	const hoverBox = createMemo(() => {
		d.penDrawn();
		return hoverBoxOf(
			{ editing: d.props.mode === "edit", item: d.editor.hoverItem(), typing: d.editor.typing(), board: d.editor.hoverPage() ?? d.editor.hoverPicture(), selected: d.props.selected, busy: !!d.editor.pageDrag() || d.panning(), boards: d.scene.boards(), glide: d.editor.glide() },
			d.scene,
		);
	});

	/** What the selection and the hovered item sit in and hold: light outlines round their parents and children. */
	const kinBoxes = createMemo(() => {
		d.penDrawn();
		return kinOutlines(
			{ selection: d.editor.items(), drag: d.shownDrag(), glide: d.editor.glide(), resizing: !!d.editor.resize(), typing: d.editor.typing(), editing: d.props.mode === "edit", hover: d.editor.hoverItem(), busy: !!d.editor.pageDrag() || d.panning() || !!d.editor.gesture() },
			d.scene,
		);
	});

	/** One box round everything selected, with its size under it. */
	const penFrame = createMemo(() => selectionFrame(d.penOutlines()));

	/** Alt held over another item or board, in edit mode: the distances to it from the selection. */
	const penDistances = createMemo(() => {
		const over = hoverBox();
		// A board picked up with the selection is part of it, not something to measure to.
		const path = d.editor.hoverPage() ?? d.editor.hoverPicture();
		const picked = !!over?.board && !!path && d.editor.pagePicks().includes(path);
		return distancesOf({ editing: d.props.mode === "edit", alt: d.editor.altHeld(), busy: !!d.editor.gesture() || !!d.editor.pageDrag() || d.panning(), selection: penFrame(), over: picked ? undefined : over });
	});

	const canvasPenPath = () => (d.props.canvasName ? `canvases/${d.props.canvasName}/canvas.pen` : undefined);

	/** A dragged arrow handle's dashed route, where it sits. */
	const routeShown = d.editor.route;

	/**
	 * Everything the editor draws over the canvas (`editor/core/overlay.ts`), for `OverlayLayer`. Each
	 * part keeps its own memo above, read here, so a part that has not changed hands the layer the
	 * same value and nothing it draws is touched.
	 */
	const overlay = createMemo<Overlay>(() => ({
		outlines: d.penOutlines(),
		handles: d.penHandles(),
		anchors: d.penAnchors(),
		pageHandles: d.pageHandles(),
		radius: radiusHandle(),
		radiusDrag: d.editor.radius(),
		arrow: arrowEnds(),
		hover: hoverBox(),
		kin: kinBoxes(),
		selectionFrame: penFrame(),
		distances: penDistances(),
		grip: gripBox(),
		gripHidden: gripHidden(d.editor.drag(), !!d.editor.resize()),
		drop: dropBox(),
		insert: d.editor.dropSlot()?.line,
		slots: d.editor.dropNear()?.slots ?? [],
		slotFrames: d.editor.dropNear()?.frames ?? [],
		joins: d.editor.joins(),
		sides: d.editor.sides(),
		guides: d.editor.guides(),
		draft: d.editor.draft(),
		route: routeShown(),
		endDraft: d.editor.endDraft(),
	}));

	return {
		calloutItems,
		canvasPenPath,
		lassoItems,
		radiusHandle,
		arrowEnds,
		overlay,
	};
}
