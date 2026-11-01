import { RULES } from "@decks/canvas/device";
import { Show } from "solid-js";
import { ToolColumn } from "../ToolColumn.tsx";
import { ZoomBar } from "../ZoomBar.tsx";
import type { FormParts } from "./parts.ts";

/**
 * A desk's chrome (`tools: column`, `zoom-bar` in the rules table): the tool column floating at the left,
 * dragged by its grip and stowed at an edge, and the zoom bar.
 */
export function DeskForm(props: FormParts) {
	const { chrome } = props;
	return (
		<>
			<ToolColumn onStep={props.step} onFloat={props.floatTools} onApps={() => chrome.panel("apps")} onOpenFile={() => chrome.panel("files")} onPen={props.setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />
			<Show when={RULES.zoomBar}>
				<ZoomBar zoom={chrome.camera().zoom} onZoom={(zoom) => chrome.handle.setCamera({ ...chrome.camera(), zoom })} onFit={() => chrome.handle.fit()} />
			</Show>
		</>
	);
}
