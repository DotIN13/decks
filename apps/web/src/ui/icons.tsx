/**
 * Every icon in the app, and the one decision about how they are drawn.
 *
 * Lucide's set is one grid, one joint style, and one stroke — imported per icon
 * (`lucide-solid/icons/x`) so the bundle carries the twenty the chrome uses rather than the
 * fifteen hundred that exist. What it replaced was glyph characters (`▹`, `×`, `↑`, `+`)
 * picked for having no dependency, and the cost of that showed: a text glyph has a font's
 * baseline and metrics rather than an icon's box, so each one needed its own `font-size` to
 * look centred, and none of them could be given a consistent weight.
 *
 * `lucide-solid` rather than `lucide-static` because it is a real Solid component: it ships
 * an uncompiled-JSX `solid` export condition that `vite-plugin-solid` compiles with the rest
 * of the app, so an icon is a few DOM calls rather than a parsed SVG string.
 *
 * It lives in `ui/` because that is what the directory is: the primitives every layer draws
 * with, this and `Popover.tsx` — as against `lib/`, which holds modules that are not
 * components at all. The app's own mark was drawn here by hand until the mark became the
 * avatar, and went with it.
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
