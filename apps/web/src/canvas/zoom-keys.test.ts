import assert from "node:assert/strict";
import { test } from "node:test";
import { zoomKey } from "./zoom-keys.ts";

/** A keystroke, with ⌘ held unless said otherwise. */
const press = (key: string, code: string, extra: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({
	key,
	code,
	metaKey: true,
	ctrlKey: false,
	altKey: false,
	...extra,
});

/*
 * The case that made this a function rather than a condition: on a US layout the key
 * labelled `+` is `=` unshifted, so ⌘+ arrives as `key: "="`. A handler matching `"+"` never
 * fires and Chrome zooms the page instead — which is the bug being fixed.
 */
test("the key labelled + arrives as = and still means zoom in", () => {
	assert.equal(zoomKey(press("=", "Equal")), "in");
	assert.equal(zoomKey(press("+", "Equal")), "in", "and as + when shift is held");
	assert.equal(zoomKey(press("-", "Minus")), "out");
	assert.equal(zoomKey(press("_", "Minus")), "out", "shifted, which is what a slip produces");
	assert.equal(zoomKey(press("0", "Digit0")), "fit");
});

test("the numpad works too, where the labels are honest", () => {
	assert.equal(zoomKey(press("+", "NumpadAdd")), "in");
	assert.equal(zoomKey(press("-", "NumpadSubtract")), "out");
	assert.equal(zoomKey(press("0", "Numpad0")), "fit");
});

test("Ctrl is the same gesture, because Linux and Windows say Ctrl", () => {
	assert.equal(zoomKey(press("=", "Equal", { metaKey: false, ctrlKey: true })), "in");
	assert.equal(zoomKey(press("-", "Minus", { metaKey: false, ctrlKey: true })), "out");
});

/*
 * Without a modifier this is not ours. The bare keys are handled by the ordinary shortcut
 * path, and answering here as well would be one keystroke taken twice.
 */
test("a bare key is somebody else's", () => {
	assert.equal(zoomKey(press("=", "Equal", { metaKey: false })), undefined);
	assert.equal(zoomKey(press("+", "NumpadAdd", { metaKey: false })), undefined);
});

test("alt is left alone, because the window manager has it", () => {
	assert.equal(zoomKey(press("=", "Equal", { altKey: true })), undefined);
	assert.equal(zoomKey(press("-", "Minus", { altKey: true })), undefined);
});

/*
 * And the guard this exception is carved out of: ⌘C must still copy. The whole reason the
 * modifier check exists is that `event.key` is `"c"` whatever else is held, so a canvas that
 * claimed every modified key switched the tool to *card* and cancelled the clipboard.
 */
test("every other modified key is not a zoom", () => {
	for (const [key, code] of [["c", "KeyC"], ["v", "KeyV"], ["s", "KeyS"], ["1", "Digit1"], ["9", "Digit9"]] as const) {
		assert.equal(zoomKey(press(key, code)), undefined, `⌘${key}`);
	}
});
