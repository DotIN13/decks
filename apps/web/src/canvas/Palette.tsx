import { For, Show } from "solid-js";
import type { Tool } from "./Editor.ts";

/**
 * The tools, floating beside the stage.
 *
 * Shown only when the camera is close enough to edit — at a distance the boards are
 * a map, and a palette over a map is an invitation to insert a sticky you will never
 * find. `V` returns to select, and so does finishing an insert.
 */
const TOOLS: Array<{ tool: Tool; glyph: string; label: string; key: string }> = [
	{ tool: "select", glyph: "▹", label: "Select, drag, resize", key: "V" },
	{ tool: "sticky", glyph: "▪", label: "Sticky note", key: "S" },
	{ tool: "card", glyph: "▭", label: "Card", key: "C" },
	{ tool: "text", glyph: "T", label: "Text", key: "T" },
	{ tool: "embed", glyph: "▤", label: "Embed a file", key: "E" },
];

export function Palette(props: { tool: Tool; visible: boolean; onPick: (tool: Tool) => void }) {
	return (
		<Show when={props.visible}>
			<aside class="panel-float palette">
				<For each={TOOLS}>
					{(entry) => (
						<button
							type="button"
							data-active={props.tool === entry.tool}
							title={`${entry.label} (${entry.key})`}
							onClick={() => props.onPick(entry.tool)}
						>
							{entry.glyph}
						</button>
					)}
				</For>
			</aside>
		</Show>
	);
}
