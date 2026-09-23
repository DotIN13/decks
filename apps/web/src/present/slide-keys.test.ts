import assert from "node:assert/strict";
import { test } from "node:test";
import { deckMode, slideKey } from "./slide-keys.ts";

const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
	({ key, code: key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra }) as KeyboardEvent;

test("the arrows page, in both states", () => {
	for (const where of ["focused", "fullscreen"] as const) {
		assert.equal(slideKey(press("ArrowRight"), where), "next", where);
		assert.equal(slideKey(press("ArrowLeft"), where), "prev", where);
		assert.equal(slideKey(press("Home"), where), "first", where);
		assert.equal(slideKey(press("End"), where), "last", where);
	}
});

/*
 * The entry that is not padding: every physical presentation clicker sends PageUp/PageDown
 * and nothing else. A deck you cannot advance with a remote is a deck you cannot present
 * with.
 */
test("a presentation clicker works", () => {
	assert.equal(slideKey(press("PageDown"), "fullscreen"), "next");
	assert.equal(slideKey(press("PageUp"), "fullscreen"), "prev");
	assert.equal(slideKey(press("PageDown"), "focused"), "next", "and on the canvas too");
});

/*
 * Space is the difference between the two states. On the canvas it is held-to-pan — the
 * primary navigation gesture — and taking it to add a second way to do what → already does
 * would be a bad trade.
 */
test("Space advances in fullscreen and pans on the canvas", () => {
	assert.equal(slideKey(press(" "), "fullscreen"), "next");
	assert.equal(slideKey(press(" "), "focused"), undefined, "the canvas pans with it");
	assert.equal(slideKey(press(" ", { shiftKey: true }), "fullscreen"), "prev", "as a clicker's back button does");
});

test("f enters, Escape leaves, and neither does the other's job", () => {
	assert.equal(slideKey(press("f"), "focused"), "present");
	assert.equal(slideKey(press("F"), "focused"), "present");
	assert.equal(slideKey(press("f"), "fullscreen"), undefined, "already there");
	assert.equal(slideKey(press("Escape"), "fullscreen"), "exit");
	// On the canvas Escape deselects. A deck taking it would mean clicking a deck cost you
	// the way out of everything else.
	assert.equal(slideKey(press("Escape"), "focused"), undefined);
});

/*
 * ⌘→ is a word jump, ⌥→ is the window manager, and ⌘+ is the canvas zoom. A deck that
 * claimed modified keys would be the fourth keyboard collision in this app.
 */
test("a modified key is somebody else's", () => {
	for (const modifier of ["metaKey", "ctrlKey", "altKey"] as const) {
		assert.equal(slideKey(press("ArrowRight", { [modifier]: true }), "fullscreen"), undefined, modifier);
		assert.equal(slideKey(press(" ", { [modifier]: true }), "fullscreen"), undefined, modifier);
	}
	// Shift is not a modifier in this sense: it is part of the gesture for Space.
	assert.equal(slideKey(press("ArrowRight", { shiftKey: true }), "fullscreen"), "next");
});

test("an ordinary letter is not a slide action", () => {
	for (const key of ["a", "1", "Tab", "Enter", "Backspace", "v"]) {
		assert.equal(slideKey(press(key), "focused"), undefined, key);
	}
});

/*
 * The contact sheet threshold is the canvas's own, and deliberately not a second number:
 * below it a board takes no pointer events, so a deck down there cannot be paged and one
 * slide of twelve is the least useful thing to show.
 */
test("the sheet appears exactly where the board stops taking clicks", () => {
	assert.equal(deckMode(0.49, 0.5), "sheet");
	assert.equal(deckMode(0.5, 0.5), "stage", "at the threshold the board is interactive");
	assert.equal(deckMode(1, 0.5), "stage");
	assert.equal(deckMode(0.1, 0.5), "sheet");
});
