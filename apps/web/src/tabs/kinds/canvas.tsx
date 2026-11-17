import type { TabKind } from "../kind.ts";
import Layers from "lucide-solid/icons/layers";
import { Icon } from "@decks/ui";
import { stages } from "../../state/canvases.ts";
import { homeCanvas } from "../tabs.ts";
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
	title: (tab) => (tab.target === undefined ? homeCanvas() : stages().find((one) => one.name === tab.target))?.title,
	icon: (props) => <Icon of={Layers} size={props.size ?? 16} />,
	view: (_tab, parts) => (
		<>
			<div class="surface" data-surface="stage">
				<div class="surface-layer" data-layer="stage">
					<CanvasHost host={parts.canvasHost} />
				</div>
			</div>
			<CanvasTools parts={parts} />
		</>
	),
};
