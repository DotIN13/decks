import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBlock, COMMENTS_KEY, loadComments, popupPlace, QUOTE_LIMIT, quoteOf, saveComments, withComments, type CardComment } from "./comments.ts";

const comment = (extra: Partial<CardComment> = {}): CardComment => ({ id: "c1", board: "boards/plan.html", component: "goal", quote: "Keep it short.", text: "Two sentences, please.", at: 1, ...extra });

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
		"A comment on a card. The quoted words are what I selected:\n\n1. boards/plan.html, in #goal\n   > Keep it short.\n   Two sentences, please.",
	);
	const two = commentBlock([comment(), comment({ id: "c2", component: undefined, text: "Why?\nSay more." })]);
	assert.match(two, /^2 comments on cards\./);
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

test("a comment on the whole board has no quote, and says so", () => {
	assert.equal(
		commentBlock([comment({ quote: "", component: undefined })]),
		"A comment on a card. The quoted words are what I selected:\n\n1. boards/plan.html, the whole card\n   Two sentences, please.",
	);
});

test("a comment on drawn items names the canvas file, the items by id, and their words", () => {
	const note: CardComment = { id: "c1", board: "canvases/plan/canvas.pen", items: ["term-1"], quote: "Program start", text: "make this green", at: 1 };
	const block = commentBlock([note]);
	assert.match(block, /^A comment on items drawn on a canvas:/);
	assert.match(block, /on canvases\/plan\/canvas\.pen, item "term-1" \("Program start"\)\n   make this green/);
});

test("waiting comments are kept per agent and canvas, and ones kept under the agent alone move to its canvas once", async () => {
	const { adoptComments, commentsKey } = await import("./comments.ts");
	const note = { id: "c1", board: "boards/a.html", quote: "q", text: "t", at: 1 };
	assert.equal(commentsKey("a1", "x"), "a1@x");
	assert.equal(commentsKey("a1", undefined), "a1");
	const moved = adoptComments({ a1: [note], "a1@x": [] }, "a1", "x");
	assert.deepEqual(moved, { "a1@x": [note] });
	assert.deepEqual(adoptComments(moved, "a1", "y"), moved, "nothing left to follow the agent to another canvas");
	const none = { "a1@x": [note] };
	assert.equal(adoptComments(none, "a1", "x"), none, "the same record when there is nothing to move");
});
