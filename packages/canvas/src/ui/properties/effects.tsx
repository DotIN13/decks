import { type PenNode } from "@decks/pen";
import { m } from "@decks/i18n";
import { Show } from "solid-js";
import { ColorField, NumField } from "./fields.tsx";
import { hexOf, numberOf } from "./values.ts";
import type { SetFields } from "./writes.ts";

/** Shadow and blur: pen's `effect`, a drop shadow and a layer blur. */
export function Effects(props: {
	targets: readonly PenNode[];
	set: SetFields;
	/** The same change, drawn and not saved: the shadow's colour while it is being dragged. */
	show: SetFields;
	onLive: (apply: (color: string) => void) => (color?: string) => void;
}) {
	type Shadow = { type: "shadow"; shadowType?: string; offset?: { x: number; y: number }; blur?: number; spread?: number; color?: string };
	const effects = (node: PenNode) => (node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect]) as Array<Record<string, unknown>>;
	const shadowOf = (node: PenNode) => effects(node).find((effect) => effect.type === "shadow") as Shadow | undefined;
	const blurOf = (node: PenNode) => numberOf(effects(node).find((effect) => effect.type === "blur")?.radius, 0);
	const first = () => props.targets[0]!;
	const shadow = () => shadowOf(first());
	const write = (node: PenNode, next: { shadow?: Shadow | null; blur?: number }) => {
		const kept = effects(node).filter((effect) => effect.type !== "shadow" && effect.type !== "blur");
		const s = next.shadow === undefined ? shadowOf(node) : next.shadow ?? undefined;
		const b = next.blur === undefined ? blurOf(node) : next.blur;
		const all = [...kept, ...(s ? [s] : []), ...(b > 0 ? [{ type: "blur", radius: b }] : [])];
		return { effect: all.length === 0 ? null : all.length === 1 ? all[0] : all };
	};
	const setShadow = (patch: Partial<Shadow> | null, drawOnly?: boolean) =>
		(drawOnly ? props.show : props.set)(props.targets, (node) => write(node, { shadow: patch === null ? null : { type: "shadow", shadowType: "outer", offset: { x: 0, y: 4 }, blur: 12, spread: 0, color: "#00000033", ...(shadowOf(node) ?? {}), ...patch } }));
	/** A shadow colour keeps the alpha it already had, written as the last two digits of the hex. */
	const shadowColor = (color: string) => `${color}${(shadow()?.color ?? "#00000033").slice(7) || "33"}`;
	return (
		<>
			<div class="props-row">
				<span class="props-label">{m.canvas_props_shadow()}</span>
				<input type="checkbox" class="props-check" aria-label={m.canvas_props_shadow()} checked={!!shadow()} onChange={(event) => setShadow(event.currentTarget.checked ? {} : null)} />
			</div>
			<Show when={shadow()}>
				{(s) => (
					<>
						<div class="props-nums">
							<NumField label="x" value={numberOf(s().offset?.x, 0)} onCommit={(v) => setShadow({ offset: { x: v, y: numberOf(s().offset?.y, 4) } })} />
							<NumField label="y" value={numberOf(s().offset?.y, 4)} onCommit={(v) => setShadow({ offset: { x: numberOf(s().offset?.x, 0), y: v } })} />
							<NumField label={m.canvas_props_blur_short()} value={numberOf(s().blur, 12)} min={0} onCommit={(v) => setShadow({ blur: Math.max(0, v) })} />
							<NumField label={m.canvas_props_spread_short()} value={numberOf(s().spread, 0)} onCommit={(v) => setShadow({ spread: v })} />
						</div>
						<div class="props-row">
							<span class="props-label">{m.canvas_props_colour()}</span>
							<ColorField value={hexOf(s().color)} adaptive={false} onCommit={(color) => setShadow({ color: shadowColor(color) })} onLive={props.onLive((color) => setShadow({ color: shadowColor(color) }, true))} label={m.canvas_props_shadow_colour()} />
						</div>
					</>
				)}
			</Show>
			<div class="props-row">
				<span class="props-label">{m.canvas_props_blur()}</span>
				<input type="range" class="props-range" min="0" max="24" step="1" aria-label={m.canvas_props_blur()} value={blurOf(first())} onChange={(event) => props.set(props.targets, (node) => write(node, { blur: Number(event.currentTarget.value) }))} />
			</div>
		</>
	);
}
