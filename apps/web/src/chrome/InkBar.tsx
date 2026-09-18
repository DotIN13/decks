import { INK_COLORS, inkPaint } from "@decks/board-kit";
import type { LucideIcon } from "lucide-solid";
import Eraser from "lucide-solid/icons/eraser";
import Highlighter from "lucide-solid/icons/highlighter";
import Lasso from "lucide-solid/icons/lasso";
import PenLine from "lucide-solid/icons/pen-line";
import Redo2 from "lucide-solid/icons/redo-2";
import Trash2 from "lucide-solid/icons/trash-2";
import Undo2 from "lucide-solid/icons/undo-2";
import X from "lucide-solid/icons/x";
import { For, onCleanup, onMount, Show } from "solid-js";
import {
	canRedoInk,
	canUndoInk,
	deleteInkSelection,
	INK_WIDTHS,
	inkColor,
	inkSelection,
	inkTool,
	inkWidth,
	redoInk,
	setInkColor,
	setInkSelection,
	setInkTool,
	setInkWidth,
	undoInk,
	type InkTool,
} from "../state/ink.ts";
import { Icon } from "../ui/icons.tsx";
import { inkKey } from "./ink-keys.ts";

/**
 * The drawing tools: what is in your hand, its colour and width, and undo, redo and delete.
 *
 * One row under the top clusters, there while the draw tool is on and gone with it. The
 * order is the order a notes app uses, and for the same reason: the tools you change between
 * most are on the left, what they look like is in the middle, and taking things back is at
 * the far end where a resting hand does not press it.
 */
const TOOLS: Array<{ tool: InkTool; icon: LucideIcon; label: string }> = [
	{ tool: "pen", icon: PenLine, label: "Pen: draws, and presses harder with a pencil" },
	{ tool: "marker", icon: Highlighter, label: "Marker: wide and see-through, for marking words" },
	{ tool: "eraser", icon: Eraser, label: "Eraser: removes each stroke it touches" },
	{ tool: "lasso", icon: Lasso, label: "Lasso: loop round strokes to select them, then drag or delete" },
];

const COLOR_NAMES: Record<(typeof INK_COLORS)[number], string> = { ink: "Black or white, with the theme", red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };

export function InkBar(props: { onDone: () => void }) {
	/*
	 * The keys, while the tool is on. On the window and in the capture phase, because the
	 * stage answers the same keys for the board (⌘Z is "undo on this board") and while you
	 * are drawing they mean the drawing.
	 */
	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
			const action = inkKey(event);
			if (!action) return;
			if (action === "escape") {
				if (inkSelection()) setInkSelection(undefined);
				else props.onDone();
			} else if (action === "undo") undoInk();
			else if (action === "redo") redoInk();
			else if (action === "delete") {
				if (!inkSelection()) return;
				deleteInkSelection();
			}
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		onCleanup(() => window.removeEventListener("keydown", onKey, true));
	});

	const widths = () => INK_WIDTHS[inkTool() === "marker" ? "marker" : "pen"];
	const paints = () => inkTool() === "pen" || inkTool() === "marker";

	return (
		<div class="inkbar float pill" role="toolbar" aria-label="Drawing tools">
			<For each={TOOLS}>
				{(entry) => (
					<button
						type="button"
						class="iconbtn"
						data-on={inkTool() === entry.tool ? "true" : undefined}
						aria-pressed={inkTool() === entry.tool}
						title={entry.label}
						aria-label={entry.label}
						onClick={() => {
							setInkTool(entry.tool);
							if (entry.tool !== "lasso") setInkSelection(undefined);
						}}
					>
						<Icon of={entry.icon} size={15} />
					</button>
				)}
			</For>

			<Show when={paints()}>
				<span class="pill-sep" aria-hidden="true" />
				<span class="inkbar-swatches" role="group" aria-label="Colour">
					<For each={INK_COLORS}>
						{(color) => (
							<button
								type="button"
								class="inkbar-swatch"
								data-on={inkColor() === color ? "true" : undefined}
								aria-pressed={inkColor() === color}
								title={COLOR_NAMES[color]}
								aria-label={COLOR_NAMES[color]}
								style={{ "--swatch": color === "ink" ? "var(--fg)" : inkPaint(color) }}
								onClick={() => setInkColor(color)}
							/>
						)}
					</For>
				</span>
				<span class="pill-sep" aria-hidden="true" />
				<span class="inkbar-widths" role="group" aria-label="Width">
					<For each={[0, 1, 2]}>
						{(index) => (
							<button
								type="button"
								class="iconbtn inkbar-width"
								data-on={inkWidth() === index ? "soft" : undefined}
								aria-pressed={inkWidth() === index}
								title={`${widths()[index]} pixels wide`}
								aria-label={`${widths()[index]} pixels wide`}
								onClick={() => setInkWidth(index)}
							>
								<span style={{ height: `${2 + index * 3}px` }} />
							</button>
						)}
					</For>
				</span>
			</Show>

			<Show when={inkSelection()}>
				<span class="pill-sep" aria-hidden="true" />
				<button type="button" class="iconbtn" title="Delete the selected strokes (Delete)" aria-label="Delete the selected strokes" onClick={deleteInkSelection}>
					<Icon of={Trash2} size={15} />
				</button>
			</Show>

			<span class="pill-sep" aria-hidden="true" />
			<button type="button" class="iconbtn" disabled={!canUndoInk()} title="Undo the last stroke (⌘Z)" aria-label="Undo the last stroke" onClick={undoInk}>
				<Icon of={Undo2} size={15} />
			</button>
			<button type="button" class="iconbtn" disabled={!canRedoInk()} title="Redo (⇧⌘Z)" aria-label="Redo" onClick={redoInk}>
				<Icon of={Redo2} size={15} />
			</button>
			<span class="pill-sep" aria-hidden="true" />
			<button type="button" class="iconbtn" title="Stop drawing (Escape)" aria-label="Stop drawing" onClick={props.onDone}>
				<Icon of={X} size={15} />
			</button>
		</div>
	);
}
