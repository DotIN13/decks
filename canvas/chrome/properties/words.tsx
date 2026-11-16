// The panel's sections for words and icons: font, size, alignment and colour; an icon's library, name and weight.
import { isShape, shapeLabel } from "@decks/pen";
import AlignCenterHorizontal from "lucide-solid/icons/align-center-horizontal";
import AlignEndHorizontal from "lucide-solid/icons/align-end-horizontal";
import AlignStartHorizontal from "lucide-solid/icons/align-start-horizontal";
import Bold from "lucide-solid/icons/bold";
import Italic from "lucide-solid/icons/italic";
import TextAlignCenter from "lucide-solid/icons/text-align-center";
import TextAlignEnd from "lucide-solid/icons/text-align-end";
import TextAlignStart from "lucide-solid/icons/text-align-start";
import { For, Show } from "solid-js";
import { setInsertPanel } from "../../editor/pen-tools.ts";
import { Icon } from "@decks/ui";
import { ICON_LIBRARIES } from "../../look/icon-index.ts";
import { LINES, FONTS, WEIGHTS, MIXED, colorOf, numberOf, shared } from "./model.ts";
import { NumField, ColorField, Swatches, IconToggle, held, Section } from "./fields.tsx";
import type { PanelCtx } from "./state.ts";

/** Words: their font, size, weight, alignment, spacing and colour. */
export function WordsSection(own: { ctx: PanelCtx }) {
	const { selected, shapes, set, live, shownOf, setTextColor, words, fontWeight, italic, textAlign, textColor, lineHeight, spacing, shapeVertical } = own.ctx;
	return (
		<Show when={words().length > 0 || (shapes().length > 0 && shapes().every((node) => shapeLabel(node)))}>
			<Section key="words" title={shapes().length > 0 && words().length > 0 && selected().every(isShape) ? "Words in the shape" : "Text"}>
				<FontRows ctx={own.ctx} />
				<div class="props-row">
					<div class="props-buttons" role="group" aria-label="Alignment">
						<IconToggle on={textAlign() === "left"} title="Left" onClick={() => set(words(), () => ({ textAlign: "left" }))}>
							<Icon of={TextAlignStart} size={14} />
						</IconToggle>
						<IconToggle on={textAlign() === "center"} title="Centre" onClick={() => set(words(), () => ({ textAlign: "center" }))}>
							<Icon of={TextAlignCenter} size={14} />
						</IconToggle>
						<IconToggle on={textAlign() === "right"} title="Right" onClick={() => set(words(), () => ({ textAlign: "right" }))}>
							<Icon of={TextAlignEnd} size={14} />
						</IconToggle>
					</div>
					<Show when={shapes().length > 0}>
						<div class="props-buttons" role="group" aria-label="Up and down">
							<IconToggle on={shapeVertical() === "top"} title="At the top" onClick={() => set(shapes(), () => ({ justifyContent: "start" }))}>
								<Icon of={AlignStartHorizontal} size={14} />
							</IconToggle>
							<IconToggle on={shapeVertical() === "middle"} title="In the middle" onClick={() => set(shapes(), () => ({ justifyContent: "center" }))}>
								<Icon of={AlignCenterHorizontal} size={14} />
							</IconToggle>
							<IconToggle on={shapeVertical() === "bottom"} title="At the bottom" onClick={() => set(shapes(), () => ({ justifyContent: "end" }))}>
								<Icon of={AlignEndHorizontal} size={14} />
							</IconToggle>
						</div>
					</Show>
					<div class="props-buttons" role="group" aria-label="Style">
						<IconToggle on={fontWeight() !== MIXED && Number(fontWeight()) >= 600} title="Bold" onClick={() => set(words(), (node) => ({ fontWeight: Number(node.fontWeight ?? 400) >= 600 ? 400 : 700 }))}>
							<Icon of={Bold} size={14} />
						</IconToggle>
						<IconToggle on={italic() === true} title="Italic" onClick={() => set(words(), (node) => ({ fontStyle: node.fontStyle === "italic" ? null : "italic" }))}>
							<Icon of={Italic} size={14} />
						</IconToggle>
					</div>
				</div>
				<div class="props-nums two">
					<NumField label="line" value={lineHeight()} min={0} step={0.1} placeholder="auto" onCommit={(v) => set(words(), () => ({ lineHeight: v <= 0 ? null : v }))} />
					<NumField label="space" value={spacing()} step={0.1} onCommit={(v) => set(words(), () => ({ letterSpacing: v === 0 ? null : v }))} />
				</div>
				<Show when={words().some((node) => node.type === "text")}>
					<Swatches colors={LINES} value={textColor()} onPick={(color) => setTextColor(color)} label="Text colour" />
					<div class="props-row">
						<span class="props-label">Colour</span>
						<ColorField value={textColor()} shown={shownOf(textColor())} onCommit={(color) => setTextColor(color)} onLive={live((color) => setTextColor(color, true))} label="Text colour" />
					</div>
				</Show>
			</Section>
		</Show>
	);
}

/** The font, any Google font by name, the size and the weight. */
export function FontRows(own: { ctx: PanelCtx }) {
	const { set, words, fontFamily, fontSize, fontWeight } = own.ctx;
	return (
		<>
			<div class="props-row">
				<select class="props-select" aria-label="Font" value={String(fontFamily() ?? "Inter")} onChange={(event) => set(words(), () => ({ fontFamily: event.currentTarget.value === "Inter" ? null : event.currentTarget.value }))}>
					<Show when={fontFamily() === MIXED}>
						<option value={MIXED}>Mixed</option>
					</Show>
					<Show when={typeof fontFamily() === "string" && fontFamily() !== MIXED && !FONTS.includes(fontFamily() as string)}>
						<option value={String(fontFamily())}>{String(fontFamily())}</option>
					</Show>
					<For each={FONTS}>{(font) => <option value={font}>{font}</option>}</For>
				</select>
				<input
					class="field props-font"
					placeholder="Any Google font"
					aria-label="Any Google font"
					title="Any family on Google Fonts, by its name"
					on:keydown={(event: KeyboardEvent) => {
						event.stopPropagation();
						if (event.key !== "Enter") return;
						const name = (event.currentTarget as HTMLInputElement).value.trim();
						if (name) set(words(), () => ({ fontFamily: name }));
						(event.currentTarget as HTMLInputElement).value = "";
					}}
				/>
			</div>
			<div class="props-nums two">
				<NumField label="size" value={fontSize()} min={4} onCommit={(v) => set(words(), () => ({ fontSize: Math.max(4, v) }))} />
				<label class="field props-num">
					<b>w</b>
					<select aria-label="Weight" value={String(fontWeight() ?? 400)} onChange={(event) => set(words(), () => ({ fontWeight: Number(event.currentTarget.value) }))}>
						<Show when={fontWeight() === MIXED}>
							<option value={MIXED}>Mixed</option>
						</Show>
						<For each={WEIGHTS}>{(weight) => <option value={String(weight)}>{weight}</option>}</For>
					</select>
				</label>
			</div>
		</>
	);
}

/** An icon's library, name, weight and colour. */
export function IconSection(own: { ctx: PanelCtx }) {
	const { icons, set, live, shownOf, setIconColor } = own.ctx;
	return (
		<Show when={icons().length > 0}>
			<Section key="icon" title="Icon">
				<div class="props-row">
					<span class="props-label">Library</span>
					<select class="props-select" aria-label="Library" value={String(shared(icons(), (node) => String(node.library ?? "lucide")) ?? "")} onChange={(event) => set(icons(), () => ({ library: event.currentTarget.value }))}>
						<For each={ICON_LIBRARIES}>{(lib) => <option value={lib.id}>{lib.label}</option>}</For>
					</select>
				</div>
				<Show when={icons().length === 1}>
					<div class="props-row">
						<span class="props-label">Icon</span>
						<input class="field props-text" aria-label="Icon name" ref={(el) => held(el, () => String(icons()[0]?.icon ?? ""))} onChange={(event) => set(icons(), () => ({ icon: event.currentTarget.value.trim(), name: event.currentTarget.value.trim() }))} />
						<button type="button" class="btn props-btn" title="Pick another from the icons" onClick={() => setInsertPanel({ tab: "icons", replace: icons()[0]!.id })}>
							Pick…
						</button>
					</div>
				</Show>
				<div class="props-row">
					<span class="props-label">Weight</span>
					<input
						type="range"
						class="props-range"
						min="100"
						max="700"
						step="100"
						aria-label="Weight"
						value={Number(shared(icons(), (node) => numberOf(node.weight, 400)) === MIXED ? 400 : shared(icons(), (node) => numberOf(node.weight, 400)))}
						onChange={(event) => set(icons(), () => ({ weight: Number(event.currentTarget.value) }))}
					/>
				</div>
				<Swatches colors={LINES} value={shared(icons(), (node) => colorOf(node.fill))} onPick={(color) => setIconColor(color)} label="Icon colour" />
				<div class="props-row">
					<span class="props-label">Colour</span>
					<ColorField value={shared(icons(), (node) => colorOf(node.fill))} shown={shownOf(shared(icons(), (node) => colorOf(node.fill)))} onCommit={(color) => setIconColor(color)} onLive={live((color) => setIconColor(color, true))} label="Icon colour" />
				</div>
			</Section>
		</Show>
	);
}
