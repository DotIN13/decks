import { createSignal } from "solid-js";
import { rgbOf } from "../edit/dom/colours.ts";

/** What `createEngineColours` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface EngineColoursNeeds {

}

export function createEngineColours(d: EngineColoursNeeds) {
	/*
	 * The editor's outlines, handles and guides are painted by the engine with the drawing, in the same
	 * frame (`edit/core/overlay-json.ts`): written again when the overlay or the zoom changes, and the
	 * DOM's own are made invisible once the engine has them (`data-engine-overlays`, `canvas.css`).
	 */
	const [engineOverlays, setEngineOverlays] = createSignal(false);

	/*
	 * The overlay's colours, read through the browser once a scheme: on a probe of their own inside the canvas
	 * (it inherits the canvas's custom properties), never the canvas itself. Setting `color` on the canvas to read
	 * one back restyled everything under it, every card included, and it was read at every overlay change: four
	 * times a move while dragging out a shape or an arrow, which on a large screen held frames to about 48 ms.
	 */
	let colourProbe: HTMLSpanElement | undefined;

	let colours: { dark: string; accent: [number, number, number]; panel: [number, number, number]; guide: [number, number, number] } | undefined;

	const coloursFor = (dark: string, canvas: HTMLElement) => {
		if (colours?.dark === dark && colourProbe?.isConnected) return colours;
		if (!colourProbe?.isConnected) {
			colourProbe = document.createElement("span");
			colourProbe.className = "canvas-colour-probe";
			colourProbe.style.display = "none";
			canvas.append(colourProbe);
		}
		const vars = getComputedStyle(canvas);
		colours = {
			dark,
			accent: rgbOf(vars.getPropertyValue("--canvas-accent").trim() || "#2563eb", colourProbe),
			panel: rgbOf(vars.getPropertyValue("--canvas-panel").trim() || "#fff", colourProbe),
			guide: [0.949, 0.306, 0.118],
		};
		return colours;
	};

	return {
		coloursFor,
		setEngineOverlays,
		engineOverlays,
	};
}
