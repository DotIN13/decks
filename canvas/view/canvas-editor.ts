// The editor's host on this page, made inside the canvas element (`CanvasView.tsx`): its effects, the pointer's side, and
// the editor made from them.
import { createSignal } from "solid-js";
import { type StageEditorHost as EditorHost, createStageEditor, tsSeam } from "../editor/index.ts";
import { toScreen, toWorld } from "../camera/camera.ts";
import { penTool, setPenTool } from "../editor/pen-tools.ts";
import { scheme } from "../theme.ts";
import type { Props, editsAndInput, engineOf, penTools } from "./CanvasView.tsx";
import type { cameraOf, elementAndEngine } from "./canvas-camera.ts";

/** The editor's effects on this page, and the count of the engine's layouts that what reads places reads. */
export function editorEffectsOf(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; ctl: ReturnType<typeof cameraOf>["ctl"];
	element: ReturnType<typeof elementAndEngine>["element"]; penLayer: ReturnType<typeof elementAndEngine>["penLayer"];
	props: Props; view: ReturnType<typeof elementAndEngine>["view"];
}) {
	const { ahead, ctl, element, penLayer, props, view } = ctx;

	/** Counted up each time the engine lays the drawing out (`penLayer.drawn`): what reads where items are reads it. */
	const [penDrawn, setPenDrawn] = createSignal(0);
	/** What the editor's effects do on this page. */
	const editorEffects: EditorHost["effects"] = {
		element: () => element.now,
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
		toggleMedia: (id, media) => ahead.items.toggleMedia(id, media),
	};
	return { penDrawn, setPenDrawn, editorEffects };
}

/** The pointer's side of the editor. */
export function editorPointerOf(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; element: ReturnType<typeof elementAndEngine>["element"];
	grabbing: ReturnType<typeof editsAndInput>["grabbing"]; input: ReturnType<typeof editsAndInput>["input"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; props: Props;
	setHoldMenu: ReturnType<typeof editsAndInput>["setHoldMenu"];
	worldAt: ReturnType<typeof editsAndInput>["worldAt"];
}) {
	const { ahead, element, grabbing, input, penLayer, props, setHoldMenu, worldAt } = ctx;
	/** The pointer's side of the editor: what a press, a drag and a hold reach on this page. */
	const editorPointer: EditorHost["pointer"] = {
		element: () => element.now,
		worldAt: (event) => worldAt(event),
		editable: () => !!props.onPenEdit,
		drawing: () => !!props.drawing,
		mode: () => props.mode,
		tool: penTool,
		spaceHeld: () => grabbing(),
		pagesNear: (at) =>
			ahead.items.pageIndex()
				.search({ x: at.x, y: at.y, w: 0, h: 0 })
				.sort((a, b) => a - b)
				.map((index) => props.boards[index]!),
		rendered: () => ahead.items.renderedPaths(),
		linkAt: (at) => penLayer.linkAt(at),
		onSelect: (path) => props.onSelect(path),
		fingers: () => input.touches.count(),
		caught: () => input.caught(),
		holdMenu: (menu) => setHoldMenu(menu),
		pencil: (event) => {
			if (!props.onPencil) return false;
			props.onPencil();
			// The ink sheet is there now (the pen is on): the press is given to it, as a Pencil's own.
			const sheet = element.now.querySelector("svg.stage-ink");
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
		claim: (pointer) => input.claimed.add(pointer),
		beginTouch: (event) => input.beginTouch(event),
		keepTouch: (event) => input.keptTouches.add(event.pointerId),
		pan: (event, how) => input.panFrom(event, how),
		toggleMedia: (id, media) => ahead.items.toggleMedia(id, media),
		open: { liveFile: (id) => ahead.items.openLiveFile(id) },
		handles: { item: () => ahead.selection.penHandles(), board: () => ahead.selection.pageHandles(), radius: () => ahead.selection.radiusHandle(), arrow: () => ahead.selection.arrowEnds() },
	};
	return { editorPointer };
}

/**
 * Editing the drawing by hand, in edit mode (`editor/pen-tools.ts` holds the tool and reads the
 * editor's selection, `chrome/PenBar.tsx` shows them). Every change is sent as the same pen operation an
 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
 * or a resize is drawn as a preview.
 *
 * The editor (`editor/dom/controller.ts`) holds the selection, what the pointer is over, the
 * gesture in hand and what is drawn for it, stepped by `editor/core/gesture.ts`. The handlers
 * here follow the pointer and tell it each step.
 */
export function editorOf(ctx: {
	ahead: ReturnType<typeof elementAndEngine>["ahead"]; armPenTool: ReturnType<typeof penTools>["armPenTool"];
	ctl: ReturnType<typeof cameraOf>["ctl"]; editorEffects: ReturnType<typeof editorEffectsOf>["editorEffects"];
	editorPointer: ReturnType<typeof editorPointerOf>["editorPointer"];
	freshId: ReturnType<typeof editsAndInput>["freshId"]; freshIds: ReturnType<typeof editsAndInput>["freshIds"];
	penDrawn: ReturnType<typeof editorEffectsOf>["penDrawn"]; penEdit: ReturnType<typeof editsAndInput>["penEdit"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"]; props: Props;
	scene: ReturnType<typeof engineOf>["scene"]; view: ReturnType<typeof elementAndEngine>["view"];
	worldAt: ReturnType<typeof editsAndInput>["worldAt"]; worldEl: ReturnType<typeof elementAndEngine>["worldEl"];
}) {
	const { ahead, armPenTool, ctl, editorEffects, editorPointer, freshId, freshIds, penDrawn, penEdit, penLayer, props, scene, view, worldAt, worldEl } = ctx;
	/** What the keys reach on this page. */
	const editorKeys: EditorHost["keys"] = {
		editable: () => !!props.onPenEdit,
		drawing: () => !!props.drawing,
		tool: penTool,
		pageSelected: () => !!props.selected,
		selectedPage: () => props.selected,
		canStep: () => !!props.onPenStep,
		step: (direction) => props.onPenStep?.(direction),
		deleteSelected: (selected, ops) => ahead.selection.penDeleteSelected(selected, ops),
		...(props.onDeleteCard ? { deletePages: (paths: readonly string[]) => paths.forEach((path) => props.onDeleteCard?.(path)) } : {}),
		setTool: (tool) => setPenTool(tool),
		arm: (tool) => armPenTool(tool),
		onMove: (path, x, y) => props.onMove(path, x, y),
	};
	/** Typing into an item, as this page does it. */
	const editorText: EditorHost["text"] = {
		pen: () => props.pen,
		scheme: () => scheme(),
		world: () => worldEl.now,
		redrawn: () => penDrawn(),
		editable: () => !!props.onPenEdit,
		freshId: () => freshId(),
	};
	/** Adding an item, as this page does it. */
	const editorInsert: EditorHost["insert"] = {
		worldAt: (event) => worldAt(event),
		freshId: () => freshId(),
		idsBut: (id) => freshIds(id),
	};
	/*
	 * Cards picked up with the drawing (`editor.pagePicks`), by a marquee or Shift and a press on a title
	 * bar, move with the selected items as one selection. The app's own selected card, the one whose
	 * page takes the keys, is another thing: a single press on a card is only that.
	 */
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
		effects: editorEffects,
		// The pointer's half (`input/pointer.ts`): the stage keeps the camera, its finger pool and its pan.
		pointer: editorPointer,
		// The drawing's keys (`input/keys.ts`).
		keys: editorKeys,
		// The words typed over an item (`editor/dom/TextEditing.tsx`).
		text: editorText,
		// What a tool and a double-click on bare canvas add (`chrome/InsertMenu.tsx`).
		insert: editorInsert,
	});
	ahead.editor = editor;
	return { editor };
}
