import type { Accessor } from "solid-js";
import { type PenNode } from "@decks/pen";
import { For, Show } from "solid-js";
import { setInsertPanel } from "../../edit/pen-tools.ts";
import { ICON_LIBRARIES } from "../../look/icon-index.ts";
import { ColorField, Swatches, held } from "./fields.tsx";
import { MIXED, colorOf, numberOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import { LINES } from "./palette.ts";
import type { SetFields } from "./writes.ts";

/** What `createIconSection` reads of the panel (`../Properties.tsx`). */
export interface IconSectionNeeds {
	readonly writer: (live?: boolean) => SetFields;
	readonly icons: Accessor<PenNode[]>;
	readonly set: SetFields;
	readonly shownOf: (value: string | typeof MIXED | undefined) => string | undefined;
	readonly live: (apply: (color: string) => void) => (color?: string) => void;
}

/** The Icon section: its library, its name, its weight and its colour. */
export function createIconSection(d: IconSectionNeeds) {
	const setIconColor = (color: string, drawOnly?: boolean) => d.writer(drawOnly)(d.icons(), () => ({ fill: color }));

	const iconSection = () => (
		<Show when={d.icons().length > 0}>
			<Section key="icon" title="Icon">
				<div class="props-row">
					<span class="props-label">Library</span>
					<select class="props-select" aria-label="Library" value={String(shared(d.icons(), (node) => String(node.library ?? "lucide")) ?? "")} onChange={(event) => d.set(d.icons(), () => ({ library: event.currentTarget.value }))}>
						<For each={ICON_LIBRARIES}>{(lib) => <option value={lib.id}>{lib.label}</option>}</For>
					</select>
				</div>
				<Show when={d.icons().length === 1}>
					<div class="props-row">
						<span class="props-label">Icon</span>
						<input class="field props-text" aria-label="Icon name" ref={(el) => held(el, () => String(d.icons()[0]?.icon ?? ""))} onChange={(event) => d.set(d.icons(), () => ({ icon: event.currentTarget.value.trim(), name: event.currentTarget.value.trim() }))} />
						<button type="button" class="btn props-btn" title="Pick another from the icons" onClick={() => setInsertPanel({ tab: "icons", replace: d.icons()[0]!.id })}>
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
						value={Number(shared(d.icons(), (node) => numberOf(node.weight, 400)) === MIXED ? 400 : shared(d.icons(), (node) => numberOf(node.weight, 400)))}
						onChange={(event) => d.set(d.icons(), () => ({ weight: Number(event.currentTarget.value) }))}
					/>
				</div>
				<Swatches colors={LINES} value={shared(d.icons(), (node) => colorOf(node.fill))} onPick={(color) => setIconColor(color)} label="Icon colour" />
				<div class="props-row">
					<span class="props-label">Colour</span>
					<ColorField value={shared(d.icons(), (node) => colorOf(node.fill))} shown={d.shownOf(shared(d.icons(), (node) => colorOf(node.fill)))} onCommit={(color) => setIconColor(color)} onLive={d.live((color) => setIconColor(color, true))} label="Icon colour" />
				</div>
			</Section>
		</Show>
	);

	return {
		iconSection,
	};
}
