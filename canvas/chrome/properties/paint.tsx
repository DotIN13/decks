// The panel's sections for paint: the fill (or a note's paper) and the line.
import { For, Show } from "solid-js";
import { SWATCHES, LINES, TEXTY, gradientOf } from "./model.ts";
import { NumField, ColorField, Swatches, IconToggle, Section } from "./fields.tsx";
import type { PanelCtx } from "./state.ts";

/** None, a colour, or a gradient between two. */
export function FillSection(own: { ctx: PanelCtx }) {
	const { has, fillTargets, set, live, shownOf, fillMode, fillHex, setFillMode, setFillColor, gradientEnd, gradientTurn } = own.ctx;
	return (
		<Show when={fillTargets().length > 0}>
			<Section key="fill" title={has("note") && fillTargets().every((node) => TEXTY.has(node.type)) ? "Paper" : "Fill"}>
				<div class="seg-set" role="group" aria-label="Fill">
					<For each={["none", "solid", "linear", "radial"] as const}>
						{(mode) => (
							<button type="button" data-on={fillMode() === mode ? "true" : undefined} aria-pressed={fillMode() === mode} onClick={() => setFillMode(mode)}>
								{mode === "none" ? "None" : mode === "solid" ? "Solid" : mode === "linear" ? "Linear" : "Radial"}
							</button>
						)}
					</For>
				</div>
				<Show when={fillMode() !== "none"}>
					<Swatches colors={SWATCHES} value={fillHex()} onPick={(color) => setFillColor(color)} label="Fill" />
					<div class="props-row">
						<span class="props-label">{fillMode() === "linear" || fillMode() === "radial" ? "From" : "Colour"}</span>
						<ColorField value={fillHex()} shown={shownOf(fillHex())} onCommit={(color) => setFillColor(color)} onLive={live((color) => setFillColor(color, 0, true))} label="Fill colour" />
					</div>
					<Show when={fillMode() === "linear" || fillMode() === "radial"}>
						<div class="props-row">
							<span class="props-label">To</span>
							<ColorField value={gradientEnd()} shown={shownOf(gradientEnd())} onCommit={(color) => setFillColor(color, 1)} onLive={live((color) => setFillColor(color, 1, true))} label="Second colour" />
						</div>
						<Show when={fillMode() === "linear"}>
							<div class="props-row">
								<span class="props-label">Angle</span>
								<NumField label="°" value={gradientTurn()} onCommit={(v) => set(fillTargets(), (node) => ({ fill: { ...gradientOf(node.fill), rotation: Math.round(v) % 360 } }))} />
							</div>
						</Show>
					</Show>
				</Show>
			</Section>
		</Show>
	);
}

/** The line's colour, width, dashes and where it sits. */
export function LineSection(own: { ctx: PanelCtx }) {
	const { lineTargets, arrows, set, live, shownOf, lineColor, lineWidth, setLineColor, setLineWidth, lineDash, setDash, closedLines, lineAlign } = own.ctx;
	return (
		<Show when={lineTargets().length > 0}>
			<Section key="line" title="Line">
				<Swatches colors={LINES} value={lineColor()} onPick={setLineColor} label="Line" />
				<div class="props-row">
					<span class="props-label">Colour</span>
					<ColorField value={lineColor()} shown={shownOf(lineColor())} onCommit={setLineColor} onLive={live((color) => setLineColor(color, true))} label="Line colour" />
				</div>
				<div class="props-row">
					<span class="props-label">Width</span>
					<NumField label="px" value={lineWidth()} min={0} step={0.5} onCommit={setLineWidth} />
					<div class="props-buttons" role="group" aria-label="Dashes">
						<IconToggle attr={{ "data-dash": "solid" }} on={lineDash() === "solid"} title="Solid" onClick={() => setDash("solid")}>
							<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h18" /></svg>
						</IconToggle>
						<IconToggle attr={{ "data-dash": "dashed" }} on={lineDash() === "dashed"} title="Dashed" onClick={() => setDash("dashed")}>
							<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h4M10 12h4M17 12h4" /></svg>
						</IconToggle>
						<Show when={arrows().length === 0}>
							<IconToggle attr={{ "data-dash": "dotted" }} on={lineDash() === "dotted"} title="Dotted" onClick={() => setDash("dotted")}>
								<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" /></svg>
							</IconToggle>
						</Show>
					</div>
				</div>
				<Show when={closedLines().length > 0}>
					<div class="seg-set" role="group" aria-label="Where the line sits">
						<For each={[["inner", "Inside"], ["center", "Centre"], ["outer", "Outside"]] as const}>
							{([value, label]) => (
								<button type="button" data-on={lineAlign() === value ? "true" : undefined} aria-pressed={lineAlign() === value} onClick={() => set(closedLines(), () => ({ strokeAlignment: value }))}>
									{label}
								</button>
							)}
						</For>
					</div>
				</Show>
			</Section>
		</Show>
	);
}
