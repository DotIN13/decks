import { DECKS_COLORS, decksColorOf } from "@decks/pen";
import { ADAPTIVE, adaptiveTitle, swatchPaint } from "./adaptive.ts";
import Pipette from "lucide-solid/icons/pipette";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { onDismiss, portalLayer } from "@decks/ui";
import { Icon } from "@decks/ui";
import { scheme } from "../theme.ts";

// The properties panel's colour picker: shade and hue, hex, a dropper, the adaptive colours
// and the panel's swatches, opened under the swatch that asked for it.

type Hsv = { h: number; s: number; v: number };

/**
 * A colour picker for the properties panel: a square of shade and brightness, a strip of hues, the
 * colour as hex, a dropper where the browser has one, the adaptive colours, and the panel's own swatches.
 *
 * The adaptive colours are the drawing's own light/dark variables (`@decks/pen` `DECKS_COLORS`): a
 * pick writes `"$decks-text"`, which the drawing's edit defines when it lacks it, and the colour
 * follows the canvas between light and dark. Anything picked in the square, the strip, the hex or
 * the dropper is that colour, written as hex, and stays it in both.
 *
 * The browser's own picker (`<input type="color">`) is a different window on every system and is
 * not where the rest of the panel is. This one opens under the swatch that asked for it, in the
 * page (`Portal`, so the panel's scrolling does not clip it), and keeps to the screen.
 *
 * A drag in the square or the strip draws the colour on the stage at every step (`onLive`) and saves
 * it when the pointer is let go, so the item changes under the pointer and the drawing still takes
 * one edit and not sixty.
 */
export function ColorPicker(props: {
	/** The field's colour: a hex, or a variable (`"$decks-text"`). */
	value: string | undefined;
	/** What a variable comes to on the canvas now, for the square and the hex; a hex is itself. */
	shown?: string | undefined;
	/** Whether the adaptive colours are offered (not for a shadow, whose colour carries its own alpha). */
	adaptive?: boolean;
	anchor: HTMLElement;
	label: string;
	onCommit: (hex: string) => void;
	/** The colour under the pointer, drawn and not saved; nothing means the drawing as it is saved. */
	onLive?: (hex?: string) => void;
	onClose: () => void;
}) {
	const decksNow = (value: string | undefined) => DECKS_COLORS[decksColorOf(value) ?? ""]?.[scheme()];
	const [hsv, setHsv] = createSignal<Hsv>(hexToHsv(props.shown ?? decksNow(props.value) ?? props.value ?? "#ffffff"));
	/** The field holds a variable: no swatch of a fixed colour is its colour, whatever it comes to now. */
	const variable = () => props.value?.startsWith("$") === true;
	const hex = () => hsvToHex(hsv());
	const [place, setPlace] = createSignal({ left: 0, top: 0 });
	let card: HTMLDivElement | undefined;
	let field: HTMLInputElement | undefined;

	keepPickerPlaced(props, () => card, setPlace);
	const dragOver = (event: PointerEvent, el: HTMLElement, move: (fx: number, fy: number) => void) => dragAcross(event, el, move, () => props.onLive?.(hex()), () => commit());
	const commit = (value = hex()) => {
		if (value !== props.value) props.onCommit(value);
		// Let go on the colour it already was: nothing is saved, so the live one has to be dropped here.
		else props.onLive?.();
	};
	const fromScreen = () => void pickFromScreen((picked) => {
		setHsv(hexToHsv(picked));
		commit(picked.toLowerCase());
	});

	return (
		<Portal mount={portalLayer()}>
			<div ref={card} class="panel-float color-picker" role="dialog" aria-label={`${props.label}: pick a colour`} style={{ left: `${place().left}px`, top: `${place().top}px` }}>
				<ShadeAndHue hsv={hsv()} hex={hex()} setHsv={setHsv} dragOver={dragOver} />
				<div class="color-row">
					<span class="color-now" style={{ background: hex() }} aria-hidden="true" />
					<label class="field color-hex">
						<span class="text-faint">#</span>
						<input
							ref={field}
							aria-label={`${props.label}, as hex`}
							value={hex().slice(1)}
							spellcheck={false}
							on:keydown={(event: KeyboardEvent) => hexTyped(event, (full) => {
								setHsv(hexToHsv(full));
								commit(full);
							})}
						/>
					</label>
					<Show when={dropper}>
						<button type="button" class="icon-button" title="Pick a colour from the screen" aria-label="Pick a colour from the screen" onClick={fromScreen}>
							<Icon of={Pipette} size={14} />
						</button>
					</Show>
				</div>
				<Show when={props.adaptive !== false}>
				<AdaptiveSwatches value={props.value} onPick={(name) => {
					setHsv(hexToHsv(DECKS_COLORS[name]![scheme()]));
					if (props.value !== `$${name}`) props.onCommit(`$${name}`);
				}} />
				</Show>
				<PaletteSwatches picked={variable() ? undefined : hex()} onPick={(color) => {
					setHsv(hexToHsv(color));
					commit(color);
				}} />
			</div>
		</Portal>
	);
}

/** Keep the picker beside its field, on screen, and close it on a press away, Escape or a dismiss. */
function keepPickerPlaced(props: { anchor: HTMLElement; onClose: () => void }, cardOf: () => HTMLDivElement | undefined, setPlace: (at: { left: number; top: number }) => void): void {
	const position = () => {
		const at = props.anchor.getBoundingClientRect();
		const width = 232;
		const height = cardOf()?.offsetHeight ?? 300;
		const left = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
		const below = at.bottom + 6;
		const top = below + height > window.innerHeight - 8 ? Math.max(8, at.top - height - 6) : below;
		setPlace({ left, top });
	};
	onMount(() => {
		position();
		requestAnimationFrame(position);
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (cardOf()?.contains(target) || props.anchor.contains(target)) return;
			props.onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				props.onClose();
			}
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key, true);
		window.addEventListener("resize", position);
		const stopDismiss = onDismiss(() => props.onClose());
		onCleanup(() => {
			stopDismiss();
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key, true);
			window.removeEventListener("resize", position);
		});
	});
}

/** A drag across an element, as fractions of it: drawn at every step (`live`), saved on release (`done`). */
function dragAcross(event: PointerEvent, el: HTMLElement, move: (fx: number, fy: number) => void, live: () => void, done: () => void): void {
	event.preventDefault();
	el.setPointerCapture(event.pointerId);
	const at = (e: PointerEvent) => {
		const r = el.getBoundingClientRect();
		move(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
		live();
	};
	at(event);
	const moved = (e: PointerEvent) => at(e);
	const up = () => {
		el.removeEventListener("pointermove", moved);
		el.removeEventListener("pointerup", up);
		el.removeEventListener("pointercancel", up);
		done();
	};
	el.addEventListener("pointermove", moved);
	el.addEventListener("pointerup", up);
	el.addEventListener("pointercancel", up);
}
// The square of shade and the strip of hues.
/** The shade-and-brightness square and the hue strip, each dragged across. */
function ShadeAndHue(props: { hsv: Hsv; hex: string; setHsv: (next: Hsv) => void; dragOver: (event: PointerEvent, el: HTMLElement, move: (fx: number, fy: number) => void) => void }) {
	return (
		<>
			<div
				class="color-sv"
				style={{ "--hue": `hsl(${props.hsv.h} 100% 50%)` }}
				onPointerDown={(event) => props.dragOver(event, event.currentTarget, (fx, fy) => props.setHsv({ ...props.hsv, s: fx, v: 1 - fy }))}
				aria-label="Shade and brightness"
			>
				<span class="color-knob" style={{ left: `${props.hsv.s * 100}%`, top: `${(1 - props.hsv.v) * 100}%`, background: props.hex }} />
			</div>
			<div class="color-hue" onPointerDown={(event) => props.dragOver(event, event.currentTarget, (fx) => props.setHsv({ ...props.hsv, h: Math.min(359.9, fx * 360) }))} aria-label="Hue">
				<span class="color-knob" style={{ left: `${(props.hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${props.hsv.h} 100% 50%)` }} />
			</div>
		</>
	);
}
// The swatches, the hex and the dropper.
/** The adaptive colours, which follow the canvas between light and dark, row by row. */
function AdaptiveSwatches(props: { value: string | undefined; onPick: (name: string) => void }) {
	return (
		<div class="color-palette" role="group" aria-label="Adaptive colours">
			<span class="color-caption text-faint">Adaptive</span>
			<For each={ADAPTIVE}>
				{(row) => (
					<>
						<span class="color-row" style={{ "flex-basis": "100%", height: 0 }} />
						<For each={row}>
							{(name) => (
								<button
									type="button"
									class="props-swatch"
									data-adaptive={name}
									style={{ "--swatch": swatchPaint(`$${name}`) }}
									data-on={decksColorOf(props.value) === name ? "true" : undefined}
									aria-pressed={decksColorOf(props.value) === name}
									aria-label={adaptiveTitle(name)}
									title={adaptiveTitle(name)}
									onClick={() => props.onPick(name)}
								/>
							)}
						</For>
					</>
				)}
			</For>
		</div>
	);
}

const PALETTE = ["#ffffff", "#f3f4f6", "#9ca3af", "#57606a", "#1f2328", "#fecaca", "#fde68a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#dc2626", "#d97706", "#16a34a", "#2563eb", "#7c3aed"];

/** The fixed colours. */
function PaletteSwatches(props: { picked: string | undefined; onPick: (color: string) => void }) {
	return (
		<div class="color-palette" role="group" aria-label="Colours">
			<For each={PALETTE}>
				{(color) => (
					<button
						type="button"
						class="props-swatch"
						style={{ "--swatch": color }}
						data-on={props.picked === color ? "true" : undefined}
						aria-label={color}
						title={color}
						onClick={() => props.onPick(color)}
					/>
				)}
			</For>
		</div>
	);
}

/** Enter in the hex field: three or six hex digits, with or without #, become the colour. */
function hexTyped(event: KeyboardEvent, pick: (full: string) => void): void {
	event.stopPropagation();
	if (event.key !== "Enter") return;
	const text = (event.currentTarget as HTMLInputElement).value.trim().replace(/^#/, "").toLowerCase();
	const full = /^[0-9a-f]{3}$/.test(text) ? text.replace(/./g, (c) => c + c) : text;
	if (!/^[0-9a-f]{6}$/.test(full)) return;
	pick(`#${full}`);
}

/** Whether this browser can pick a colour from the screen. */
const dropper = typeof window !== "undefined" && "EyeDropper" in window;

/** A colour picked from the screen, as a hex; closed with Escape, nothing. */
async function pickFromScreen(pick: (hex: string) => void): Promise<void> {
	try {
		const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
		const picked = await new Dropper().open();
		pick(picked.sRGBHex);
	} catch {
		// Closed with Escape: nothing picked.
	}
}
// Colour as hue, saturation and value.
function hexToHsv(hex: string): Hsv {
	const m = /^#?([0-9a-f]{6})/i.exec(hex);
	const n = m ? parseInt(m[1]!, 16) : 0xffffff;
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	const to = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}
