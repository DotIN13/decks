import { isArrow, isCard, isMarkdown, type PenNode } from "@decks/pen";
import FlipHorizontal2 from "lucide-solid/icons/flip-horizontal-2";
import FlipVertical2 from "lucide-solid/icons/flip-vertical-2";
import Lock from "lucide-solid/icons/lock";
import LockOpen from "lucide-solid/icons/lock-open";
import { createSignal, Show } from "solid-js";
import { penBoxes } from "../../edit/pen-tools.ts";
import { Icon } from "@decks/ui";
import { IconToggle, NumField } from "./fields.tsx";
import { numberOf } from "./values.ts";
import { Section } from "./section.tsx";
import type { SetFields } from "./writes.ts";

/** What `createPosition` reads of the panel (`../Properties.tsx`). */
export interface PositionNeeds {
	readonly single: () => PenNode | undefined;
	readonly edit: (ops: unknown[]) => void;
	readonly set: SetFields;
}

/** The Position and size section, for one item. */
export function createPosition(d: PositionNeeds) {
	const [keepRatio, setKeepRatio] = createSignal(false);

	const box = () => {
		const node = d.single();
		return node ? penBoxes().get(node.id) : undefined;
	};

	const setBox = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
		const node = d.single();
		const was = box();
		if (!node || !was) return;
		let { x, y, w, h } = { ...was, ...patch };
		if (keepRatio() && was.w > 0 && was.h > 0) {
			if (patch.w !== undefined && patch.h === undefined) h = Math.round((patch.w * was.h) / was.w);
			if (patch.h !== undefined && patch.w === undefined) w = Math.round((patch.h * was.w) / was.h);
		}
		w = Math.max(1, w);
		h = Math.max(1, h);
		// Words that grow with what they say are given their width only; their height is their words'.
		const sized = node.type === "text" && (node.textGrowth ?? "auto") !== "fixed-width-height" ? { x1: x, y1: y, x2: x + w } : { x1: x, y1: y, x2: x + w, y2: y + h };
		d.edit([{ op: "update", id: node.id, box: sized }]);
	};

	const placeSection = () => (
		<Show when={d.single() && !isArrow(d.single()!) && box()}>
			<Section key="place" title="Position and size">
				{/*
				 * A markdown card starts as tall as its words and stays that way until a top or
				 * bottom handle pins a height on it. This is the way back: the same two words the
				 * frame's own height uses, so one control means one thing across the panel.
				 */}
				<Show when={isMarkdown(d.single()!) || isCard(d.single()!)}>
					<span class="props-prop">height</span>
					<div class="seg-set" role="group" aria-label="height">
						<button type="button" data-on={typeof d.single()!.height !== "number" ? "true" : undefined} aria-pressed={typeof d.single()!.height !== "number"} onClick={() => d.set([d.single()!], () => ({ height: null }))}>fit-content</button>
						<button type="button" data-on={typeof d.single()!.height === "number" ? "true" : undefined} aria-pressed={typeof d.single()!.height === "number"} onClick={() => d.set([d.single()!], () => ({ height: Math.max(1, Math.round(box()!.h)) }))}>px</button>
					</div>
				</Show>
				<div class="props-nums">
					<NumField field="x" label="x" value={box()!.x} onCommit={(v) => setBox({ x: Math.round(v) })} />
					<NumField field="y" label="y" value={box()!.y} onCommit={(v) => setBox({ y: Math.round(v) })} />
					<NumField field="w" label="w" value={box()!.w} min={1} onCommit={(v) => setBox({ w: Math.round(v) })} />
					<NumField field="h" label="h" value={box()!.h} min={1} onCommit={(v) => setBox({ h: Math.round(v) })} />
				</div>
				<div class="props-row">
					<NumField label="°" value={numberOf(d.single()!.rotation, 0)} onCommit={(v) => d.set([d.single()!], () => ({ rotation: Math.round(v) % 360 === 0 ? null : Math.round(v) % 360 }))} title="Turn, in degrees" />
					<NumField label="%" value={Math.round(numberOf(d.single()!.opacity, 1) * 100)} min={0} max={100} onCommit={(v) => d.set([d.single()!], () => ({ opacity: v >= 100 ? null : Math.max(0, v) / 100 }))} title="Opacity" />
					<div class="props-buttons">
						<IconToggle on={keepRatio()} title={keepRatio() ? "Keeping the proportions" : "Keep the proportions"} onClick={() => setKeepRatio(!keepRatio())}>
							<Icon of={keepRatio() ? Lock : LockOpen} size={14} />
						</IconToggle>
						<IconToggle on={d.single()!.flipX === true} title="Flip across" onClick={() => d.set([d.single()!], (node) => ({ flipX: node.flipX === true ? null : true }))}>
							<Icon of={FlipHorizontal2} size={14} />
						</IconToggle>
						<IconToggle on={d.single()!.flipY === true} title="Flip up and down" onClick={() => d.set([d.single()!], (node) => ({ flipY: node.flipY === true ? null : true }))}>
							<Icon of={FlipVertical2} size={14} />
						</IconToggle>
					</div>
				</div>
			</Section>
		</Show>
	);

	return {
		placeSection,
	};
}
