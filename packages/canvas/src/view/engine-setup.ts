import type { Accessor } from "solid-js";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { type Viewport } from "../camera/camera.ts";
import { penLive, setPenLive } from "../edit/pen-tools.ts";
import { scheme } from "../base/theme.ts";
import { CanvasEngine } from "../render/engine.ts";
import { tsScene } from "../edit/dom/index.ts";
import { type CanvasViewProps } from "./CanvasView.tsx";

/** What `createEngine` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface EngineNeeds {
	readonly props: CanvasViewProps;
	readonly view: Accessor<Viewport>;
}

export function createEngine(d: EngineNeeds) {
	/*
	 * The stage's engine (`stage/engine.ts`): the drawing and the boards' pictures, drawn with WebGPU
	 * on two canvases, one under the item slots and one over them, in the same call that moves the
	 * slots (`writeTransform`). The document, the window's size and the colour scheme reach it here.
	 */
	const penLayer = new CanvasEngine();

	d.props.onEngine?.(penLayer);

	/* An engine that cannot start says so over the stage (`stage/backends/notice.ts`): no WebGPU and no WebGL 2, most often. */
	const [engineNotice, setEngineNotice] = createSignal<string>();

	penLayer.failed = (notice) => setEngineNotice(notice);

	onCleanup(() => penLayer.dispose());

	/** What the editor asks of the scene (`editor/core/scene.ts`), answered from the engine. */
	const scenePages = createMemo(() =>
		d.props.boards.map((board) => ({ path: board.path, x: board.x, y: board.y, w: board.w, h: board.h })),
	);

	const scene = tsScene(penLayer, () => d.props.pen?.doc, scenePages);

	createEffect(() => penLayer.setView(d.view()));

	createEffect(() => penLayer.setScheme(scheme()));

	/*
	 * The over canvas is inside the world only to sit after the item slots and before the
	 * selection's outlines and handles. The engine places it, in stage units, at the rectangle it last
	 * drew (the window and a margin round it), so a pan moves it with the world until it is drawn again.
	 */
	createEffect(() => {
		penLayer.setDoc(d.props.pen?.doc, d.props.pen?.base ?? "", d.props.pen?.edits, d.props.pen?.own === true);
		// The drawing has the change in it now, so the panel is no longer showing one (`penLive`).
		if (untrack(penLive)) setPenLive(undefined);
	});

	/*
	 * Editing the drawing by hand, in edit mode (`state/pen-tools.ts` holds the tool and reads the
	 * editor's selection, `pen/PenBar.tsx` shows them). Every change is sent as the same pen operation an
	 * agent would send, and the drawing redraws from the server's answer; until it arrives, a drag
	 * or a resize is drawn as a preview.
	 *
	 * The editor (`editor/dom/controller.ts`) holds the selection, what the pointer is over, the
	 * gesture in hand and what is drawn for it, stepped by `editor/core/gesture.ts`. The handlers
	 * here follow the pointer and tell it each step.
	 */
	/** Counted up each time the engine lays the drawing out (`penLayer.drawn`): what reads where items are reads it. */
	const [penDrawn, setPenDrawn] = createSignal(0);

	return {
		penLayer,
		scene,
		penDrawn,
		setPenDrawn,
		engineNotice,
	};
}
