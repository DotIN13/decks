import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { isShape, makeLabel, newId, ids as penIds, shapeLabel, type PenNode } from "@decks/pen";
import AlignCenterHorizontal from "lucide-solid/icons/align-center-horizontal";
import AlignEndHorizontal from "lucide-solid/icons/align-end-horizontal";
import AlignStartHorizontal from "lucide-solid/icons/align-start-horizontal";
import Bold from "lucide-solid/icons/bold";
import Italic from "lucide-solid/icons/italic";
import TextAlignCenter from "lucide-solid/icons/text-align-center";
import TextAlignEnd from "lucide-solid/icons/text-align-end";
import TextAlignStart from "lucide-solid/icons/text-align-start";
import { For, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { ColorField, IconToggle, NumField, Swatches } from "./fields.tsx";
import { MIXED, colorOf, numberOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import { LINES, FONTS, WEIGHTS } from "./palette.ts";
import type { PropertiesProps } from "./props.ts";
import type { SetFields } from "./writes.ts";

/** What `createWords` reads of the panel (`../Properties.tsx`). */
export interface WordsNeeds {
	readonly writer: (live?: boolean) => SetFields;
	readonly wordTargets: Accessor<PenNode[]>;
	readonly edit: (ops: unknown[]) => void;
	readonly props: PropertiesProps;
	readonly shapes: Accessor<PenNode[]>;
	readonly selected: Accessor<PenNode[]>;
	readonly set: SetFields;
	readonly shownOf: (value: string | typeof MIXED | undefined) => string | undefined;
	readonly live: (apply: (color: string) => void) => (color?: string) => void;
}

/** The Text section: the font, size, weight, alignment and colour of words, a shape's among them. */
export function createWords(d: WordsNeeds) {
	const setTextColor = (color: string, drawOnly?: boolean) => d.writer(drawOnly)(d.wordTargets().filter((node) => node.type === "text"), () => ({ fill: color }));

	const words = () => d.wordTargets();

	const fontFamily = () => shared(words(), (node) => (typeof node.fontFamily === "string" ? node.fontFamily : "Inter"));

	const fontSize = () => shared(words(), (node) => numberOf(node.fontSize, node.type === "text" ? 14 : 14));

	const fontWeight = () => shared(words(), (node) => Number(node.fontWeight ?? 400));

	const italic = () => shared(words(), (node) => node.fontStyle === "italic");

	const textAlign = () => shared(words(), (node) => node.textAlign ?? "left");

	const textColor = () => shared(words().filter((node) => node.type === "text"), (node) => colorOf(node.fill));

	const lineHeight = () => shared(words(), (node) => numberOf(node.lineHeight, 0));

	const spacing = () => shared(words(), (node) => numberOf(node.letterSpacing, 0));

	/** A shape's words, typed in the panel: its text, or a new one made inside it. */
	const setShapeWords = (shape: PenNode, content: string) => {
		const label = shapeLabel(shape);
		if (label) return d.edit([content ? { op: "update", id: label.id, set: { content } } : { op: "delete", id: label.id }]);
		if (!content || !d.props.doc) return;
		d.edit([{ op: "insert", parent: shape.id, node: makeLabel(newId(penIds(d.props.doc)), content) }]);
	};

	/** Where a shape's words sit, top to bottom: its frame's layout. */
	const shapeVertical = () => shared(d.shapes(), (node) => (node.justifyContent === "start" ? "top" : node.justifyContent === "end" ? "bottom" : "middle"));

	const wordsSection = () => (
		<Show when={words().length > 0 || (d.shapes().length > 0 && d.shapes().every((node) => shapeLabel(node)))}>
			<Section key="words" title={d.shapes().length > 0 && words().length > 0 && d.selected().every(isShape) ? m.canvas_props_words_in_shape() : m.canvas_props_kind_text()}>
				<div class="props-row">
					<select class="props-select" aria-label={m.canvas_props_font()} value={String(fontFamily() ?? "Inter")} onChange={(event) => d.set(words(), () => ({ fontFamily: event.currentTarget.value === "Inter" ? null : event.currentTarget.value }))}>
						<Show when={fontFamily() === MIXED}>
							<option value={MIXED}>{m.canvas_props_mixed()}</option>
						</Show>
						<Show when={typeof fontFamily() === "string" && fontFamily() !== MIXED && !FONTS.includes(fontFamily() as string)}>
							<option value={String(fontFamily())}>{String(fontFamily())}</option>
						</Show>
						<For each={FONTS}>{(font) => <option value={font}>{font}</option>}</For>
					</select>
					<input
						class="field props-font"
						placeholder={m.canvas_props_google_font()}
						aria-label={m.canvas_props_google_font()}
						title={m.canvas_props_google_font_title()}
						on:keydown={(event: KeyboardEvent) => {
							event.stopPropagation();
							if (event.key !== "Enter") return;
							const name = (event.currentTarget as HTMLInputElement).value.trim();
							if (name) d.set(words(), () => ({ fontFamily: name }));
							(event.currentTarget as HTMLInputElement).value = "";
						}}
					/>
				</div>
				<div class="props-nums two">
					<NumField label={m.canvas_props_font_size()} value={fontSize()} min={4} onCommit={(v) => d.set(words(), () => ({ fontSize: Math.max(4, v) }))} />
					<label class="field props-num">
						<b>w</b>
						<select aria-label={m.canvas_props_icon_weight()} value={String(fontWeight() ?? 400)} onChange={(event) => d.set(words(), () => ({ fontWeight: Number(event.currentTarget.value) }))}>
							<Show when={fontWeight() === MIXED}>
								<option value={MIXED}>{m.canvas_props_mixed()}</option>
							</Show>
							<For each={WEIGHTS}>{(weight) => <option value={String(weight)}>{weight}</option>}</For>
						</select>
					</label>
				</div>
				<div class="props-row">
					<div class="props-buttons" role="group" aria-label={m.canvas_props_alignment()}>
						<IconToggle on={textAlign() === "left"} title={m.canvas_props_side_left()} onClick={() => d.set(words(), () => ({ textAlign: "left" }))}>
							<Icon of={TextAlignStart} size={14} />
						</IconToggle>
						<IconToggle on={textAlign() === "center"} title={m.canvas_props_line_centre()} onClick={() => d.set(words(), () => ({ textAlign: "center" }))}>
							<Icon of={TextAlignCenter} size={14} />
						</IconToggle>
						<IconToggle on={textAlign() === "right"} title={m.canvas_props_side_right()} onClick={() => d.set(words(), () => ({ textAlign: "right" }))}>
							<Icon of={TextAlignEnd} size={14} />
						</IconToggle>
					</div>
					<Show when={d.shapes().length > 0}>
						<div class="props-buttons" role="group" aria-label={m.canvas_props_vertical()}>
							<IconToggle on={shapeVertical() === "top"} title={m.canvas_props_at_top()} onClick={() => d.set(d.shapes(), () => ({ justifyContent: "start" }))}>
								<Icon of={AlignStartHorizontal} size={14} />
							</IconToggle>
							<IconToggle on={shapeVertical() === "middle"} title={m.canvas_props_at_middle()} onClick={() => d.set(d.shapes(), () => ({ justifyContent: "center" }))}>
								<Icon of={AlignCenterHorizontal} size={14} />
							</IconToggle>
							<IconToggle on={shapeVertical() === "bottom"} title={m.canvas_props_at_bottom()} onClick={() => d.set(d.shapes(), () => ({ justifyContent: "end" }))}>
								<Icon of={AlignEndHorizontal} size={14} />
							</IconToggle>
						</div>
					</Show>
					<div class="props-buttons" role="group" aria-label={m.canvas_props_style()}>
						<IconToggle on={fontWeight() !== MIXED && Number(fontWeight()) >= 600} title={m.canvas_props_bold()} onClick={() => d.set(words(), (node) => ({ fontWeight: Number(node.fontWeight ?? 400) >= 600 ? 400 : 700 }))}>
							<Icon of={Bold} size={14} />
						</IconToggle>
						<IconToggle on={italic() === true} title={m.canvas_props_italic()} onClick={() => d.set(words(), (node) => ({ fontStyle: node.fontStyle === "italic" ? null : "italic" }))}>
							<Icon of={Italic} size={14} />
						</IconToggle>
					</div>
				</div>
				<div class="props-nums two">
					<NumField label={m.canvas_props_line_height()} value={lineHeight()} min={0} step={0.1} placeholder={m.canvas_props_auto()} onCommit={(v) => d.set(words(), () => ({ lineHeight: v <= 0 ? null : v }))} />
					<NumField label={m.canvas_props_letter_spacing()} value={spacing()} step={0.1} onCommit={(v) => d.set(words(), () => ({ letterSpacing: v === 0 ? null : v }))} />
				</div>
				<Show when={words().some((node) => node.type === "text")}>
					<Swatches colors={LINES} value={textColor()} onPick={(color) => setTextColor(color)} label={m.canvas_props_text_colour()} />
					<div class="props-row">
						<span class="props-label">{m.canvas_props_colour()}</span>
						<ColorField value={textColor()} shown={d.shownOf(textColor())} onCommit={(color) => setTextColor(color)} onLive={d.live((color) => setTextColor(color, true))} label={m.canvas_props_text_colour()} />
					</div>
				</Show>
			</Section>
		</Show>
	);

	return {
		setShapeWords,
		wordsSection,
	};
}
