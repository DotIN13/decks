// The canvas's markup, made inside the canvas element (`CanvasView.tsx`): the world with its slots, canvas and overlay, the\n// host's layer in it, and the chrome held to the window.
import { Show } from "solid-js";
import { OverlayLayer, TextEditor, InsertMenu } from "../editor/index.ts";
import { type HoldAction, HoldMenu } from "../chrome/HoldMenu.tsx";
import { setPropsOpen, setInsertPanel } from "../editor/pen-tools.ts";
import { CanvasInk } from "../ink/InkLayer.tsx";
import { toWorld } from "../camera/camera.ts";
import { stagePoint } from "../camera/coords.ts";
import type { Props, checkProbes, editsAndInput, engineOf, itemsOf, penActions, selectionOf } from "./CanvasView.tsx";
import type { cameraOf, viewAndOrigin } from "./canvas-camera.ts";
import type { editorOf } from "./canvas-editor.ts";

/** The host's layer in the world, made with what it reads. */
export function worldHostOf(ctx: {
	ctl: ReturnType<typeof cameraOf>["ctl"]; props: Props;
	worldOrigin: ReturnType<typeof viewAndOrigin>["worldOrigin"];
	worldPlaced: ReturnType<typeof viewAndOrigin>["worldPlaced"];
}) {
	const { ctl, props, worldOrigin, worldPlaced } = ctx;

	/**
	 * The host's layer (others' cursors, outlines), in canvas units: in the world, so a pan carries it,
	 * placed as the world's children are, from the origin at the world's own origin and at the zoom.
	 */
	const worldHost = () => (
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
	);
	return { worldHost };
}

/** The world's markup, made with what it reads. */
export function worldLayerOf(ctx: {
	ctl: ReturnType<typeof cameraOf>["ctl"]; editor: ReturnType<typeof editorOf>["editor"];
	items: ReturnType<typeof itemsOf>["items"]; penLayer: ReturnType<typeof viewAndOrigin>["penLayer"];
	selection: ReturnType<typeof selectionOf>["selection"]; worldEl: ReturnType<typeof viewAndOrigin>["worldEl"];
	worldHost: ReturnType<typeof worldHostOf>["worldHost"];
}) {
	const { ctl, editor, items, penLayer, selection, worldEl, worldHost } = ctx;

	/** The world: every card's slot, the engine's canvas and hit shapes, the editor's overlay and the host's layer. */
	const worldLayer = () => (
		<div class="world" data-sizing={items.sizingPaths().size > 0 ? "true" : undefined} ref={worldEl.now}>
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
			{/* The engine's canvas over the slots (`render/engine.ts`): the pictures of boards and sleeping cards, the drawing as tiles with a hole for each awake item, and what a gesture is moving. */}
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
			{worldHost()}
		</div>
	);
	return { worldLayer };
}

/** The chrome held to the window, made with what it reads. */
export function fixedLayerOf(ctx: {
	ctl: ReturnType<typeof cameraOf>["ctl"]; editor: ReturnType<typeof editorOf>["editor"];
	engineNotice: ReturnType<typeof engineOf>["engineNotice"];
	freshId: ReturnType<typeof editsAndInput>["freshId"]; holdMenu: ReturnType<typeof editsAndInput>["holdMenu"];
	inkStrokes: ReturnType<typeof checkProbes>["inkStrokes"]; penEdit: ReturnType<typeof editsAndInput>["penEdit"];
	penLayer: ReturnType<typeof viewAndOrigin>["penLayer"]; penMoveBy: ReturnType<typeof penActions>["penMoveBy"];
	penNode: ReturnType<typeof editsAndInput>["penNode"]; props: Props;
	selection: ReturnType<typeof selectionOf>["selection"];
	setHoldMenu: ReturnType<typeof editsAndInput>["setHoldMenu"]; view: ReturnType<typeof viewAndOrigin>["view"];
}) {
	const { ctl, editor, engineNotice, freshId, holdMenu, inkStrokes, penEdit, penLayer, penMoveBy, penNode, props, selection, setHoldMenu, view } = ctx;

	/** The canvas's own chrome, held to the window: the engine's notice, the menus, the pills and the ink. */
	const fixedLayer = () => (
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
								...(props.onComment ? [{ label: "Ask the agent", hint: "→", run: () => props.onComment?.({ path: props.stageName ? `canvases/${props.stageName}/canvas.pen` : "the canvas", items: menu.ids, quote: preview ?? "", title: preview ?? "An item", anchor: () => document.querySelector(".stage-fixed > .card-callout")?.getBoundingClientRect(), open: true }) }] : []),
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
	);
	return { fixedLayer };
}
