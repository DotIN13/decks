import { DECKS_COLORS, decksColorOf } from "@decks/pen";
import Pipette from "lucide-solid/icons/pipette";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { portalLayer } from "@decks/ui";
import { Icon } from "@decks/ui";
import { scheme } from "../lib/theme.ts";

/**
 * A colour picker for the properties panel: a square of shade and brightness, a strip of hues, the
 * colour as hex, a dropper where the browser has one, the adaptive colours, and the panel's own swatches.
 *
 * The adaptive colours are the drawing's own light/dark variables (`@decks/pen` `DECKS_COLORS`): a
 * pick writes `"$decks-ink"`, which the drawing's edit defines when it lacks it, and the colour
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
type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
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

export function hsvToHex({ h, s, v }: Hsv): string {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	const to = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}

/** The adaptive colours on offer, by name: one of each look, without the tools' near-twins (figure, card). */
export const ADAPTIVE = [
	"decks-ink", "decks-muted", "decks-line", "decks-frame-line", "decks-frame", "decks-shape", "decks-shape-2",
	"decks-red", "decks-orange", "decks-yellow", "decks-green", "decks-blue", "decks-purple",
	"decks-red-fill", "decks-orange-fill", "decks-yellow-fill", "decks-green-fill", "decks-blue-fill", "decks-purple-fill", "decks-gray-fill",
];

/** A swatch's paint: an adaptive colour split corner to corner, light over dark; any other colour as it is. */
export function swatchPaint(color: string): string {
	const decks = DECKS_COLORS[decksColorOf(color) ?? ""];
	return decks ? `linear-gradient(135deg, ${decks.light} 0 50%, ${decks.dark} 50% 100%)` : color;
}

/** An adaptive colour's tooltip: its name and its two values. */
export function adaptiveTitle(name: string): string {
	const decks = DECKS_COLORS[name]!;
	return `${decks.name} (adaptive): ${decks.light} in light, ${decks.dark} in dark`;
}

const PALETTE = ["#ffffff", "#f3f4f6", "#9ca3af", "#57606a", "#1f2328", "#fecaca", "#fde68a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#dc2626", "#d97706", "#16a34a", "#2563eb", "#7c3aed"];

export function ColorPicker(props: {
	/** The field's colour: a hex, or a variable (`"$decks-ink"`). */
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

	const position = () => {
		const at = props.anchor.getBoundingClientRect();
		const width = 232;
		const height = card?.offsetHeight ?? 300;
		const left = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
		const below = at.bottom + 6;
		const top = below + height > window.innerHeight - 8 ? Math.max(8, at.top - height - 6) : below;
		setPlace({ left, top });
	};
	const commit = (value = hex()) => {
		if (value !== props.value) props.onCommit(value);
		// Let go on the colour it already was: nothing is saved, so the live one has to be dropped here.
		else props.onLive?.();
	};
	onMount(() => {
		position();
		requestAnimationFrame(position);
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (card?.contains(target) || props.anchor.contains(target)) return;
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
		onCleanup(() => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key, true);
			window.removeEventListener("resize", position);
		});
	});

	/** A drag across an element, as fractions of it: drawn at every step, saved on release. */
	const dragOver = (event: PointerEvent, el: HTMLElement, move: (fx: number, fy: number) => void) => {
		event.preventDefault();
		el.setPointerCapture(event.pointerId);
		const at = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			move(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
			props.onLive?.(hex());
		};
		at(event);
		const moved = (e: PointerEvent) => at(e);
		const up = () => {
			el.removeEventListener("pointermove", moved);
			el.removeEventListener("pointerup", up);
			el.removeEventListener("pointercancel", up);
			commit();
		};
		el.addEventListener("pointermove", moved);
		el.addEventListener("pointerup", up);
		el.addEventListener("pointercancel", up);
	};

	const dropper = typeof window !== "undefined" && "EyeDropper" in window;
	const pickFromScreen = async () => {
		try {
			const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
			const picked = await new Dropper().open();
			setHsv(hexToHsv(picked.sRGBHex));
			commit(picked.sRGBHex.toLowerCase());
		} catch {
			// Closed with Escape: nothing picked.
		}
	};

	return (
		<Portal mount={portalLayer()}>
			<div ref={card} class="panel-float color-picker" role="dialog" aria-label={`${props.label}: pick a colour`} style={{ left: `${place().left}px`, top: `${place().top}px` }}>
				<div
					class="color-sv"
					style={{ "--hue": `hsl(${hsv().h} 100% 50%)` }}
					onPointerDown={(event) => dragOver(event, event.currentTarget, (fx, fy) => setHsv({ ...hsv(), s: fx, v: 1 - fy }))}
					aria-label="Shade and brightness"
				>
					<span class="color-knob" style={{ left: `${hsv().s * 100}%`, top: `${(1 - hsv().v) * 100}%`, background: hex() }} />
				</div>
				<div class="color-hue" onPointerDown={(event) => dragOver(event, event.currentTarget, (fx) => setHsv({ ...hsv(), h: Math.min(359.9, fx * 360) }))} aria-label="Hue">
					<span class="color-knob" style={{ left: `${(hsv().h / 360) * 100}%`, top: "50%", background: `hsl(${hsv().h} 100% 50%)` }} />
				</div>
				<div class="color-row">
					<span class="color-now" style={{ background: hex() }} aria-hidden="true" />
					<label class="field color-hex">
						<span class="text-faint">#</span>
						<input
							ref={field}
							aria-label={`${props.label}, as hex`}
							value={hex().slice(1)}
							spellcheck={false}
							on:keydown={(event: KeyboardEvent) => {
								event.stopPropagation();
								if (event.key !== "Enter") return;
								const text = (event.currentTarget as HTMLInputElement).value.trim().replace(/^#/, "").toLowerCase();
								const full = /^[0-9a-f]{3}$/.test(text) ? text.replace(/./g, (c) => c + c) : text;
								if (!/^[0-9a-f]{6}$/.test(full)) return;
								setHsv(hexToHsv(`#${full}`));
								commit(`#${full}`);
							}}
						/>
					</label>
					<Show when={dropper}>
						<button type="button" class="icon-button" title="Pick a colour from the screen" aria-label="Pick a colour from the screen" onClick={() => void pickFromScreen()}>
							<Icon of={Pipette} size={14} />
						</button>
					</Show>
				</div>
				<Show when={props.adaptive !== false}>
				<div class="color-palette" role="group" aria-label="Adaptive colours">
					<span class="color-caption text-faint">Adaptive</span>
					<For each={ADAPTIVE}>
						{(name) => (
							<button
								type="button"
								class="props-swatch"
								data-adaptive={name}
								style={{ "--swatch": swatchPaint(`$${name}`) }}
								data-on={props.value === `$${name}` ? "true" : undefined}
								aria-pressed={props.value === `$${name}`}
								aria-label={adaptiveTitle(name)}
								title={adaptiveTitle(name)}
								onClick={() => {
									setHsv(hexToHsv(DECKS_COLORS[name]![scheme()]));
									if (props.value !== `$${name}`) props.onCommit(`$${name}`);
								}}
							/>
						)}
					</For>
				</div>
				</Show>
				<div class="color-palette" role="group" aria-label="Colours">
					<For each={PALETTE}>
						{(color) => (
							<button
								type="button"
								class="props-swatch"
								style={{ "--swatch": color }}
								data-on={!variable() && hex() === color ? "true" : undefined}
								aria-label={color}
								title={color}
								onClick={() => {
									setHsv(hexToHsv(color));
									commit(color);
								}}
							/>
						)}
					</For>
				</div>
			</div>
		</Portal>
	);
}
