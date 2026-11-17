import type { Accessor } from "solid-js";
import { isShape, type PenNode } from "@decks/pen";
import { Show } from "solid-js";
import { NumField } from "./fields.tsx";
import { numberOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import type { SetFields } from "./writes.ts";

/** What `createCorners` reads of the panel (`../Properties.tsx`). */
export interface CornersNeeds {
	readonly selected: Accessor<PenNode[]>;
	readonly set: SetFields;
}

/** The Corners section: a box's corner radius, and a polygon's sides. */
export function createCorners(d: CornersNeeds) {
	const cornersSection = () => (
		<Show when={d.selected().some((node) => (node.type === "rectangle" || node.type === "frame" || node.type === "polygon") && !isShape(node))}>
			<Section key="corners" title={d.selected().some((node) => node.type === "polygon") ? "Sides and corners" : "Corners"}>
				<div class="props-row">
					<Show when={d.selected().some((node) => node.type === "polygon")}>
						<NumField label="sides" value={shared(d.selected().filter((node) => node.type === "polygon"), (node) => numberOf(node.polygonCount, 3))} min={3} onCommit={(v) => d.set(d.selected().filter((node) => node.type === "polygon"), () => ({ polygonCount: Math.max(3, Math.round(v)) }))} />
					</Show>
					<NumField
						label="radius"
						value={shared(d.selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), (node) => numberOf(node.cornerRadius, 0))}
						min={0}
						onCommit={(v) => d.set(d.selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), () => ({ cornerRadius: v <= 0 ? null : v }))}
					/>
				</div>
			</Section>
		</Show>
	);

	return {
		cornersSection,
	};
}
