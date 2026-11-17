import { type NextId } from "../edit/core/ops.ts";
import { type SceneQuery } from "../edit/core/scene.ts";
import type { Accessor, Setter } from "solid-js";
import { toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import { createCameraController } from "../camera/controller.ts";
import { penTool, setPenTool, type PenTool } from "../edit/pen-tools.ts";
import { scheme } from "../base/theme.ts";
import { CanvasEngine } from "../render/engine.ts";
import { createCanvasEditor, tsSeam } from "../edit/dom/index.ts";
import { createViewInput } from "./input.ts";
import { createItemsLayer } from "./items-layer.tsx";
import { createSelection } from "./selection.tsx";
import { type CanvasViewProps } from "./CanvasView.tsx";

/** What `wireEditor` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface WireEditorNeeds {
	readonly scene: SceneQuery;
	readonly penLayer: CanvasEngine;
	readonly props: CanvasViewProps;
	readonly ctl: ReturnType<typeof createCameraController>;
	readonly view: Accessor<Viewport>;
	readonly freshIds: (...also: string[]) => NextId;
	readonly penEdit: (ops: unknown[]) => void;
	readonly element: HTMLDivElement;
	readonly items: ReturnType<typeof createItemsLayer>;
	readonly worldAt: (event: { clientX: number; clientY: number; }) => { x: number; y: number; };
	readonly grabbing: () => boolean;
	readonly input: ReturnType<typeof createViewInput>;
	readonly setHoldMenu: Setter<{ ids: string[]; at: { x: number; y: number; }; stage: { x: number; y: number; }; } | undefined>;
	readonly selection: ReturnType<typeof createSelection>;
	readonly armPenTool: (tool: PenTool) => void;
	readonly worldEl: HTMLDivElement;
	readonly penDrawn: Accessor<number>;
	readonly freshId: () => string;
}

export function wireEditor(d: WireEditorNeeds) {
	const editor = createCanvasEditor({
		scene: d.scene,
		engine: tsSeam(d.penLayer),
		mode: () => d.props.mode,
		tool: penTool,
		zoom: () => d.ctl.now().zoom,
		view: () => {
			const v = d.view();
			const a = toWorld(d.ctl.now(), v, { x: 0, y: 0 });
			const b = toWorld(d.ctl.now(), v, { x: v.width, y: v.height });
			return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
		},
		nextIds: () => d.freshIds(),
		boards: () => d.props.boards,
		onPenEdit: (ops) => d.penEdit(ops),
		effects: {
			element: () => d.element,
			toScreen: (point) => toScreen(d.ctl.now(), d.view(), point),
			box: (id) => d.penLayer.bounds.get(id) ?? d.penLayer.placed.get(id)?.box,
			cutFromCarried: (rect) => d.penLayer.cardLayer.cutFromCarried(rect),
			showCarriedLayer: (on) => d.penLayer.cardLayer.showCarriedLayer(on),
			pen: () => d.props.pen,
			get onRefer() { return d.props.onRefer; },
			get onOpenPage() { return d.props.onOpenPage; },
			onSelect: (path) => d.props.onSelect(path),
			onMove: (path, x, y) => d.props.onMove(path, x, y),
			onResize: (path, size) => d.props.onResize?.(path, size),
			toggleMedia: (id, media) => d.items.toggleMedia(id, media),
		},
		// The pointer's half (`editor/dom/pointer.ts`): the stage keeps the camera, its finger pool and its pan.
		pointer: {
			element: () => d.element,
			worldAt: (event) => d.worldAt(event),
			editable: () => !!d.props.onPenEdit,
			drawing: () => !!d.props.drawing,
			mode: () => d.props.mode,
			tool: penTool,
			spaceHeld: () => d.grabbing(),
			pagesNear: (at) =>
				d.items.pageIndex()
					.search({ x: at.x, y: at.y, w: 0, h: 0 })
					.sort((a, b) => a - b)
					.map((index) => d.props.boards[index]!),
			rendered: () => d.items.renderedPaths(),
			linkAt: (at) => d.penLayer.questions.linkAt(at),
			onSelect: (path) => d.props.onSelect(path),
			fingers: () => d.input.touches.count(),
			caught: () => d.input.caught(),
			holdMenu: (menu) => d.setHoldMenu(menu),
			pencil: (event) => {
				if (!d.props.onPencil) return false;
				d.props.onPencil();
				// The ink sheet is there now (the pen is on): the press is given to it, as a Pencil's own.
				const sheet = d.element.querySelector("svg.stage-ink");
				if (!sheet) return false;
				sheet.dispatchEvent(
					new PointerEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						composed: true,
						pointerId: event.pointerId,
						pointerType: "pen",
						isPrimary: event.isPrimary,
						clientX: event.clientX,
						clientY: event.clientY,
						screenX: event.screenX,
						screenY: event.screenY,
						pressure: event.pressure,
						tiltX: event.tiltX,
						tiltY: event.tiltY,
						width: event.width,
						height: event.height,
						button: 0,
						buttons: 1,
					}),
				);
				return true;
			},
			claim: (pointer) => d.input.claimed.add(pointer),
			beginTouch: (event) => d.input.beginTouch(event),
			keepTouch: (event) => d.input.keptTouches.add(event.pointerId),
			pan: (event, how) => d.input.panFrom(event, how),
			toggleMedia: (id, media) => d.items.toggleMedia(id, media),
			open: { liveFile: (id) => d.items.openLiveFile(id) },
			handles: { item: () => d.selection.penHandles(), board: () => d.selection.pageHandles(), radius: () => d.selection.radiusHandle(), arrow: () => d.selection.arrowEnds() },
		},
		// The drawing's keys (`editor/dom/keys.ts`).
		keys: {
			editable: () => !!d.props.onPenEdit,
			drawing: () => !!d.props.drawing,
			tool: penTool,
			pageSelected: () => !!d.props.selected,
			selectedPage: () => d.props.selected,
			canStep: () => !!d.props.onPenStep,
			step: (direction) => d.props.onPenStep?.(direction),
			deleteSelected: (selected, ops) => d.selection.penDeleteSelected(selected, ops),
			...(d.props.onDeleteCard ? { deletePages: (paths: readonly string[]) => paths.forEach((path) => d.props.onDeleteCard?.(path)) } : {}),
			setTool: (tool) => setPenTool(tool),
			arm: (tool) => d.armPenTool(tool),
			onMove: (path, x, y) => d.props.onMove(path, x, y),
		},
		// The words typed over an item (`editor/dom/TextEditing.tsx`).
		text: {
			pen: () => d.props.pen,
			scheme: () => scheme(),
			world: () => d.worldEl,
			redrawn: () => d.penDrawn(),
			editable: () => !!d.props.onPenEdit,
			freshId: () => d.freshId(),
		},
		// What a tool and a double-click on bare canvas add (`editor/dom/InsertMenu.tsx`).
		insert: {
			worldAt: (event) => d.worldAt(event),
			freshId: () => d.freshId(),
			idsBut: (id) => d.freshIds(id),
		},
	});

	return {
		editor,
	};
}
