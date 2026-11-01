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
import { type Overlay, type StageEditor, type tsScene } from "../edit/index.ts";
import type { StageProps } from "./Stage.tsx";
import { RULES } from "../device/profile.ts";

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
	/** An item as the file has it (`Stage.tsx`, `penNode`). */
	penNode: (id: string) => PenNode | undefined;
	/** A press is held on the canvas (`input.ts`): the drawn items' pill steps aside. */
	pressHeld: Accessor<boolean>;
	/** The colours the engine paints the overlay in: the accent, the guides' red, the panel, red, green and blue from 0 to 1. */
	colours: Accessor<{ accent: [number, number, number]; guide: [number, number, number]; panel: [number, number, number] }>;
};

/** Nothing drawn over the canvas: before the engine has loaded. */
const EMPTY: Overlay = { outlines: [], kin: [], gripHidden: false, slots: [], slotFrames: [], joins: [], sides: [], guides: [] };
/** Two answers alike: a part of the overlay that has not changed keeps its value, so nothing that reads it is touched. */
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * What is drawn over the selection and under the pointer: outlines, handles, anchors, the hover,
 * grip, kin and distance boxes, the overlay they make together, and the pills over a board, drawn
 * items and the lasso, with what the pills do. Made inside `Stage`, after the editor, which it reads.
 */
export function createSelection(deps: SelectionDeps) {
	const { props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, penNode, pressHeld } = deps;
	const { moving, scaling, gliding, panning, push: pushCamera } = ctl;

	/** More than one thing picked together, boards among them or not: the pill goes over the whole group (`calloutItems`). */
	const groupPicked = () => editor.pagePicks().length + editor.items().length > 1;
	// After the editor, which it reads: a stage made with a board already selected reads it at once.
	const calloutPage = createMemo(() => (props.selected && !groupPicked() ? props.boards.find((board) => board.path === props.selected) : undefined));

	/** Select what was just asked for, which the drawing does not have until the server answers. */
	const selectMade = (made: string[]) => editor.selectMade(made);
	/**
	 * Everything the editor draws over the canvas, painted by the engine with the drawing in one frame
	 * (`crates/editor/src/overlay.rs`, from the engine's editor's state and what the page knows), and
	 * answered as places for `HitLayer`'s hit areas and the pills. Asked again whenever any of it
	 * may have changed: the editor's state, the zoom, the drawing, the hover, a glide, the words open.
	 */
	const painted = createMemo<Overlay>(
		() => {
			penDrawn();
			const state = editor.state();
			const hoverPage = editor.hoverPage() ?? editor.hoverPicture();
			// A board picked up with the selection is part of it, not something to measure to or outline as hovered.
			const picked = !!hoverPage && editor.pagePicks().includes(hoverPage);
			const glide = editor.glide();
			const frameOf = { zoom: ctl.zoom(), selected: props.selected, colours: deps.colours() };
			const extras = {
				typing: editor.typing(),
				panning: panning(),
				glide: glide ? [...glide].map(([id, by]) => [id, by.dx, by.dy]) : [],
				draft: editor.draft(),
				hoverItem: props.mode === "edit" ? editor.hoverItem() : undefined,
				hoverPage: props.mode === "edit" && !picked ? hoverPage : undefined,
				alt: editor.altHeld(),
				readOnly: !props.onPenEdit,
				notResizable: !props.onResize,
				hints: { joins: state.joins, sides: state.sides },
			};
			const places = penLayer.editorPaint(frameOf, extras) as (Overlay & { painted?: unknown }) | undefined;
			if (!places) return EMPTY;
			// For the rules checks: what the engine painted round the selection.
			(globalThis as { __decksOverlay?: string }).__decksOverlay = JSON.stringify(places.painted ?? {});
			return places;
		},
		EMPTY,
		{ equals: same },
	);
	const part = <T,>(pick: (o: Overlay) => T) => createMemo(() => pick(painted()), undefined, { equals: same });
	/** Where each selected item is now, moved by any drag and sized by any resize in progress. */
	const penOutlines = part((o) => o.outlines);
	/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
	const penHandles = part((o) => o.handles);
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
	const pageHandles = part((o) => o.pageHandles);

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
	const penDeleteSelected = (selected = editor.items(), ops: unknown[] = penLayer.editorCall<unknown[]>("delete-ops", { ids: selected }) ?? []) => {
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
		const { ops, made } = penLayer.editorCall<{ ops: unknown[]; made: string[] }>("duplicate-ops", { ids: editor.items() }) ?? { ops: [], made: [] };
		penEdit(ops);
		if (made.length) selectMade(made);
	};


	/**
	 * The one selected item's corner radius, when it has corners to round: a rounded shape from the
	 * library, or pen's own rectangle or frame. The handle that drags it sits inside the top-left
	 * corner, as it does in a drawing program, and every corner follows it.
	 */
	const radiusHandle = part((o) => o.radius);
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
		const outlines = all.filter((one) => !one.id.startsWith("page:"));
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
	const arrowEnds = part((o) => o.arrow);

	/** Where the hovered block's grip goes: in the card's left margin, level with the block's first line (the page measures the line). */
	const gripBox = createMemo(() => {
		penDrawn();
		const id = editor.hoverBlock();
		if (!id || !!editor.pageDrag() || panning()) return undefined;
		const box = scene.box(id);
		const node = scene.node(id);
		if (!box || !node) return undefined;
		const look = editor.textEditing.lookOf(node, penLayer.placed.get(id));
		const line = firstLine(parseMarkdown(String(node.content ?? ""))[0], look.size, look.line);
		return { id, x: box.x, y: box.y + line.top + line.height / 2 };
	});


	const stagePenPath = () => (props.stageName ? `canvases/${props.stageName}/canvas.pen` : undefined);
	/** Everything the editor draws over the canvas, for `HitLayer`: the engine's, and the grip the page places itself. */
	const overlay = createMemo<Overlay>(() => ({ ...painted(), grip: gripBox() }));

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
											anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
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
						gap={painted().anchors ? RULES.anchorOut + RULES.anchorSize / 2 + 6 : undefined}
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
														// A drawn item is found by its canvas's file and its id (`CardComment.items`).
														path: stagePenPath() ?? "the canvas",
														items: items().ids,
														quote: items().words,
														title: items().name,
														anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
														open: true,
													}),
											}
										: {}),
									...(props.onInk && props.inkAgent && items().ids.every((id) => { const node = penNode(id); return !!node && isInk(node); })
										? {
												ink: {
													agent: props.inkAgent,
													onDrawing: () => props.onInk?.({ action: "drawing", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
													onCard: () => props.onInk?.({ action: "card", ids: items().ids, canvas: props.stageName ?? "", box: items().box }),
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
							onCard: () => props.onInk?.({ action: "card", ids: held().ids, canvas: props.stageName ?? "", box: held().box }),
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
											anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
											open: true,
										}),
								}
							: {})}
						onDuplicate={() => {
							const { ops, made } = penLayer.editorCall<{ ops: unknown[]; made: string[] }>("duplicate-ops", { ids: held().ids }) ?? { ops: [], made: [] };
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

	return { penHandles, pageHandles, radiusHandle, arrowEnds, penDeleteSelected, penDuplicate, overlay, pills };
}
