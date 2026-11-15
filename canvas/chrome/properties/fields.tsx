// The properties panel's controls: shadow and blur, a number field, a colour field, swatches and a toggle.
import { decksColorOf, type PenNode } from "@decks/pen";
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { adaptiveTitle, sameColor, swatchPaint } from "../adaptive.ts";
import { ColorPicker } from "../ColorPicker.tsx";
import { MIXED, hexOf, numberOf } from "./model.ts";

/** Shadow and blur: pen's `effect`, a drop shadow and a layer blur. */
export function Effects(props: {
	targets: readonly PenNode[];
	set: (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => void;
	/** The same change, drawn and not saved: the shadow's colour while it is being dragged. */
	show: (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => void;
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
				<span class="props-label">Shadow</span>
				<input type="checkbox" class="props-check" aria-label="Shadow" checked={!!shadow()} onChange={(event) => setShadow(event.currentTarget.checked ? {} : null)} />
			</div>
			<Show when={shadow()}>
				{(s) => (
					<>
						<div class="props-nums">
							<NumField label="x" value={numberOf(s().offset?.x, 0)} onCommit={(v) => setShadow({ offset: { x: v, y: numberOf(s().offset?.y, 4) } })} />
							<NumField label="y" value={numberOf(s().offset?.y, 4)} onCommit={(v) => setShadow({ offset: { x: numberOf(s().offset?.x, 0), y: v } })} />
							<NumField label="blur" value={numberOf(s().blur, 12)} min={0} onCommit={(v) => setShadow({ blur: Math.max(0, v) })} />
							<NumField label="sprd" value={numberOf(s().spread, 0)} onCommit={(v) => setShadow({ spread: v })} />
						</div>
						<div class="props-row">
							<span class="props-label">Colour</span>
							<ColorField value={hexOf(s().color)} adaptive={false} onCommit={(color) => setShadow({ color: shadowColor(color) })} onLive={props.onLive((color) => setShadow({ color: shadowColor(color) }, true))} label="Shadow colour" />
						</div>
					</>
				)}
			</Show>
			<div class="props-row">
				<span class="props-label">Blur</span>
				<input type="range" class="props-range" min="0" max="24" step="1" aria-label="Blur" value={blurOf(first())} onChange={(event) => props.set(props.targets, (node) => write(node, { blur: Number(event.currentTarget.value) }))} />
			</div>
		</>
	);
}

/**
 * A field's value from the drawing, except while it has the focus: a redraw that arrives while
 * something is being typed (the answer to another edit, or an agent's) would otherwise put the old
 * value back over what was typed before Enter.
 */
export function held(el: HTMLInputElement, value: () => string): void {
	createEffect(() => {
		const next = value();
		if (document.activeElement !== el) el.value = next;
	});
}

/** A number, typed or stepped with the arrow keys (Shift for ten), sent on Enter or on leaving the field. */
export function NumField(props: { label: string; value: number | typeof MIXED | undefined; onCommit: (value: number) => void; min?: number; max?: number; step?: number; placeholder?: string; title?: string; field?: string }) {
	const shown = () => (props.value === MIXED || props.value === undefined ? "" : String(Math.round(props.value * 100) / 100));
	const commit = (el: HTMLInputElement) => {
		const text = el.value.trim();
		if (text === "" || text === shown()) return;
		let value = Number(text);
		if (!Number.isFinite(value)) return void (el.value = shown());
		if (props.min !== undefined) value = Math.max(props.min, value);
		if (props.max !== undefined) value = Math.min(props.max, value);
		props.onCommit(value);
	};
	/*
	 * The wheel over a field steps it, as the arrow keys do: up for more, Shift for ten at a time. A
	 * trackpad sends many small turns, so they are added up and a step is taken for every 50 pixels,
	 * one at most per event; what a burst of turns comes to is sent once it stops.
	 */
	let turned = 0;
	let settle: ReturnType<typeof setTimeout> | undefined;
	const wheel = (event: WheelEvent) => {
		event.preventDefault();
		const el = event.currentTarget as HTMLInputElement;
		turned += event.deltaMode === 0 ? event.deltaY : event.deltaY * 50;
		if (Math.abs(turned) < 50) return;
		const up = turned < 0;
		turned = 0;
		const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1);
		let next = Math.round((Number(el.value || 0) + (up ? step : -step)) * 100) / 100;
		if (props.min !== undefined) next = Math.max(props.min, next);
		if (props.max !== undefined) next = Math.min(props.max, next);
		el.value = String(next);
		clearTimeout(settle);
		settle = setTimeout(() => commit(el), 250);
	};
	onCleanup(() => clearTimeout(settle));
	return (
		<label class="field props-num" title={props.title} data-field={props.field}>
			<b>{props.label}</b>
			<input
				inputmode="decimal"
				ref={(el) => held(el, shown)}
				placeholder={props.value === MIXED ? "Mixed" : (props.placeholder ?? "")}
				on:keydown={(event: KeyboardEvent) => {
					event.stopPropagation();
					const el = event.currentTarget as HTMLInputElement;
					if (event.key === "Enter") return commit(el);
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1);
					const now = Number(el.value || 0);
					el.value = String(Math.round((now + (event.key === "ArrowUp" ? step : -step)) * 100) / 100);
					commit(el);
				}}
				onBlur={(event) => commit(event.currentTarget)}
				on:wheel={wheel}
			/>
		</label>
	);
}

/**
 * A colour: a hex typed, or picked in the colour picker that its swatch opens (`ColorPicker.tsx`),
 * or one of the drawing's variables (`$decks-text`), picked there or typed, shown by its name.
 */
export function ColorField(props: {
	value: string | typeof MIXED | undefined;
	/** What a variable comes to now, for the swatch and the picker. */
	shown?: string | undefined;
	/** Whether the picker offers the adaptive colours: not for a shadow, whose colour carries its own alpha. */
	adaptive?: boolean;
	onCommit: (color: string) => void;
	/** Every step of a drag in the picker, drawn and not saved; nothing puts the drawing back (`ColorPicker`). */
	onLive?: (color?: string) => void;
	label: string;
}) {
	const hex = () => (props.value && props.value !== MIXED ? props.value : "");
	/** What the field reads: a Decks colour by its name now, a stored old one (`"$decks-ink"`) as its new one. */
	const asNamed = () => (decksColorOf(hex()) ? `$${decksColorOf(hex())}` : hex());
	const [picking, setPicking] = createSignal(false);
	let swatch: HTMLButtonElement | undefined;
	const commit = (text: string) => {
		const named = text.trim();
		if (props.adaptive !== false && named.startsWith("$")) {
			if (decksColorOf(named) && !sameColor(named, hex())) props.onCommit(named);
			return;
		}
		const clean = named.replace(/^#?/, "#").toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(clean) && clean !== hex()) props.onCommit(clean);
		else if (/^#[0-9a-f]{3}$/.test(clean)) props.onCommit(`#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`);
	};
	return (
		<span class="props-color">
			<button
				ref={swatch}
				type="button"
				class="props-swatch props-picker"
				data-on={picking() ? "true" : undefined}
				aria-haspopup="dialog"
				aria-expanded={picking()}
				title={`Pick any ${props.label.toLowerCase()}`}
				aria-label={`Pick any ${props.label.toLowerCase()}`}
				style={{ "--swatch": props.shown ?? (hex().startsWith("$") ? "transparent" : hex() || "transparent") }}
				onClick={() => setPicking(!picking())}
			/>
			<Show when={picking() && swatch}>
				<ColorPicker value={hex() || undefined} shown={props.shown} adaptive={props.adaptive !== false} anchor={swatch!} label={props.label} onCommit={props.onCommit} {...(props.onLive ? { onLive: props.onLive } : {})} onClose={() => setPicking(false)} />
			</Show>
			<label class="field props-num props-hex">
				<input
					aria-label={props.label}
					ref={(el) => held(el, asNamed)}
					placeholder={props.value === MIXED ? "Mixed" : "#"}
					on:keydown={(event: KeyboardEvent) => {
						event.stopPropagation();
						if (event.key === "Enter") commit((event.currentTarget as HTMLInputElement).value);
					}}
					onBlur={(event) => commit(event.currentTarget.value)}
				/>
			</label>
		</span>
	);
}

export function Swatches(props: { colors: readonly string[]; value: string | typeof MIXED | undefined; onPick: (color: string) => void; label: string }) {
	return (
		<div class="props-swatches" role="group" aria-label={props.label}>
			<For each={props.colors}>
				{(color) => (
					<button
						type="button"
						class="props-swatch"
						style={{ "--swatch": swatchPaint(color) }}
						data-adaptive={decksColorOf(color)}
						data-on={sameColor(props.value, color) ? "true" : undefined}
						aria-pressed={sameColor(props.value, color)}
						title={`${props.label} ${decksColorOf(color) ? adaptiveTitle(decksColorOf(color)!) : color}`}
						aria-label={`${props.label} ${decksColorOf(color) ? adaptiveTitle(decksColorOf(color)!) : color}`}
						onClick={() => props.onPick(color)}
					/>
				)}
			</For>
		</div>
	);
}

export function IconToggle(props: { on?: boolean; title: string; danger?: boolean; attr?: Record<string, string>; onClick: () => void; children: JSX.Element }) {
	return (
		<button {...(props.attr ?? {})} type="button" class="icon-button" data-on={props.on ? "soft" : undefined} data-danger={props.danger ? "true" : undefined} aria-pressed={props.on === undefined ? undefined : props.on} title={props.title} aria-label={props.title} onClick={() => props.onClick()}>
			{props.children}
		</button>
	);
}
