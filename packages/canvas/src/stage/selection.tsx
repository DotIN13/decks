import type { Camera } from "@decks/protocol";
import { Show, createEffect, createMemo, type Accessor } from "solid-js";
import { boxOf, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { PageCallout } from "../ui/Callout.tsx";
import { isInk } from "../model/ink.ts";
import { inkSelection, setInkSelection } from "../edit/ink.ts";
import { setPenBoxes } from "../edit/pen-tools.ts";
import { firstLine } from "../render/look.ts";
import { parseMarkdown } from "../model/markdown.ts";
import { walk, type PenNode } from "@decks/pen";
import type { StageEngine } from "../render/engine.ts";
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
	type StageEditor,
	type tsScene,
} from "../edit/index.ts";
import type { StageProps } from "./Stage.tsx";

/** What the selection's drawing needs of the stage around it. */
export type SelectionDeps = {
	props: StageProps;
	ctl: CameraController;
	view: () => Viewport;
	editor: StageEditor;
	scene: ReturnType<typeof tsScene>;
	penLayer: StageEngine;
	/** Counted up each time the engine lays the drawing out. */
	penDrawn: Accessor<number>;
	/** Fit boxes into the canvas column (`Stage.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** Send the person's edits to the drawing (`Stage.tsx`, `penEdit`). */
	penEdit: (ops: unknown[]) => void;
	freshIds: (...also: string[]) => () => string;
	/** An item as the file has it (`Stage.tsx`, `penNode`). */
	penNode: (id: string) => PenNode | undefined;
	/** A press is held on the canvas (`input.ts`): the drawn items' pill steps aside. */
	pressHeld: Accessor<boolean>;
};

/**
 * What is drawn over the selection and under the pointer: outlines, handles, anchors, the hover,
 * grip, kin and distance boxes, the overlay they make together, and the pills over a board, drawn
 * items and the lasso, with what the pills do. Made inside `Stage`, after the editor, which it reads.
 */
export function createSelection(deps: SelectionDeps) {
	const { props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, freshIds, penNode, pressHeld } = deps;
	const { moving, scaling, gliding, panning, push: pushCamera } = ctl;

	/** More than one thing picked together, boards among them or not: the pill goes over the whole group (`calloutItems`). */
	const groupPicked = () => editor.pagePicks().length + editor.items().length > 1;
	// After the editor, which it reads: a stage made with a board already selected reads it at once.
	const calloutPage = createMemo(() => (props.selected && !groupPicked() ? props.boards.find((board) => board.path === props.selected) : undefined));

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

	/**
	 * The corner radius and the angle being dragged, for the handles and the outline the canvas draws
	 * round the item. What the *sheet* draws is told separately, as a preview the worker applies to
	 * its own copy (`penLayer.preview`): a turn used to send the whole drawing to the worker on every
	 * frame, which is a relayout of the whole stage sixty times a second, and that was the flicker.
	 *
	 * Neither is cleared when the gesture ends. The worker lets a preview go when the server's answer
	 * arrives — "whatever a drag was previewing is now the drawing itself" — and clearing it first is
	 * what shows the item at its old angle for a frame.
	 */
	/*
	 * The radius (`editor.radius`) is let go of when the drawing comes back with the change in it, not
	 * when the hand lifts (`editor/core/gesture.ts`, `drawn`). The sheet's own preview works that way
	 * already; the outline and the handles are drawn from it, and dropping it first shows the item
	 * upright for the frame or two the save takes. A time limit is for an edit that is refused, which
	 * would otherwise leave the handles turned for an item that is not.
	 */

	/**
	 * What the pill should not sit on (`PageCallout`): every board and drawn item but those touching the
	 * box it is for, which are the selection itself, what is in it and what holds it.
	 */
	const pillObstacles = (box: { x: number; y: number; w: number; h: number }) => {
		const touches = (o: { x: number; y: number; w: number; h: number }) => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y;
		const out: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const board of props.boards) {
			const b = boxOf(board);
			if (!touches(b)) out.push(b);
		}
		for (const [id, placed] of penLayer.placed) {
			const b = penLayer.bounds.get(id) ?? placed.box;
			if (b.w > 0 && b.h > 0 && !touches(b)) out.push(b);
		}
		return out;
	};

	/** The words an item shows, its own or its children's, on one line: what a comment on it quotes. */
	const quoteOf = (node: PenNode | undefined): string => {
		if (!node) return "";
		const said: string[] = [];
		for (const one of walk([node])) if (typeof one.content === "string" && one.content.trim()) said.push(one.content.trim());
		return said.join(" ").replace(/\s+/g, " ").slice(0, 120);
	};
	/** Take the selected drawn items off the canvas: the Delete key, and the pill's Delete. */
	const penDeleteSelected = (selected = editor.items(), ops = deleteOps(selected, scene)) => {
		if (!selected.length) return;
		// Gone from the sheet at once, and its outline with it in the same frame, not one frame before it.
		penLayer.hide(new Set(selected));
		const mark = penLayer.mark();
		penEdit(ops);
		const clear = () => editor.select((now) => (now === selected ? [] : now));
		editor.afterFrame(mark, clear);
		// A sheet that shows no frame (nothing painting) does not keep the outline.
		setTimeout(clear, 250);
	};

	const penDuplicate = () => {
		const { ops, made } = duplicateOps(scene, editor.items(), freshIds());
		penEdit(ops);
		if (made.length) selectMade(made);
	};

	/** Where the frame a drag would drop into is, for the outline that says so. */
	const dropBox = createMemo(() => dropBoxOf(editor.dropInto(), scene));

	/**
	 * The one selected item's corner radius, when it has corners to round: a rounded shape from the
	 * library, or pen's own rectangle or frame. The handle that drags it sits inside the top-left
	 * corner, as it does in a drawing program, and every corner follows it.
	 */
	const radiusHandle = createMemo(() => radiusHandleOf(penHandles(), { editable: !!props.onPenEdit, resizing: !!editor.resize(), drag: editor.drag() }, scene));
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
		if (!props.drawing || !props.onInk || !props.inkAgent) return undefined;
		const held = inkSelection();
		const boxes = (held?.ids ?? []).map((id) => penLayer.bounds.get(id) ?? penLayer.placed.get(id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
		if (!held || boxes.length === 0) return undefined;
		const x = Math.min(...boxes.map((b) => b.x));
		const y = Math.min(...boxes.map((b) => b.y));
		return { ids: [...held.ids], box: { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y } };
	});
	const calloutItems = createMemo(() => {
		if ((props.selected && !groupPicked()) || props.drawing || !props.onPenEdit || editor.text()) return undefined;
		const all = penOutlines().filter((one) => one.id);
		const outlines = all.filter((one) => !one.id.startsWith("board:"));
		const boards = all.length - outlines.length;
		if (outlines.length !== editor.items().length || boards !== editor.pagePicks().length || !all.length) return undefined;
		const x = Math.min(...all.map((one) => one.x));
		const y = Math.min(...all.map((one) => one.y));
		const box = { x, y, w: Math.max(...all.map((one) => one.x + one.w)) - x, h: Math.max(...all.map((one) => one.y + one.h)) - y };
		const ids = outlines.map((one) => one.id);
		const words = ids.map((id) => quoteOf(penLayer.placed.get(id)?.node)).filter(Boolean).join(" / ").slice(0, 160);
		const first = penLayer.placed.get(ids[0]!)?.node;
		const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
		const name = boards
			? [count(boards, "card"), ids.length ? count(ids.length, "item") : ""].filter(Boolean).join(", ")
			: ids.length > 1
				? `${ids.length} items`
				: words || (typeof first?.name === "string" ? first.name : first?.type) || "item";
		return { box, ids, words, name };
	});
	/** One drawn item selected, not a line or a group, and nothing being drawn: it shows where an arrow can leave it. */

	/** The two ends of a selected arrow as drawn, for the handles that pick them up. */
	const arrowEnds = createMemo(() => {
		penDrawn();
		return arrowEndsOf({ selection: editor.items(), pagePicks: editor.pagePicks(), drag: shownDrag() }, scene);
	});

	/** Where the hovered block's grip goes: in the card's left margin, level with the block's first line. */
	const gripBox = createMemo(() => {
		penDrawn();
		return gripBoxOf({ block: editor.hoverBlock(), busy: !!editor.pageDrag() || panning(), editing: props.mode === "edit" }, scene, (id, node) => {
			// Centred on the block's first line, as the layout sets it: a heading's is taller than a paragraph's.
			const look = editor.textEditing.lookOf(node, penLayer.placed.get(id));
			return firstLine(parseMarkdown(String(node.content ?? ""))[0], look.size, look.line);
		});
	});

	/** The hovered item's box as it is drawn now, or the board under the pointer. */
	const hoverBox = createMemo(() => {
		penDrawn();
		return hoverBoxOf(
			{ editing: props.mode === "edit", item: editor.hoverItem(), typing: editor.typing(), board: editor.hoverPage() ?? editor.hoverPicture(), selected: props.selected, busy: !!editor.pageDrag() || panning(), boards: scene.boards(), glide: editor.glide() },
			scene,
		);
	});

	/** What the selection and the hovered item sit in and hold: light outlines round their parents and children. */
	const kinBoxes = createMemo(() => {
		penDrawn();
		return kinOutlines(
			{ selection: editor.items(), drag: shownDrag(), glide: editor.glide(), resizing: !!editor.resize(), typing: editor.typing(), editing: props.mode === "edit", hover: editor.hoverItem(), busy: !!editor.pageDrag() || panning() || !!editor.gesture() },
			scene,
		);
	});
	/** One box round everything selected, with its size under it. */
	const penFrame = createMemo(() => selectionFrame(penOutlines()));
	/** Alt held over another item or board, in edit mode: the distances to it from the selection. */
	const penDistances = createMemo(() => {
		const over = hoverBox();
		// A board picked up with the selection is part of it, not something to measure to.
		const path = editor.hoverPage() ?? editor.hoverPicture();
		const picked = !!over?.board && !!path && editor.pagePicks().includes(path);
		return distancesOf({ editing: props.mode === "edit", alt: editor.altHeld(), busy: !!editor.gesture() || !!editor.pageDrag() || panning(), selection: penFrame(), over: picked ? undefined : over });
	});

	const stagePenPath = () => (props.stageName ? `canvases/${props.stageName}/canvas.pen` : undefined);
	/** A dragged arrow handle's dashed route, where it sits. */
	const routeShown = editor.route;
	/**
	 * Everything the editor draws over the canvas (`editor/core/overlay.ts`), for `OverlayLayer`. Each
	 * part keeps its own memo above, read here, so a part that has not changed hands the layer the
	 * same value and nothing it draws is touched.
	 */
	const overlay = createMemo<Overlay>(() => ({
		outlines: penOutlines(),
		handles: penHandles(),
		anchors: penAnchors(),
		pageHandles: pageHandles(),
		radius: radiusHandle(),
		radiusDrag: editor.radius(),
		arrow: arrowEnds(),
		hover: hoverBox(),
		kin: kinBoxes(),
		selectionFrame: penFrame(),
		distances: penDistances(),
		grip: gripBox(),
		gripHidden: gripHidden(editor.drag(), !!editor.resize()),
		drop: dropBox(),
		insert: editor.dropSlot()?.line,
		slots: editor.dropNear()?.slots ?? [],
		slotFrames: editor.dropNear()?.frames ?? [],
		joins: editor.joins(),
		sides: editor.sides(),
		guides: editor.guides(),
		draft: editor.draft(),
		route: routeShown(),
		endDraft: editor.endDraft(),
	}));

	/** The pills: over the selected board, over drawn items or a group, and over the lasso's strokes. */
	const pills = () => (
		<>

			{/*
				Boards have no title bars: the selected board's name and actions are a pill over it
				(`PageCallout`), on every device. Kept mounted through a movement and only hidden, so a
				drag that began on its grip keeps the element it captured the pointer on.
			*/}
			<Show when={!props.drawing ? calloutPage() : undefined} keyed>
				{(board) => (
					<PageCallout
						board={board}
						box={boxOf(board)}
						obstacles={() => pillObstacles(boxOf(board))}
						label={`${board.title}: card actions`}
						hidden={moving() || panning() || scaling() || gliding() || editor.carrying()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([boxOf(board)]))}
						{...(props.onHide ? { onHide: () => props.onHide?.(board.path) } : {})}
						{...(props.onDeleteCard ? { onDelete: () => props.onDeleteCard?.(board.path) } : {})}
						{...(props.onComment
							? {
									onComment: () =>
										props.onComment?.({
											path: board.path,
											quote: "",
											title: board.title,
											// Under the pill, which follows the board as the camera moves.
											anchor: () => document.querySelector(".stage-fixed > .board-callout")?.getBoundingClientRect(),
											open: true,
										}),
								}
							: {})}
					/>
				)}
			</Show>
			<Show when={calloutItems()}>
				{(items) => (
					<PageCallout
						box={items().box}
						obstacles={() => pillObstacles(items().box)}
						label={`${items().name}: actions`}
						gap={penAnchors() ? ANCHOR_OUT + ANCHOR_PX / 2 + 6 : undefined}
						hidden={pressHeld() || moving() || panning() || scaling() || gliding() || editor.drag().dx !== 0 || editor.drag().dy !== 0 || !!editor.resize()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([items().box]))}
						// What acts on drawn items: a group of boards alone has only Open.
						{...(items().ids.length
							? {
									...(props.onComment
										? {
												onComment: () =>
													props.onComment?.({
														// A drawn item is found by its canvas's file and its id (`BoardComment.items`).
														path: stagePenPath() ?? "the canvas",
														items: items().ids,
														quote: items().words,
														title: items().name,
														anchor: () => document.querySelector(".stage-fixed > .board-callout")?.getBoundingClientRect(),
														open: true,
													}),
											}
										: {}),
									...(props.onInk && props.inkAgent && items().ids.every((id) => { const node = penNode(id); return !!node && isInk(node); })
										? {
												ink: {
													agent: props.inkAgent,
													onDrawing: () => props.onInk?.({ action: "drawing", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
													onBoard: () => props.onInk?.({ action: "board", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
													onSend: () => props.onInk?.({ action: "send", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
												},
											}
										: {}),
									onDuplicate: () => penDuplicate(),
									onDelete: () => penDeleteSelected(),
								}
							: {})}
					/>
				)}
			</Show>
			<Show when={lassoItems()}>
				{(held) => (
					<PageCallout
						box={held().box}
						obstacles={() => pillObstacles(held().box)}
						label={`${held().ids.length} strokes: actions`}
						hidden={moving() || panning() || scaling() || gliding()}
						camera={ctl.settled()}
						view={view()}
						onOpen={() => pushCamera(frame([held().box]))}
						ink={{
							agent: props.inkAgent ?? "the agent",
							onDrawing: () => props.onInk?.({ action: "drawing", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
							onBoard: () => props.onInk?.({ action: "board", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
							onSend: () => props.onInk?.({ action: "send", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
						}}
						// The rest of a selection's pill, acting on the lasso's strokes instead of the editor's pick.
						{...(props.onComment
							? {
									onComment: () =>
										props.onComment?.({
											path: stagePenPath() ?? "the canvas",
											items: held().ids,
											quote: "",
											title: `${held().ids.length} ${held().ids.length === 1 ? "stroke" : "strokes"}`,
											anchor: () => document.querySelector(".stage-fixed > .board-callout")?.getBoundingClientRect(),
											open: true,
										}),
								}
							: {})}
						onDuplicate={() => {
							const { ops, made } = duplicateOps(scene, held().ids, freshIds());
							penEdit(ops);
							if (made.length) setInkSelection({ path: inkSelection()?.path ?? "stage", ids: made });
						}}
						onDelete={() => {
							penEdit(held().ids.map((id) => ({ op: "delete", id })));
							setInkSelection(undefined);
						}}
					/>
				)}
			</Show>
		</>
	);

	return { penHandles, pageHandles, radiusHandle, arrowEnds, penDeleteSelected, overlay, pills };
}
