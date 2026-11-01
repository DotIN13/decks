import { ToolColumn } from "../ToolColumn.tsx";
import type { FormParts } from "./parts.ts";

/**
 * A phone's chrome (`tools: row`, no `zoom-bar` in the rules table): the tools a row just above the page's
 * dock, where the thumb is, and no zoom bar, since a phone pinches.
 */
export function PhoneForm(props: FormParts) {
	const { chrome } = props;
	return (
		<div class="frame-tool-row" style={{ bottom: `${chrome.dock() + 8}px` }}>
			<ToolColumn row onStep={props.step} onApps={() => chrome.panel("apps")} onOpenFile={() => chrome.panel("files")} onPen={props.setPen} mode={chrome.mode()} onMode={(next) => chrome.setMode(next)} />
		</div>
	);
}
