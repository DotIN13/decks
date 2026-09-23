import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBlock, COMMENTS_KEY, loadComments, popupPlace, QUOTE_LIMIT, quoteOf, saveComments, withComments, type BoardComment } from "./comments.ts";

const comment = (extra: Partial<BoardComment> = {}): BoardComment => ({ id: "c1", board: "boards/plan.html", component: "goal", quote: "Keep it short.", text: "Two sentences, please.", at: 1, ...extra });

test("a quotation is one line, and not the whole page", () => {
	assert.equal(quoteOf("  Keep\n\tit   short. "), "Keep it short.");
	const long = quoteOf("word ".repeat(200));
	assert.equal(long.length <= QUOTE_LIMIT, true);
	assert.ok(long.endsWith("…"));
});

test("the agent reads where, the words, and the comment, and the list says what it is", () => {
	assert.equal(commentBlock([]), "");
	assert.equal(
		commentBlock([comment()]),
		"A comment on a board. The quoted words are what I selected:\n\n1. boards/plan.html, in #goal\n   > Keep it short.\n   Two sentences, please.",
	);
	const two = commentBlock([comment(), comment({ id: "c2", component: undefined, text: "Why?\nSay more." })]);
	assert.match(two, /^2 comments on boards\./);
	assert.match(two, /2\. boards\/plan\.html\n   > Keep it short\.\n   Why\?\n   Say more\.$/);
});

test("waiting comments go in front of the next message, and either half may be missing", () => {
	assert.equal(withComments("  hello ", []), "hello");
	assert.equal(withComments("", [comment()]), commentBlock([comment()]));
	assert.equal(withComments("Then fit the board.", [comment()]), `${commentBlock([comment()])}\n\nThen fit the board.`);
});

test("comments survive a reload per agent, and a broken store is an empty one", () => {
	const held = new Map<string, string>();
	const store = { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), removeItem: (key: string) => void held.delete(key) };
	saveComments(store, { a1: [comment()], a2: [] });
	assert.deepEqual(loadComments(store), { a1: [comment()] });
	saveComments(store, { a1: [] });
	assert.equal(held.has(COMMENTS_KEY), false, "nothing waiting is nothing stored");
	held.set(COMMENTS_KEY, "{not json");
	assert.deepEqual(loadComments(store), {});
	held.set(COMMENTS_KEY, JSON.stringify({ a1: [{ id: 1 }, comment()] }));
	assert.deepEqual(loadComments(store), { a1: [comment()] });
	assert.deepEqual(loadComments(undefined), {});
});

test("the popup sits under the selection, above it when there is no room, and never off the window", () => {
	const view = { w: 1000, h: 800 };
	const size = { w: 300, h: 120 };
	assert.deepEqual(popupPlace({ left: 400, top: 100, right: 600, bottom: 120 }, size, view), { left: 350, top: 128, above: false });
	assert.deepEqual(popupPlace({ left: 400, top: 700, right: 600, bottom: 760 }, size, view), { left: 350, top: 572, above: true });
	assert.equal(popupPlace({ left: 0, top: 100, right: 40, bottom: 120 }, size, view).left, 8);
	assert.equal(popupPlace({ left: 960, top: 100, right: 1000, bottom: 120 }, size, view).left, 692);
	assert.equal(popupPlace({ left: 270, top: 100, right: 330, bottom: 120 }, size, { ...view, left: 264 }).left, 272, "clear of the sidebar");
});
