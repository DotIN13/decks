import type { TabKind } from "../kind.ts";
import Layers from "lucide-solid/icons/layers";
import { Icon } from "@decks/ui";
import { Show } from "solid-js";
import { canvases } from "../../state/canvases.ts";
import { CanvasHost } from "./canvas-host.tsx";
import { CanvasTools } from "./canvas-tools.tsx";

/**
 * The canvas, as a kind of tab: the canvas in its frame (`canvas-host.tsx`), and over it the tools
 * that are the canvas's own, the tool column, the pen tray, the properties and the zoom
 * (`canvas-tools.tsx`). The canvas on screen is the one the camera is on (`canvasOnScreen`); the
 * canvas tabs last in front keep their frames behind it, within the device's budget (`budget.ts`), so
 * coming back to one is showing it, and beyond the budget a frame moves from one canvas to the next
 * in place.
 */
export const canvasKind: TabKind = {
	name: "canvas",
	address: "canvas",
	title: (tab) => canvases().find((one) => one.name === tab.target)?.title,
	has: (target) => canvases().some((one) => one.name === target),
	icon: (props) => <Icon of={Layers} size={props.size ?? 16} />,
	// Kept while a tab of another kind is in front, out of sight: its frame, its canvas and where it was looking are as they were when it comes back. Hidden, not taken out of the layout: a frame with no size moves its view to keep its middle, and draws again when it has one.
	view: (tab, parts) => (
		<>
			<div class="surface" data-surface="stage" style={{ visibility: tab() ? undefined : "hidden", "pointer-events": tab() ? undefined : "none" }}>
				<div class="surface-layer" data-layer="stage">
					<CanvasHost host={parts.canvasHost} />
				</div>
			</div>
			<Show when={tab()}>
				<CanvasTools parts={parts} />
			</Show>
		</>
	),
};
