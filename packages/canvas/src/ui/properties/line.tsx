import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { arrowStyle, isArrow, type PenNode } from "@decks/pen";
import { For, Show } from "solid-js";
import { ColorField, IconToggle, NumField, Swatches } from "./fields.tsx";
import { MIXED, legacyStroke, lineColorOf, lineWidthOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import { LINES } from "./palette.ts";
import type { SetFields } from "./writes.ts";

/** What `createLine` reads of the panel (`../Properties.tsx`). */
export interface LineNeeds {
	readonly lineTargets: Accessor<PenNode[]>;
	readonly writer: (live?: boolean) => SetFields;
	readonly set: SetFields;
	readonly shownOf: (value: string | typeof MIXED | undefined) => string | undefined;
	readonly live: (apply: (color: string) => void) => (color?: string) => void;
	readonly arrows: Accessor<PenNode[]>;
}

/** The Line section: a line's colour, width, dashes and where it sits on the edge. */
export function createLine(of: LineNeeds) {
	const lineColor = () => shared(of.lineTargets(), (node) => lineColorOf(node));

	const lineWidth = () => shared(of.lineTargets(), lineWidthOf);

	const setLineColor = (color: string, drawOnly?: boolean) =>
		of.writer(drawOnly)(of.lineTargets(), (node) => {
			const legacy = legacyStroke(node);
			return legacy ? { stroke: { ...legacy, fill: color } } : { stroke: color, ...(node.strokeWidth === undefined ? { strokeWidth: 1.5 } : {}) };
		});

	const setLineWidth = (width: number) =>
		of.set(of.lineTargets(), (node) => {
			const legacy = legacyStroke(node);
			if (legacy) return width === 0 ? { stroke: null } : { stroke: { ...legacy, thickness: width } };
			if (width <= 0) return isArrow(node) ? { strokeWidth: 1 } : { stroke: null, strokeWidth: null };
			return { strokeWidth: width, ...(node.stroke === undefined || node.stroke === null ? { stroke: "$decks-text" } : {}) };
		});

	const dashOf = (node: PenNode): "solid" | "dashed" | "dotted" => (isArrow(node) ? (arrowStyle(node.metadata).dash ? "dashed" : "solid") : node.strokeDash === "dashed" || node.strokeDash === "dotted" ? node.strokeDash : "solid");

	const lineDash = () => shared(of.lineTargets(), dashOf);

	const setDash = (dash: "solid" | "dashed" | "dotted") =>
		of.set(of.lineTargets(), (node) => (isArrow(node) ? { metadata: { ...(node.metadata ?? {}), dash: dash === "solid" ? undefined : true } } : { strokeDash: dash === "solid" ? null : dash }));

	const closedLines = () => of.lineTargets().filter((node) => !isArrow(node));

	const lineAlign = () => shared(closedLines(), (node) => node.strokeAlignment ?? (node.type === "path" ? "center" : "inner"));

	const lineSection = () => (
		<Show when={of.lineTargets().length > 0}>
			<Section key="line" title={m.canvas_props_line()}>
				<Swatches colors={LINES} value={lineColor()} onPick={setLineColor} label={m.canvas_props_line()} />
				<div class="props-row">
					<span class="props-label">{m.canvas_props_colour()}</span>
					<ColorField value={lineColor()} shown={of.shownOf(lineColor())} onCommit={setLineColor} onLive={of.live((color) => setLineColor(color, true))} label={m.canvas_props_line_colour()} />
				</div>
				<div class="props-row">
					<span class="props-label">{m.canvas_props_width()}</span>
					<NumField label="px" value={lineWidth()} min={0} step={0.5} onCommit={setLineWidth} />
					<div class="props-buttons" role="group" aria-label={m.canvas_props_dashes()}>
						<IconToggle attr={{ "data-dash": "solid" }} on={lineDash() === "solid"} title={m.canvas_props_dash_solid()} onClick={() => setDash("solid")}>
							<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h18" /></svg>
						</IconToggle>
						<IconToggle attr={{ "data-dash": "dashed" }} on={lineDash() === "dashed"} title={m.canvas_props_dash_dashed()} onClick={() => setDash("dashed")}>
							<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M3 12h4M10 12h4M17 12h4" /></svg>
						</IconToggle>
						<Show when={of.arrows().length === 0}>
							<IconToggle attr={{ "data-dash": "dotted" }} on={lineDash() === "dotted"} title={m.canvas_props_dash_dotted()} onClick={() => setDash("dotted")}>
								<svg viewBox="0 0 24 24" class="props-glyph" aria-hidden="true"><path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" /></svg>
							</IconToggle>
						</Show>
					</div>
				</div>
				<Show when={closedLines().length > 0}>
					<div class="seg-set" role="group" aria-label={m.canvas_props_line_align()}>
						<For each={[["inner", m.canvas_props_line_inside()], ["center", m.canvas_props_line_centre()], ["outer", m.canvas_props_line_outside()]] as const}>
							{([value, label]) => (
								<button type="button" data-on={lineAlign() === value ? "true" : undefined} aria-pressed={lineAlign() === value} onClick={() => of.set(closedLines(), () => ({ strokeAlignment: value }))}>
									{label}
								</button>
							)}
						</For>
					</div>
				</Show>
			</Section>
		</Show>
	);

	return {
		lineSection,
	};
}
