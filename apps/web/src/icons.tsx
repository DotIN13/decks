/**
 * The mark, drawn here; every other icon comes from Lucide.
 *
 * The logo is the one drawing that carries meaning nobody else's icon set has, so it
 * stays hand-rolled — and it is the first paint of the title bar, which is a poor place
 * to be waiting on anything. Everything else used to be a glyph character (`▹`, `×`,
 * `↑`, `+`) picked for having no dependency, and the cost of that showed: a text glyph
 * has a font's baseline and metrics rather than an icon's box, so each one needed its own
 * `font-size` to look centred, and none of them could be given a consistent weight.
 * Lucide's set is one grid, one joint style, and one stroke — imported per icon
 * (`lucide-solid/icons/x`) so the bundle carries the twenty the chrome uses rather than
 * the fifteen hundred that exist.
 *
 * `lucide-solid` rather than `lucide-static` because it is a real Solid component: it
 * ships an uncompiled-JSX `solid` export condition that `vite-plugin-solid` compiles with
 * the rest of the app, so an icon is a few DOM calls rather than a parsed SVG string.
 */
import type { LucideIcon } from "lucide-solid";
import { Dynamic } from "solid-js/web";

/**
 * One decision about stroke weight, made here.
 *
 * 1.25 rather than Lucide's default 2, and rather than a flat 1: the chrome draws icons
 * at 14–17px, where Lucide's units are scaled by size/24 — so a stroke of 1 lands at
 * 0.6 device pixels and antialiases into a grey suggestion of an icon, worst on the
 * light theme where these sit in `--faint`. 1.25 keeps the thin, drawn-with-a-pen look
 * the app's typography has and still resolves.
 */
const STROKE = 1.25;

/** The default: an icon sitting in the 13px body text. Call sites beside something
 *  bigger — the title bar, the palette — say so. */
const SIZE = 15;

/**
 * Every Lucide icon in the app goes through here.
 *
 * A wrapper rather than props spread at each call site, because stroke weight is a
 * property of the app and not of the button — and because the palette keeps its icons
 * in an array, where a component reference is the natural thing to hold.
 *
 * `currentColor` is Lucide's own default, which is what keeps these following the theme
 * without any of them being told a colour (`lib/theme.ts`).
 */
export function Icon(props: { of: LucideIcon; size?: number; class?: string }) {
	return <Dynamic component={props.of} size={props.size ?? SIZE} strokeWidth={STROKE} class={props.class} />;
}

/**
 * The mark: boards of unequal size laid out on a canvas.
 *
 * Deliberately not a grid of equal squares — a deck is an arrangement somebody chose,
 * and the asymmetry is the only thing that says so at 17px.
 */
export function DecksMark() {
	return (
		<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
			<rect x="1" y="2" width="7.5" height="6.5" rx="1.5" />
			<rect x="10" y="2" width="5" height="12" rx="1.5" opacity="0.5" />
			<rect x="1" y="10" width="7.5" height="4" rx="1.5" opacity="0.72" />
		</svg>
	);
}
