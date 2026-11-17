import type { CameraController } from "../camera/controller.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { Setter } from "solid-js";
import { createEffect, untrack } from "solid-js";
import { setPenTool } from "../edit/pen-tools.ts";
import { overlayJson } from "../edit/core/overlay-json.ts";
import { COARSE, HANDLE_DOT_PX } from "../edit/core/touch-rules.ts";
import { ANCHOR_OUT, ANCHOR_PX } from "../edit/dom/OverlayLayer.tsx";
import { scheme } from "../base/theme.ts";
import { CanvasEngine } from "../render/engine.ts";
import { createSelection } from "./selection.tsx";
import { type CanvasViewProps } from "./CanvasView.tsx";

/** What `feedEngine` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface FeedEngineNeeds {
	readonly element: HTMLDivElement;
	readonly coloursFor: (dark: string, stage: HTMLElement) => { dark: string; accent: [number, number, number]; panel: [number, number, number]; guide: [number, number, number]; };
	readonly selection: ReturnType<typeof createSelection>;
	readonly ctl: CameraController;
	readonly setEngineOverlays: Setter<boolean>;
	readonly penLayer: CanvasEngine;
	readonly editor: CanvasEditor;
	readonly props: CanvasViewProps;
	readonly setPenDrawn: Setter<number>;
}

export function feedEngine(d: FeedEngineNeeds) {
	createEffect(() => {
		const dark = scheme();
		if (!d.element) return;
		const { accent, panel, guide } = untrack(() => d.coloursFor(dark, d.element!));
		const json = overlayJson(d.selection.overlay(), d.ctl.zoom(), { coarse: COARSE, accent, panel, guide, handlePx: HANDLE_DOT_PX, anchorPx: ANCHOR_PX, anchorOut: ANCHOR_OUT });
		d.setEngineOverlays(d.penLayer.setOverlay(json));
	});

	d.penLayer.drawn = () => {
		d.editor.textEditing.drawn();
		/*
		 * The answer to a drag has been drawn: the layout is where the drag left things, so the offset
		 * goes (`editor/core/gesture.ts`, `drawn`). Not when the answer *arrives* — the layout is only
		 * redone on the next frame, and for that frame the outline sat on the old layout with no
		 * offset, back where the drag began. A selection of items the drawing no longer has is let
		 * go then too, so the outline goes in the frame the item does.
		 */
		d.editor.drawn(d.penLayer.drawnDoc, d.props.pen?.doc);
		d.setPenDrawn((n) => n + 1);
	};

	/*
	 * The drawing is edited in both modes — browse keeps the boards' pages as they are, edit opens
	 * them for editing too — but not while the pen is out: ink has its own selection (the lasso).
	 */
	createEffect(() => {
		if (d.props.drawing) {
			d.editor.select([]);
			d.editor.pickPages([]);
			d.editor.setText(undefined);
			setPenTool("select");
		}
	});

	/*
	 * The drag as far as the canvas shows it: nothing yet while the carried picture of what was picked
	 * up is on its way (`render/engine.ts`, `onCarryPending`), so outlines and handles stay on the items, which
	 * the sheet still draws where they were, and both go with the pointer from the same frame.
	 */
	d.penLayer.onCarryPending = d.editor.carryPending;

	// A drop's glide: the outlines, handles and size round what glides ride with it, frame by frame.
	d.penLayer.onGlide = d.editor.setGlide;

}
