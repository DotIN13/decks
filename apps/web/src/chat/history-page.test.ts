import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { earlierLabel, hasEarlier, hiddenCount, prepend, windowOf, WINDOW } from "./history-page.ts";

const rows = (n: number, prefix = "u") =>
	Array.from({ length: n }, (_, i) => ({ kind: "user", id: `${prefix}${i}`, text: `${i}`, at: i }) as ChatItem);

test("the window is the tail, and a short conversation is all of it", () => {
	const all = rows(10);
	assert.equal(windowOf(all, 60).length, 10);
	assert.equal(windowOf(all, 60), all, "the same array back, so nothing downstream is recomputed");
});

test("a long conversation renders its end", () => {
	const all = rows(200);
	const shown = windowOf(all, 60);
	assert.equal(shown.length, 60);
	assert.equal((shown.at(-1) as { id: string }).id, "u199", "the newest row is on screen");
	assert.equal((shown[0] as { id: string }).id, "u140");
	assert.equal(hiddenCount(all.length, shown.length), 140);
});

/*
 * The one wrong answer that cannot be corrected later: a chat with nothing in it offering
 * to fetch messages it has never had. It happens in the gap between opening a chat and the
 * first `chat.history` arriving, which is why the empty case is asked first.
 */
test("an empty conversation has nothing before it, whatever the server said", () => {
	assert.equal(hasEarlier({ total: 0, hidden: 0, more: false }), false);
	assert.equal(hasEarlier({ total: 0, hidden: 0, more: true }), false);
});

test("there is something earlier when the window hides it or the server holds it", () => {
	assert.equal(hasEarlier({ total: 200, hidden: 140, more: false }), true, "in the browser already");
	assert.equal(hasEarlier({ total: 60, hidden: 0, more: true }), true, "on the server");
	assert.equal(hasEarlier({ total: 60, hidden: 0, more: false }), false, "the whole conversation is on screen");
});

test("the label counts what it can and invites when it cannot", () => {
	assert.equal(earlierLabel(140), "140 earlier messages");
	assert.equal(earlierLabel(1), "1 earlier message");
	// Nothing hidden in the browser, but the server has more: there is no number to give.
	assert.equal(earlierLabel(0), "Earlier messages");
});

/*
 * Two pages can be in flight at once — a reader who keeps scrolling asks again before the
 * first answer lands — and a rewind re-sends a window that may overlap a page already
 * fetched. Either way the same row must not appear twice.
 */
test("a page already held is not prepended a second time", () => {
	const held = rows(3, "b");
	const page = [...rows(2, "a"), ...rows(1, "b")];
	const merged = prepend(page, held);
	assert.deepEqual(
		merged.map((item) => item.id),
		["a0", "a1", "b0", "b1", "b2"],
	);
});

test("a page arrives in front of what is held, oldest first", () => {
	const merged = prepend(rows(2, "a"), rows(2, "b"));
	assert.deepEqual(
		merged.map((item) => item.id),
		["a0", "a1", "b0", "b1"],
	);
});

test("an empty page changes nothing but is still a new array", () => {
	const held = rows(2);
	const merged = prepend([], held);
	assert.deepEqual(merged, held);
	assert.notEqual(merged, held, "so a signal set with it still reads as a change");
});

test("the window starts at a screenful, not at everything", () => {
	assert.equal(WINDOW, 60);
});
