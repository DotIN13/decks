import { type Outline } from "../edit/core/overlay.ts";
import { m } from "@decks/i18n";
import { type SceneQuery } from "../edit/core/scene.ts";
import type { Op } from "@decks/pen";
import type { Page } from "@decks/protocol";
import type { Camera } from "@decks/protocol";
import { Show, type Accessor } from "solid-js";
import { boxOf, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { PageCallout } from "../ui/Callout.tsx";
import { canvasHost } from "../base/host.ts";
import { reloadAppWindow } from "../items/item-surfaces.tsx";
import { isInk } from "../model/ink.ts";
import { inkSelection, setInkSelection } from "../ink/ink.ts";
import { type PenNode } from "@decks/pen";
import { ANCHOR_OUT, ANCHOR_PX, duplicateOps, type CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createPills` reads of `createSelection` (`selection.tsx`), each read when it is used. */
export interface PillsNeeds {
	readonly props: CanvasViewProps;
	readonly calloutPath: Accessor<string | undefined>;
	readonly calloutPage: Accessor<Page | undefined>;
	readonly pillObstacles: (box: { x: number; y: number; w: number; h: number; }) => { x: number; y: number; w: number; h: number; }[];
	readonly moving: Accessor<boolean>;
	readonly panning: Accessor<boolean>;
	readonly scaling: Accessor<boolean>;
	readonly gliding: Accessor<boolean>;
	readonly editor: CanvasEditor;
	readonly ctl: CameraController;
	readonly view: () => Viewport;
	readonly pushCamera: (cam: Camera) => void;
	readonly frame: (boxes: Array<{ x: number; y: number; w: number; h: number; }>) => Camera;
	readonly calloutItems: Accessor<{ box: { x: number; y: number; w: number; h: number; }; ids: string[]; cards: string[]; words: string; name: string; } | undefined>;
	readonly penAnchors: Accessor<Outline | undefined>;
	readonly pressHeld: Accessor<boolean>;
	readonly canvasPenPath: () => string | undefined;
	readonly penNode: (id: string) => PenNode | undefined;
	readonly penDuplicate: () => void;
	readonly penDeleteSelected: (selected?: readonly string[], ops?: Op[]) => void;
	readonly lassoItems: Accessor<{ ids: string[]; box: { x: number; y: number; w: number; h: number; }; } | undefined>;
	readonly scene: SceneQuery;
	readonly freshIds: (...also: string[]) => () => string;
	readonly penEdit: (ops: unknown[]) => void;
}

export function createPills(d: PillsNeeds) {
	/** The pills: over the selected board, over drawn items or a group, and over the lasso's strokes. */
	const pills = () => (
		<>

			{/*
				Boards have no title bars: the selected board's name and actions are a pill over it
				(`PageCallout`), on every device. Kept mounted through a movement and only hidden, so a
				drag that began on its grip keeps the element it captured the pointer on.
			*/}
			{/* Keyed by the card's path, not its object: the board list is made again at each change, and a pill made again would shut its ⋯ menu. */}
			<Show when={!d.props.drawing ? d.calloutPath() : undefined} keyed>
				{(path) => {
					let last = d.calloutPage()!;
					const board = () => (last = d.calloutPage() ?? last);
					return (
					<PageCallout
						board={board()}
						box={boxOf(board())}
						obstacles={() => d.pillObstacles(boxOf(board()))}
						label={`${board().title}: card actions`}
						hidden={d.moving() || d.panning() || d.scaling() || d.gliding() || d.editor.carrying()}
						camera={d.ctl.settled()}
						view={d.view()}
						onOpen={() => d.pushCamera(d.frame([boxOf(board())]))}
						onCopyPath={() => void navigator.clipboard?.writeText(path).catch(() => {})}
						{...(d.props.onExport && board().item !== "app" ? { onExport: (format: "png" | "pdf") => d.props.onExport?.([path], format) } : {})}
						{...(d.props.onHide ? { onHide: () => d.props.onHide?.(path) } : {})}
						// An app's window is closed here (✕), never deleted: deleting an app is the Apps tab's, where it says what goes.
						{...(d.props.onDeleteCard && board().item !== "app" ? { onDelete: () => d.props.onDeleteCard?.(path) } : {})}
						// An app running in its window loads again at a press, this window alone.
						{...(board().item === "app" && canvasHost().apps?.inCanvas ? { onReload: () => reloadAppWindow(path) } : {})}
						{...(d.props.onComment
							? {
									onComment: () =>
										d.props.onComment?.({
											path: path,
											quote: "",
											title: board().title,
											// Under the pill, which follows the board as the camera moves.
											anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
											open: true,
										}),
								}
							: {})}
					/>
					);
				}}
			</Show>
			<Show when={d.calloutItems()}>
				{(items) => (
					<PageCallout
						box={items().box}
						obstacles={() => d.pillObstacles(items().box)}
						label={`${items().name}: actions`}
						gap={d.penAnchors() ? ANCHOR_OUT + ANCHOR_PX / 2 + 6 : undefined}
						hidden={d.pressHeld() || d.moving() || d.panning() || d.scaling() || d.gliding() || d.editor.drag().dx !== 0 || d.editor.drag().dy !== 0 || !!d.editor.resize()}
						camera={d.ctl.settled()}
						view={d.view()}
						onOpen={() => d.pushCamera(d.frame([items().box]))}
						// ⋯ holds a picture of them all, cards included.
						{...(d.props.onExport ? { onExport: (format: "png" | "pdf") => d.props.onExport?.([...items().ids, ...items().cards], format) } : {})}
						// What acts on drawn items: a group of boards alone has only Open.
						{...(items().ids.length
							? {
									...(d.props.onComment
										? {
												onComment: () =>
													d.props.onComment?.({
														// A drawn item is found by its canvas's file and its id (`CardComment.items`).
														path: d.canvasPenPath() ?? "the canvas",
														items: items().ids,
														quote: items().words,
														title: items().name,
														anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
														open: true,
													}),
											}
										: {}),
									...(d.props.onInk && d.props.inkAgent && items().ids.every((id) => { const node = d.penNode(id); return !!node && isInk(node); })
										? {
												ink: {
													agent: d.props.inkAgent,
													onDrawing: () => d.props.onInk?.({ action: "drawing", ids: items().ids, canvas: d.props.canvasName ?? "", box: items().box }),
													onCard: () => d.props.onInk?.({ action: "card", ids: items().ids, canvas: d.props.canvasName ?? "", box: items().box }),
													onSend: () => d.props.onInk?.({ action: "send", ids: items().ids, canvas: d.props.canvasName ?? "", box: items().box }),
												},
											}
										: {}),
									onDuplicate: () => d.penDuplicate(),
									onDelete: () => d.penDeleteSelected(),
								}
							: {})}
					/>
				)}
			</Show>
			<Show when={d.lassoItems()}>
				{(held) => (
					<PageCallout
						box={held().box}
						obstacles={() => d.pillObstacles(held().box)}
						label={`${held().ids.length} strokes: actions`}
						hidden={d.moving() || d.panning() || d.scaling() || d.gliding()}
						camera={d.ctl.settled()}
						view={d.view()}
						onOpen={() => d.pushCamera(d.frame([held().box]))}
						ink={{
							agent: d.props.inkAgent ?? m.canvas_pill_the_agent(),
							onDrawing: () => d.props.onInk?.({ action: "drawing", ids: held().ids, canvas: d.props.canvasName ?? "", box: held().box }),
							onCard: () => d.props.onInk?.({ action: "card", ids: held().ids, canvas: d.props.canvasName ?? "", box: held().box }),
							onSend: () => d.props.onInk?.({ action: "send", ids: held().ids, canvas: d.props.canvasName ?? "", box: held().box }),
						}}
						// The rest of a selection's pill, acting on the lasso's strokes instead of the editor's pick.
						{...(d.props.onComment
							? {
									onComment: () =>
										d.props.onComment?.({
											path: d.canvasPenPath() ?? "the canvas",
											items: held().ids,
											quote: "",
											title: m.canvas_pill_strokes({ count: held().ids.length }),
											anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(),
											open: true,
										}),
								}
							: {})}
						onDuplicate={() => {
							const { ops, made } = duplicateOps(d.scene, held().ids, d.freshIds());
							d.penEdit(ops);
							if (made.length) setInkSelection({ path: inkSelection()?.path ?? "stage", ids: made });
						}}
						onDelete={() => {
							d.penEdit(held().ids.map((id) => ({ op: "delete", id })));
							setInkSelection(undefined);
						}}
					/>
				)}
			</Show>
		</>
	);

	return {
		pills,
	};
}
