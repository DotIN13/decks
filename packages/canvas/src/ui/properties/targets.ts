import type { Accessor } from "solid-js";
import { isArrow, isShape, shapeLabel, shapeOutline, type PenNode } from "@decks/pen";
import { createMemo } from "solid-js";
import { penSelection } from "../../edit/pen-tools.ts";
import { type Kind, kindOf } from "./values.ts";

/** What `createTargets` reads of the panel (`../Properties.tsx`). */
export interface TargetsNeeds {
	readonly index: Accessor<Map<any, any>>;
}

/** What is picked, and what of it a fill, a line, words or an effect is set on. */
export function createTargets(d: TargetsNeeds) {
	const selected = createMemo(() => penSelection().flatMap((id) => {
		const found = d.index().get(id);
		return found ? [found.node as PenNode] : [];
	}));

	const single = () => (selected().length === 1 ? selected()[0] : undefined);

	const kinds = createMemo(() => new Set(selected().map(kindOf)));

	const has = (kind: Kind) => kinds().has(kind);

	/** What a fill, a line, words or an effect is set on: a shape's outline and words, or the item itself. */
	const fillTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return ["rectangle", "ellipse", "polygon", "frame", "path", "note"].includes(kind) ? [node] : [];
		}),
	);

	const lineTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return ["rectangle", "ellipse", "polygon", "frame", "path", "arrow"].includes(kind) ? [node] : [];
		}),
	);

	const wordTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeLabel(node) ? [shapeLabel(node)!] : [];
			return kind === "text" || kind === "note" ? [node] : [];
		}),
	);

	const effectTargets = createMemo(() =>
		selected().flatMap((node) => {
			const kind = kindOf(node);
			if (kind === "shape") return shapeOutline(node) ? [shapeOutline(node)!] : [];
			return kind === "group" || kind === "arrow" ? [] : [node];
		}),
	);

	const arrows = createMemo(() => selected().filter(isArrow));

	const icons = createMemo(() => selected().filter((node) => kindOf(node) === "icon"));

	const shapes = createMemo(() => selected().filter(isShape));

	return {
		wordTargets,
		shapes,
		selected,
		icons,
		fillTargets,
		has,
		lineTargets,
		arrows,
		single,
		effectTargets,
	};
}
