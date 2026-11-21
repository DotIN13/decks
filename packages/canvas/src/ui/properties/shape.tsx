import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { shapeName } from "../shape-names.ts";
import { isShape, SHAPES, shapeKind, shapeLabel, shapeOutline, type PenNode } from "@decks/pen";
import { For, Show } from "solid-js";
import { held } from "./fields.tsx";
import { MIXED, shared } from "./values.ts";
import { Section } from "./section.tsx";

/** What `createShapeSection` reads of the panel (`../Properties.tsx`). */
export interface ShapeSectionNeeds {
	readonly shapes: Accessor<PenNode[]>;
	readonly edit: (ops: unknown[]) => void;
	readonly single: () => PenNode | undefined;
	readonly setShapeWords: (shape: PenNode, content: string) => void;
}

/** The Shape section: which library shape it is, and the words in it. */
export function createShapeSection(d: ShapeSectionNeeds) {
	const shapeSection = () => (
		<Show when={d.shapes().length > 0}>
			<Section key="shape" title={m.canvas_props_shape()}>
				<div class="props-row">
					<span class="props-label">{m.canvas_props_shape_kind()}</span>
					<select
						class="props-select"
						aria-label={m.canvas_props_shape_kind_label()}
						value={String(shared(d.shapes(), (node) => String(node.metadata?.kind ?? "")) ?? "")}
						onChange={(event) => {
							const kind = shapeKind(event.currentTarget.value);
							if (!kind) return;
							d.edit(
								d.shapes().flatMap((node) => {
									const outline = shapeOutline(node);
									const renamed = !node.name || node.name === node.metadata?.kind;
									return [
										{ op: "update", id: node.id, set: { metadata: { ...(node.metadata ?? {}), kind: kind.name }, ...(renamed ? { name: kind.name } : {}) } },
										...(outline ? [{ op: "update", id: outline.id, set: { geometry: kind.geometry, fillRule: kind.fillRule ?? null, ...(kind.line ? { fill: null } : outline.fill === undefined ? { fill: "$decks-surface" } : {}) } }] : []),
									];
								}),
							);
						}}
					>
						<Show when={shared(d.shapes(), (node) => node.metadata?.kind) === MIXED}>
							<option value={MIXED}>{m.canvas_props_mixed()}</option>
						</Show>
						<For each={SHAPES}>{(kind) => <option value={kind.name}>{shapeName(kind.name)}</option>}</For>
					</select>
				</div>
				<Show when={d.single() && isShape(d.single())}>
					<div class="props-row">
						<span class="props-label">{m.canvas_props_words()}</span>
						<input
							class="field props-text"
							placeholder={m.canvas_props_shape_words_hint()}
							ref={(el) => held(el, () => String(shapeLabel(d.single()!)?.content ?? ""))}
							onChange={(event) => d.setShapeWords(d.single()!, event.currentTarget.value)}
						/>
					</div>
				</Show>
			</Section>
		</Show>
	);

	return {
		shapeSection,
	};
}
