import type { LucideIcon } from "lucide-solid";
import FileText from "lucide-solid/icons/file-text";
import MoveRight from "lucide-solid/icons/move-right";
import MousePointer2 from "lucide-solid/icons/mouse-pointer-2";
import RectangleHorizontal from "lucide-solid/icons/rectangle-horizontal";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import { For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import type { Tool } from "./Editor.ts";

/**
 * The tools, floating beside the stage.
 *
 * Shown only when the camera is close enough to edit — at a distance the boards are
 * a map, and a palette over a map is an invitation to insert a sticky you will never
 * find. `V` returns to select, and so does finishing an insert.
 *
 * The keys in these tooltips were a promise nothing kept for a while: they are handled
 * by the stage, beside the camera shortcuts, since a board frame is its own document
 * and a keypress over one never reaches this component either way.
 */
const TOOLS: Array<{ tool: Tool; icon: LucideIcon; label: string; key: string }> = [
	{ tool: "select", icon: MousePointer2, label: "Select, drag, resize", key: "V" },
	{ tool: "sticky", icon: StickyNote, label: "Sticky note", key: "S" },
	{ tool: "card", icon: RectangleHorizontal, label: "Card", key: "C" },
	{ tool: "text", icon: Type, label: "Text", key: "T" },
	{ tool: "embed", icon: FileText, label: "Embed a file", key: "E" },
	// Two clicks rather than a drag: a connector is a relation between two components,
	// not a box you place. It was the agent's alone until the editor learnt the gesture.
	{ tool: "arrow", icon: MoveRight, label: "Connect two components", key: "A" },
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
							aria-label={entry.label}
							onClick={() => props.onPick(entry.tool)}
						>
							<Icon of={entry.icon} size={17} />
						</button>
					)}
				</For>
			</aside>
		</Show>
	);
}
