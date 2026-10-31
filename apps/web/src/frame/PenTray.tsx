import { INK_COLORS, type InkColor } from "@decks/board-kit";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import Trash2 from "lucide-solid/icons/trash-2";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { INK_WIDTHS, inkColor, inkSwatch, inkSelection, inkTool, inkWidth, setInkColor, setInkSelection, setInkTool, setInkWidth, type InkTool } from "@decks/canvas/tools";
import { onDismiss } from "@decks/ui";
import { Icon } from "../ui/icons.tsx";

/**
 * The pen tray: the instruments in a row, the one in hand raised, its colour and its width.
 *
 * The v3 design draws it as a tray of real-looking tools beside the tool column, the way a notes
 * app on a tablet does. It holds what the canvas's ink can do: a pen, a marker, an eraser and a
 * lasso, five colours and three widths (`@decks/canvas`, `state/ink.ts`). Pressing the instrument
 * already in hand, or `⋯`, opens its widths under the tray.
 *
 * Its keys are the ones the old ink bar had, on the window and before the stage: ⌘Z and ⇧⌘Z mean
 * the drawing while the pen is out, Delete takes what the lasso holds, Escape lets the lasso go and
 * then puts the pen away.
 */
const INSTRUMENTS: Array<{ tool: InkTool; label: string }> = [
	{ tool: "pen", label: "Pen: draws, and presses harder with a pencil" },
	{ tool: "marker", label: "Marker: wide and see-through, for marking words" },
	{ tool: "eraser", label: "Eraser: removes each stroke it touches" },
	{ tool: "lasso", label: "Lasso: loop round strokes to select them, then drag or delete" },
];

const COLOR_NAMES: Record<InkColor, string> = { ink: "Black or white, with the theme", red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };

export function PenTray(props: {
	onDone: () => void;
	onStep: (direction: "undo" | "redo") => void;
	onDelete: (ids: string[]) => void;
	/** The tray as a float, as the tools and the composer are: dragged by its grip, flung, tucked behind an edge. */
	onFloat?: (tray: HTMLElement, grip: HTMLElement) => { unstow: () => void };
}) {
	let wrap: HTMLDivElement | undefined;
	let grip: HTMLSpanElement | undefined;
	let unstow = () => {};
	onMount(() => {
		if (wrap && grip && props.onFloat) unstow = props.onFloat(wrap, grip).unstow;
	});
	const [widths, setWidths] = createSignal(false);
	const paint = () => inkSwatch(inkColor());
	const deleteSelection = () => {
		const held = inkSelection();
		if (!held?.ids.length) return;
		props.onDelete(held.ids);
		setInkSelection(undefined);
	};

	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
			const command = event.metaKey || event.ctrlKey;
			const key = event.key.toLowerCase();
			if (command && !event.altKey && key === "z") props.onStep(event.shiftKey ? "redo" : "undo");
			else if (command && !event.altKey && !event.shiftKey && key === "y") props.onStep("redo");
			else if (command || event.altKey) return;
			else if (key === "delete" || key === "backspace") {
				if (!inkSelection()) return;
				deleteSelection();
			} else if (key === "escape") {
				if (widths()) setWidths(false);
				else if (inkSelection()) setInkSelection(undefined);
				else props.onDone();
			} else return;
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		// The widths open beside an instrument go with a press in the page around the canvas frame.
		const stopDismiss = onDismiss(() => setWidths(false));
		onCleanup(() => {
			window.removeEventListener("keydown", onKey, true);
			stopDismiss();
		});
	});

	const sizes = () => INK_WIDTHS[inkTool() === "marker" ? "marker" : "pen"];
	const paints = () => inkTool() === "pen" || inkTool() === "marker";

	return (
		<div class="v3-tray-wrap" ref={wrap}>
			<div class="v3-tray float" role="toolbar" aria-label="Pen tray">
				<span class="v3-tray-grip" ref={grip} data-tip="Drag to move; throw at an edge to put away" aria-hidden="true">
					<i />
					<i />
					<i />
					<i />
					<i />
					<i />
				</span>
				<div class="v3-instruments" role="group" aria-label="Instrument">
					<For each={INSTRUMENTS}>
						{(entry) => (
							<button
								type="button"
								class="v3-instrument"
								data-on={inkTool() === entry.tool ? "true" : undefined}
								aria-pressed={inkTool() === entry.tool}
								data-tip={entry.label.split(":")[0]}
								aria-label={entry.label}
								onClick={() => {
									if (inkTool() === entry.tool) return setWidths((open) => !open);
									setInkTool(entry.tool);
									if (entry.tool !== "lasso") setInkSelection(undefined);
								}}
							>
								<Instrument tool={entry.tool} paint={paint()} />
							</button>
						)}
					</For>
				</div>
				<span class="v3-tray-sep" aria-hidden="true" />
				<span class="v3-wheel" aria-hidden="true" style={{ "--current": paint() }} />
				<div class="v3-swatches" role="group" aria-label="Colour" data-off={paints() ? undefined : "true"}>
					<For each={INK_COLORS}>
						{(color) => (
							<button
								type="button"
								class="v3-swatch"
								data-on={inkColor() === color ? "true" : undefined}
								aria-pressed={inkColor() === color}
								disabled={!paints()}
								data-tip={COLOR_NAMES[color].split(",")[0]}
								aria-label={COLOR_NAMES[color]}
								style={{ "--swatch": inkSwatch(color) }}
								onClick={() => setInkColor(color)}
							/>
						)}
					</For>
				</div>
				<div class="v3-tray-actions">
					<Show
						when={inkSelection()}
						fallback={
							<button type="button" class="v3-icon" data-on={widths() ? "soft" : undefined} data-tip="Width" aria-label="Width" aria-expanded={widths()} onClick={() => setWidths((open) => !open)}>
								<Icon of={MoreHorizontal} size={16} />
							</button>
						}
					>
						<button type="button" class="v3-icon" data-tip="Delete the strokes" data-key="⌫" aria-label="Delete the selected strokes" onClick={deleteSelection}>
							<Icon of={Trash2} size={16} />
						</button>
					</Show>
				</div>
			</div>
			<button type="button" class="stowtab" data-stowtab aria-label="Bring the pen tray back" onClick={() => unstow()}>
				<Icon of={ChevronLeft} size={14} />
			</button>
			<Show when={widths() && paints()}>
				<div class="v3-widths float" role="group" aria-label="Width">
					<For each={[0, 1, 2]}>
						{(index) => (
							<button
								type="button"
								class="v3-width"
								data-on={inkWidth() === index ? "true" : undefined}
								aria-pressed={inkWidth() === index}
								data-tip={`${sizes()[index]} px`}
								aria-label={`${sizes()[index]} pixels wide`}
								onClick={() => setInkWidth(index)}
							>
								<span style={{ height: `${[2, 5, 9][index]}px`, background: paint() }} />
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

/** One instrument, drawn: a body, a tip of its own shape, and a band in the colour in hand. */
function Instrument(props: { tool: InkTool; paint: string }): JSX.Element {
	const tip = () => {
		switch (props.tool) {
			case "pen":
				return <path d="M13 2 L20 30 H6 Z" fill="var(--tray-body)" stroke="var(--tray-edge)" stroke-width="1" />;
			case "marker":
				return <path d="M6 30 V10 L20 4 V30 Z" fill="var(--tray-body)" stroke="var(--tray-edge)" stroke-width="1" />;
			case "eraser":
				return <path d="M5 30 V16 Q5 8 13 8 Q21 8 21 16 V30 Z" fill="#f4a7b5" stroke="var(--tray-edge)" stroke-width="1" />;
			default:
				return (
					<>
						<circle cx="13" cy="9" r="5.5" fill="none" stroke="var(--tray-edge)" stroke-width="1.5" />
						<path d="M8 30 L13 14.5 L18 30 Z" fill="var(--tray-body)" stroke="var(--tray-edge)" stroke-width="1" />
					</>
				);
		}
	};
	const nib = () => (props.tool === "pen" ? <path d="M13 2 L15.2 11 H10.8 Z" fill={props.paint} /> : props.tool === "marker" ? <path d="M6 10 L20 4 V8 L6 14 Z" fill={props.paint} /> : null);
	const banded = () => props.tool === "pen" || props.tool === "marker";
	return (
		<svg viewBox="0 0 26 90" width="26" height="90" aria-hidden="true">
			{tip()}
			{nib()}
			<rect x="5" y="30" width="16" height="62" rx="2" fill="var(--tray-body)" stroke="var(--tray-edge)" stroke-width="1" />
			<Show when={banded()}>
				<rect x="5" y="40" width="16" height="5" fill={props.paint} />
			</Show>
		</svg>
	);
}
