/**
 * ⌘+ / ⌘− / ⌘0 — the canvas's zoom, taken back from the browser's.
 *
 * Every other shortcut on the canvas is a bare key, and the modifier guard that protects ⌘C
 * and ⌘V is the reason: `event.key` is `"c"` whatever else is held, so without it a copy
 * switched the tool to *card* and cancelled the clipboard. These three are the exception,
 * because they are the one place a person's habit and the browser's habit collide — ⌘+ on a
 * canvas means "zoom in", and Chrome hears "make the page bigger", which enlarges the whole
 * app including the chat column and leaves the camera exactly where it was.
 *
 * ### The key is not the key
 *
 * On a US layout the key labelled `+` is `=` unshifted, so ⌘+ arrives as `key: "="` and a
 * handler matching `"+"` never fires. Shift makes it `"+"`. The numpad sends `"+"` and `"-"`
 * with no shift at all. So this reads **both** `key` and `code`, and the union is the whole
 * point of the function existing rather than being a condition inlined at two call sites:
 * getting it right once beats getting it right in the stage and wrong in a board frame.
 *
 * `code` is a physical position, which is not the same question on every layout — an AZERTY
 * `Minus` is somewhere else — so it is the fallback for the numpad rather than the primary
 * test, and what somebody's keyboard actually produces (`key`) is tried first.
 */
export type ZoomKey = "in" | "out" | "fit";

/** Physical keys, for the numpad — where `key` alone is ambiguous across layouts. */
const CODES: Record<string, ZoomKey> = {
	NumpadAdd: "in",
	NumpadSubtract: "out",
	Numpad0: "fit",
	Equal: "in",
	Minus: "out",
	Digit0: "fit",
};

/** What somebody's keyboard actually produced, which is the better question when it answers. */
const KEYS: Record<string, ZoomKey> = {
	"+": "in",
	"=": "in",
	"-": "out",
	_: "out",
	"0": "fit",
};

/**
 * Which zoom this keystroke is, if it is one — **only** with ⌘ or Ctrl held.
 *
 * Bare `+` and `-` are handled by the ordinary shortcut path and are not this function's
 * business; asking here without a modifier returns nothing, so a caller cannot accidentally
 * take a plain keystroke twice.
 *
 * Shift is allowed through, because ⌘⇧+ is how `+` is typed on the row of numbers and
 * refusing it would reject the very keystroke the label on the key describes. Alt is not: it
 * belongs to the window manager on both platforms, and ⌥⌘− is somebody's screenshot tool.
 */
export function zoomKey(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey">): ZoomKey | undefined {
	if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
	return KEYS[event.key] ?? CODES[event.code];
}
