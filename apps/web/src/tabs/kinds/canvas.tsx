import type { TabKind } from "../kind.ts";
import Layers from "lucide-solid/icons/layers";
import { Icon } from "@decks/ui";
import { Show } from "solid-js";
import { stages } from "../../state/canvases.ts";
import { CanvasHost } from "./canvas-host.tsx";
import { CanvasTools } from "./canvas-tools.tsx";

/**
 * The canvas, as a kind of tab: the canvas in its frame (`canvas-host.tsx`), and over it the tools
 * that are the canvas's own, the tool column, the pen tray, the properties and the zoom
 * (`canvas-tools.tsx`). One frame for every canvas tab: it shows the canvas of the tab in front
 * (`canvasOnScreen`), and moves from one canvas to the next in place.
 */
export const canvasKind: TabKind = {
	name: "canvas",
	address: "canvas",
	title: (tab) => stages().find((one) => one.name === tab.target)?.title,
	says: (tab) => (tab.target === undefined ? undefined : `the canvas "${stages().find((one) => one.name === tab.target)?.title ?? tab.target}" (--canvas ${tab.target})`),
	has: (target) => stages().some((one) => one.name === target),
	icon: (props) => <Icon of={Layers} size={props.size ?? 16} />,
	// Kept while a tab of another kind is in front, out of sight: its frame, its canvas and where it was looking are as they were when it comes back.
	view: (tab, parts) => (
		<>
			<div class="surface" data-surface="stage" style={{ display: tab() ? undefined : "none" }}>
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
