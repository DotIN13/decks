import assert from "node:assert/strict";
import { test } from "node:test";
import { onFullscreenLeft } from "./fullscreen.ts";

/**
 * The two-press bug, as a test rather than as a browser.
 *
 * A fake document is the only way to write it down: what the real browser does that matters is
 * *not* dispatching the keystroke, and no synthetic event can reproduce that. What can be
 * reproduced is the consequence — a `fullscreenchange` that says nothing is in fullscreen any
 * more — and that is what the overlay has to act on.
 */
function fakeDoc() {
	const listeners = new Set<() => void>();
	let element: Element | null = null;
	return {
		addEventListener: (type: string, listener: () => void) => {
			if (type === "fullscreenchange") listeners.add(listener);
		},
		removeEventListener: (type: string, listener: () => void) => {
			listeners.delete(listener);
		},
		get fullscreenElement() {
			return element;
		},
		/** The browser entering, then leaving: two changes, both announced. */
		enter: (next: Element | null) => {
			element = next;
			for (const listener of [...listeners]) listener();
		},
		count: () => listeners.size,
	};
}

test("the browser leaving fullscreen is the overlay leaving", () => {
	const doc = fakeDoc();
	let left = 0;
	onFullscreenLeft(doc, () => (left += 1));
	doc.enter({} as Element);
	assert.equal(left, 0, "going *into* fullscreen is not leaving it");
	doc.enter(null);
	assert.equal(left, 1, "and the change that says nothing is in fullscreen is: one leave");
});

test("entering the same element twice does not read as leaving", () => {
	const doc = fakeDoc();
	let left = 0;
	onFullscreenLeft(doc, () => (left += 1));
	const element = {} as Element;
	doc.enter(element);
	doc.enter(element);
	assert.equal(left, 0);
});

test("the subscription is dropped when the overlay goes", () => {
	const doc = fakeDoc();
	let left = 0;
	const stop = onFullscreenLeft(doc, () => (left += 1));
	stop();
	doc.enter(null);
	assert.equal(left, 0);
	assert.equal(doc.count(), 0, "and the listener is off the document, not merely ignored");
});
