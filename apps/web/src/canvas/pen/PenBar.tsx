import { indexOf, isArrow, newId, ids as penIds, type PenDocument, type PenNode } from "@decks/pen";
import type { LucideIcon } from "lucide-solid";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Circle from "lucide-solid/icons/circle";
import Copy from "lucide-solid/icons/copy";
import FrameIcon from "lucide-solid/icons/frame";
import MousePointer2 from "lucide-solid/icons/mouse-pointer-2";
import Redo2 from "lucide-solid/icons/redo-2";
import SendToBack from "lucide-solid/icons/send-to-back";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Trash2 from "lucide-solid/icons/trash-2";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import { createMemo, For, Show } from "solid-js";
import { penSelection, penTool, setPenSelection, setPenTool, type PenTool } from "../../state/pen-tools.ts";
import { Icon } from "../../ui/icons.tsx";

/**
 * The drawing's controls, in edit mode, in two floats.
 *
 * **The tools** are a column on the canvas's left edge, halfway down, with undo and redo under
 * them: always there while editing, so they stand where no board's title bar is framed. A row
 * under the top clusters was tried first and covered exactly that strip, which a fitted board puts
 * its title in (`camera/insets.ts` on what may float over the canvas and what may not).
 *
 * **What the selection is** — its colour, its line, its type size or corners, its order, a copy
 * and a delete — is a row in the ink bar's place, and only while something in the drawing is
 * selected: summoned, like the inspector, so it may cover what is under it. Every control sends a
 * pen operation, the same one an agent would, and shows the value of the first selected item.
 */
const TOOLS: Array<{ tool: PenTool; icon: LucideIcon; label: string; key: string }> = [
	{ tool: "select", icon: MousePointer2, label: "Select and move; shift adds, shift-drag draws a box round several", key: "V" },
	{ tool: "rectangle", icon: Square, label: "Rectangle: drag to size it, or click for one", key: "R" },
	{ tool: "ellipse", icon: Circle, label: "Ellipse", key: "O" },
	{ tool: "frame", icon: FrameIcon, label: "Frame: a box that holds what is drawn inside it", key: "F" },
	{ tool: "text", icon: Type, label: "Text", key: "⇧T" },
	{ tool: "note", icon: StickyNote, label: "Note", key: "N" },
	{ tool: "arrow", icon: ArrowUpRight, label: "Arrow: drag from one thing to another and it stays joined", key: "A" },
];

const FILLS = ["#ffffff", "#dbe4f0", "#fde68a", "#bbf7d0", "#bfdbfe", "#fecaca", "#1f2328"];
const LINE_WIDTHS = [0, 1, 2, 4];
const TEXTY = new Set(["text", "note", "prompt", "context"]);

/** The colour a value names, for the colour input: a hex colour, or undefined for a variable or a gradient. */
const hexOf = (value: unknown): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	const text = typeof first === "string" ? first : first && typeof first === "object" && (first as { type?: string }).type === "color" ? (first as { color?: unknown }).color : undefined;
	return typeof text === "string" && /^#[0-9a-f]{6}/i.test(text) ? text.slice(0, 7).toLowerCase() : undefined;
};

/** A stroke written in pen's older one-object spelling, which is changed in that spelling. */
const legacyStroke = (node: PenNode) => (node.stroke && typeof node.stroke === "object" && !Array.isArray(node.stroke) && !("type" in node.stroke) ? (node.stroke as Record<string, unknown>) : undefined);

export function PenBar(props: { doc: PenDocument | undefined; onEdit: (ops: unknown[]) => void; onStep: (direction: "undo" | "redo") => void; onArm: (tool: PenTool) => void }) {
	const selected = createMemo(() => {
		const doc = props.doc;
		if (!doc) return [];
		const index = indexOf(doc);
		return penSelection().flatMap((id) => {
			const found = index.get(id);
			return found ? [found.node] : [];
		});
	});
	const first = () => selected()[0];
	const fillable = () => selected().filter((node) => !isArrow(node) && node.type !== "browser");
	const lined = () => selected().filter((node) => !TEXTY.has(node.type) && node.type !== "browser");
	const texty = () => selected().filter((node) => TEXTY.has(node.type));
	const cornered = () => selected().filter((node) => node.type === "rectangle" || node.type === "frame");
	/** "Colour" when everything picked is words, whose fill is the colour of the letters. */
	const fillWord = () => (fillable().length && fillable().every((node) => node.type === "text") ? "Text colour" : "Fill");

	const set = (nodes: PenNode[], fields: (node: PenNode) => Record<string, unknown>) => props.onEdit(nodes.map((node) => ({ op: "update", id: node.id, set: fields(node) })));
	const setFill = (fill: string | null) => set(fillable(), () => ({ fill }));
	const setLine = (color: string) =>
		set(lined(), (node) => {
			const legacy = legacyStroke(node);
			return legacy ? { stroke: { ...legacy, fill: color } } : { stroke: color, ...(node.strokeWidth === undefined ? { strokeWidth: 1 } : {}) };
		});
	const setLineWidth = (width: number) =>
		set(lined(), (node) => {
			const legacy = legacyStroke(node);
			if (legacy) return width === 0 ? { stroke: null } : { stroke: { ...legacy, thickness: width } };
			if (width === 0) return { stroke: null, strokeWidth: null };
			return { strokeWidth: width, ...(node.stroke === undefined ? { stroke: "#57606a" } : {}) };
		});
	const lineWidth = () => {
		const node = lined()[0];
		if (!node || node.stroke === undefined) return 0;
		const legacy = legacyStroke(node);
		const width = legacy ? legacy.thickness : node.strokeWidth;
		return typeof width === "number" ? width : 1;
	};
	const lineColor = () => {
		const node = lined()[0];
		const legacy = node && legacyStroke(node);
		return hexOf(legacy ? legacy.fill : node?.stroke) ?? "#57606a";
	};
	const numberOf = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);

	const order = (where: "front" | "back") => props.onEdit(selected().map((node) => ({ op: "move", id: node.id, index: where === "front" ? 1e9 : 0 })));
	const duplicate = () => {
		const taken = props.doc ? penIds(props.doc) : new Set<string>();
		const made: string[] = [];
		props.onEdit(
			selected().flatMap((node) => {
				const as = newId(taken);
				taken.add(as);
				made.push(as);
				// Beside the original: pen's own x and y, moved, when it has them.
				const beside = typeof node.x === "number" && typeof node.y === "number" ? [{ op: "update", id: as, set: { x: node.x + 24, y: node.y + 24 } }] : [];
				return [{ op: "copy", id: node.id, as }, ...beside];
			}),
		);
		setPenSelection(made);
	};
	const remove = () => {
		props.onEdit(selected().map((node) => ({ op: "delete", id: node.id })));
		setPenSelection([]);
	};

	return (
		<>
		<div class="pen-tools float" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
			<For each={TOOLS}>
				{(entry) => (
					<button
						type="button"
						class="icon-button"
						data-tool={entry.tool}
						data-on={penTool() === entry.tool ? "true" : undefined}
						aria-pressed={penTool() === entry.tool}
						title={`${entry.label} (${entry.key})`}
						aria-label={entry.label}
						onClick={() => {
							setPenTool(entry.tool);
							props.onArm(entry.tool);
						}}
					>
						<Icon of={entry.icon} size={15} />
					</button>
				)}
			</For>
			<span class="pen-rule" aria-hidden="true" />
			<button type="button" class="icon-button" title="Undo your last change to the drawing (⌘Z)" aria-label="Undo" onClick={() => props.onStep("undo")}>
				<Icon of={Undo2} size={15} />
			</button>
			<button type="button" class="icon-button" title="Redo (⇧⌘Z)" aria-label="Redo" onClick={() => props.onStep("redo")}>
				<Icon of={Redo2} size={15} />
			</button>
		</div>

		<Show when={selected().length > 0}>
		<div class="pen-bar float pill" role="toolbar" aria-label="The selected drawing">
			<Show when={fillable().length > 0}>
				<span class="inkbar-swatches" role="group" aria-label={fillWord()}>
					<For each={FILLS}>
						{(color) => (
							<button
								type="button"
								class="inkbar-swatch"
								data-on={hexOf(first()?.fill) === color ? "true" : undefined}
								title={`${fillWord()} ${color}`}
								aria-label={`${fillWord()} ${color}`}
								style={{ "--swatch": color }}
								onClick={() => setFill(color)}
							/>
						)}
					</For>
					<label class="inkbar-swatch pen-custom" title={`Any ${fillWord().toLowerCase()}`} style={{ "--swatch": hexOf(fillable()[0]?.fill) ?? "transparent" }}>
						<input type="color" aria-label={`Any ${fillWord().toLowerCase()}`} value={hexOf(fillable()[0]?.fill) ?? "#ffffff"} onChange={(event) => setFill(event.currentTarget.value)} />
					</label>
					<Show when={fillWord() === "Fill"}>
						<button type="button" class="pen-word" title="No fill" aria-label="No fill" data-on={fillable()[0]?.fill === undefined ? "true" : undefined} onClick={() => setFill(null)}>
							None
						</button>
					</Show>
				</span>
			</Show>

			<Show when={lined().length > 0}>
				<span class="pill-sep" aria-hidden="true" />
				<span class="inkbar-widths" role="group" aria-label="Line">
					<label class="inkbar-swatch pen-custom pen-line" title="Line colour" style={{ "--swatch": lineColor() }}>
						<input type="color" aria-label="Line colour" value={lineColor()} onChange={(event) => setLine(event.currentTarget.value)} />
					</label>
					<For each={LINE_WIDTHS}>
						{(width) => (
							<button
								type="button"
								class="icon-button inkbar-width"
								data-on={lineWidth() === width ? "soft" : undefined}
								aria-pressed={lineWidth() === width}
								title={width === 0 ? "No line" : `A line ${width} pixel${width === 1 ? "" : "s"} wide`}
								aria-label={width === 0 ? "No line" : `Line ${width} pixels`}
								onClick={() => setLineWidth(width)}
							>
								<Show when={width > 0} fallback={<span class="pen-none" />}>
									<span style={{ height: `${width}px` }} />
								</Show>
							</button>
						)}
					</For>
				</span>
			</Show>

			<Show when={texty().length > 0}>
				<span class="pill-sep" aria-hidden="true" />
				<label class="pen-field" title="Type size, in pixels">
					<span>Size</span>
					<input
						type="number"
						min="6"
						max="400"
						aria-label="Type size"
						value={numberOf(texty()[0]?.fontSize, 14)}
						onChange={(event) => {
							const size = Number(event.currentTarget.value);
							if (size > 0) set(texty(), () => ({ fontSize: size }));
						}}
					/>
				</label>
			</Show>

			<Show when={cornered().length > 0}>
				<span class="pill-sep" aria-hidden="true" />
				<label class="pen-field" title="Corner radius, in pixels">
					<span>Corners</span>
					<input
						type="number"
						min="0"
						max="999"
						aria-label="Corner radius"
						value={numberOf(cornered()[0]?.cornerRadius, 0)}
						onChange={(event) => {
							const radius = Math.max(0, Number(event.currentTarget.value) || 0);
							set(cornered(), () => ({ cornerRadius: radius === 0 ? null : radius }));
						}}
					/>
				</label>
			</Show>

			<span class="pill-sep" aria-hidden="true" />
				<button type="button" class="icon-button" title="Bring to the front" aria-label="Bring to the front" onClick={() => order("front")}>
					<Icon of={BringToFront} size={15} />
				</button>
				<button type="button" class="icon-button" title="Send to the back" aria-label="Send to the back" onClick={() => order("back")}>
					<Icon of={SendToBack} size={15} />
				</button>
				<button type="button" class="icon-button" title="Duplicate (⌘D)" aria-label="Duplicate" onClick={duplicate}>
					<Icon of={Copy} size={15} />
				</button>
				<button type="button" class="icon-button" title="Delete (Delete)" aria-label="Delete" onClick={remove}>
					<Icon of={Trash2} size={15} />
				</button>
		</div>
		</Show>
		</>
	);
}
