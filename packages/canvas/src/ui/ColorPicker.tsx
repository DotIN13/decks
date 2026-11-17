import { DECKS_COLORS, decksColorOf } from "@decks/pen";
import { ADAPTIVE, adaptiveTitle, swatchPaint } from "./adaptive.ts";
import Pipette from "lucide-solid/icons/pipette";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { portalLayer } from "@decks/ui";
import { Icon } from "@decks/ui";
import { scheme } from "../base/theme.ts";
import { createColorDrag } from "./color-drag.ts";
import { hexToHsv, hsvToHex, type Hsv } from "./color-math.ts";
import { createColorPlace } from "./color-place.ts";
import type { ColorPickerProps } from "./color-picker-props.ts";

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
const PALETTE = ["#ffffff", "#f3f4f6", "#9ca3af", "#57606a", "#1f2328", "#fecaca", "#fde68a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#dc2626", "#d97706", "#16a34a", "#2563eb", "#7c3aed"];

export function ColorPicker(props: ColorPickerProps) {
	const decksNow = (value: string | undefined) => DECKS_COLORS[decksColorOf(value) ?? ""]?.[scheme()];
	const [hsv, setHsv] = createSignal<Hsv>(hexToHsv(props.shown ?? decksNow(props.value) ?? props.value ?? "#ffffff"));
	/** The field holds a variable: no swatch of a fixed colour is its colour, whatever it comes to now. */
	const variable = () => props.value?.startsWith("$") === true;
	const hex = () => hsvToHex(hsv());
	const [place, setPlace] = createSignal({ left: 0, top: 0 });
	let card: HTMLDivElement | undefined;
	let field: HTMLInputElement | undefined;

	createColorPlace({
		props,
		get card() { return card; },
		setPlace,
	});
	const commit = (value = hex()) => {
		if (value !== props.value) props.onCommit(value);
		// Let go on the colour it already was: nothing is saved, so the live one has to be dropped here.
		else props.onLive?.();
	};

	const { dragOver, dropper, pickFromScreen } = createColorDrag({ props, hex, commit, setHsv });

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
											onClick={() => {
												setHsv(hexToHsv(DECKS_COLORS[name]![scheme()]));
												if (props.value !== `$${name}`) props.onCommit(`$${name}`);
											}}
										/>
									)}
								</For>
							</>
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
