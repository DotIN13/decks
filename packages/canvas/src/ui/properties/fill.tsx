import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { type PenNode } from "@decks/pen";
import { For, Show } from "solid-js";
import { ColorField, NumField, Swatches } from "./fields.tsx";
import { type FillMode, type Kind, MIXED, TEXTY, colorOf, fillModeOf, gradientOf, numberOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import { SWATCHES } from "./palette.ts";
import type { SetFields } from "./writes.ts";

/** What `createFill` reads of the panel (`../Properties.tsx`). */
export interface FillNeeds {
	readonly fillTargets: Accessor<PenNode[]>;
	readonly set: SetFields;
	readonly writer: (live?: boolean) => SetFields;
	readonly has: (kind: Kind) => boolean;
	readonly shownOf: (value: string | typeof MIXED | undefined) => string | undefined;
	readonly live: (apply: (color: string) => void) => (color?: string) => void;
}

/** The Fill section: none, one colour or a gradient, for everything picked that has a fill. */
export function createFill(d: FillNeeds) {
	const fillMode = () => shared(d.fillTargets(), fillModeOf);

	const fillHex = () => shared(d.fillTargets(), (node) => colorOf(node.fill) ?? colorOf(gradientOf(node.fill)?.colors?.[0]?.color));

	const setFillMode = (mode: FillMode) =>
		d.set(d.fillTargets(), (node) => {
			const base = colorOf(node.fill) ?? colorOf(gradientOf(node.fill)?.colors?.[0]?.color) ?? "$decks-fill-slate";
			if (mode === "none") return { fill: null };
			if (mode === "solid") return { fill: base };
			const end = gradientOf(node.fill)?.colors?.[1]?.color ?? "#ffffff";
			return { fill: { type: "gradient", gradientType: mode, rotation: numberOf(gradientOf(node.fill)?.rotation, 90), colors: [{ color: base, position: 0 }, { color: end, position: 1 }] } };
		});

	const setFillColor = (color: string, stop = 0, drawOnly?: boolean) =>
		d.writer(drawOnly)(d.fillTargets(), (node) => {
			const gradient = gradientOf(node.fill);
			if (!gradient) return { fill: color };
			const colors = [...(gradient.colors ?? [{ color, position: 0 }, { color: "#ffffff", position: 1 }])];
			colors[stop] = { color, position: stop === 0 ? 0 : 1 };
			return { fill: { ...gradient, colors } };
		});

	const gradientEnd = () => shared(d.fillTargets(), (node) => colorOf(gradientOf(node.fill)?.colors?.[1]?.color));

	const gradientTurn = () => shared(d.fillTargets(), (node) => numberOf(gradientOf(node.fill)?.rotation, 90));

	const fillSection = () => (
		<Show when={d.fillTargets().length > 0}>
			<Section key="fill" title={d.has("note") && d.fillTargets().every((node) => TEXTY.has(node.type)) ? m.canvas_props_paper() : m.canvas_props_fill()}>
				<div class="seg-set" role="group" aria-label={m.canvas_props_fill()}>
					<For each={["none", "solid", "linear", "radial"] as const}>
						{(mode) => (
							<button type="button" data-on={fillMode() === mode ? "true" : undefined} aria-pressed={fillMode() === mode} onClick={() => setFillMode(mode)}>
								{mode === "none" ? m.canvas_props_fill_none() : mode === "solid" ? m.canvas_props_fill_solid() : mode === "linear" ? m.canvas_props_fill_linear() : m.canvas_props_fill_radial()}
							</button>
						)}
					</For>
				</div>
				<Show when={fillMode() !== "none"}>
					<Swatches colors={SWATCHES} value={fillHex()} onPick={(color) => setFillColor(color)} label={m.canvas_props_fill()} />
					<div class="props-row">
						<span class="props-label">{fillMode() === "linear" || fillMode() === "radial" ? m.canvas_props_from() : m.canvas_props_colour()}</span>
						<ColorField value={fillHex()} shown={d.shownOf(fillHex())} onCommit={(color) => setFillColor(color)} onLive={d.live((color) => setFillColor(color, 0, true))} label={m.canvas_props_fill_colour()} />
					</div>
					<Show when={fillMode() === "linear" || fillMode() === "radial"}>
						<div class="props-row">
							<span class="props-label">{m.canvas_props_to()}</span>
							<ColorField value={gradientEnd()} shown={d.shownOf(gradientEnd())} onCommit={(color) => setFillColor(color, 1)} onLive={d.live((color) => setFillColor(color, 1, true))} label={m.canvas_props_second_colour()} />
						</div>
						<Show when={fillMode() === "linear"}>
							<div class="props-row">
								<span class="props-label">{m.canvas_props_angle()}</span>
								<NumField label="°" value={gradientTurn()} onCommit={(v) => d.set(d.fillTargets(), (node) => ({ fill: { ...gradientOf(node.fill), rotation: Math.round(v) % 360 } }))} />
							</div>
						</Show>
					</Show>
				</Show>
			</Section>
		</Show>
	);

	return {
		fillSection,
	};
}
