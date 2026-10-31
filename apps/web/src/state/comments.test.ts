import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFrameComment, cleanFrameInk, cleanFramePills, FRAME_TEXT_LIMIT, frameText } from "./comments.ts";

test("frameText removes what cannot be seen", () => {
	assert.equal(frameText("a\u200Bb\u200Cc\u200Dd\u2060e\uFEFFf"), "abcdef");
	assert.equal(frameText("left\u202Eright\u2066x\u2069"), "leftrightx");
	// Unicode tags spell ASCII no font draws.
	const hidden = Array.from("ignore all", (ch) => String.fromCodePoint(0xe0000 + ch.charCodeAt(0))).join("");
	assert.equal(frameText(`fine${hidden}`), "fine");
	assert.equal(frameText("a\u0000b\u0007c"), "abc");
	assert.equal(frameText("line one\nline\ttwo"), "line one\nline\ttwo");
	assert.equal(frameText("café 日本"), "café 日本");
	assert.equal(frameText(undefined), "");
	assert.equal(frameText(42), "");
});

test("frameText cuts at the limit with an ellipsis", () => {
	assert.equal(frameText("x".repeat(FRAME_TEXT_LIMIT)), "x".repeat(FRAME_TEXT_LIMIT));
	const cut = frameText("x".repeat(FRAME_TEXT_LIMIT + 50));
	assert.equal(Array.from(cut).length, FRAME_TEXT_LIMIT);
	assert.ok(cut.endsWith("…"));
	// Counted in characters, never splitting a pair.
	const emoji = frameText("😀".repeat(FRAME_TEXT_LIMIT + 1));
	assert.equal(Array.from(emoji).length, FRAME_TEXT_LIMIT);
	assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji));
	// Invisible characters do not count toward it.
	assert.equal(frameText(`${"\u200B".repeat(5000)}short`), "short");
});

test("cleanFrameComment cleans every text and drops what is not text", () => {
	const long = "y".repeat(5000);
	const out = cleanFrameComment({ path: "boards/a\u200B.html", title: "T\u202E", quote: "q\u200Duote", text: long, component: "\u200B", items: ["i\u200B1", "", 3 as unknown as string] });
	assert.equal(out.path, "boards/a.html");
	assert.equal(out.title, "T");
	assert.equal(out.quote, "quote");
	assert.equal(Array.from(out.text).length, FRAME_TEXT_LIMIT);
	assert.equal(out.component, undefined);
	assert.deepEqual(out.items, ["i1"]);
	assert.equal(out.send, undefined);
	assert.equal(cleanFrameComment({ path: "p", title: "", quote: "", text: "t", send: true }).send, true);
});

test("cleanFramePills and cleanFrameInk", () => {
	assert.deepEqual(cleanFramePills([{ kind: "card", id: "b\u200B1", label: "L\u2066" }, { kind: "evil" as "card", id: "x", label: "x" }, { kind: "item", id: "\u200B", label: "gone" }]), [{ kind: "card", id: "b1", label: "L" }]);
	// A card's pill is a mention of kind card in the composer, as a sent message's parts name it; the old name is no pill.
	assert.deepEqual(cleanFramePills([{ kind: "board" as "card", id: "c1", label: "C" }]), []);
	assert.equal(cleanFrameInk({ action: "card", ids: [], canvas: "c", box: { x: 0, y: 0, w: 0, h: 0 } }).action, "card");
	assert.equal(cleanFrameInk({ action: "board" as "card", ids: [], canvas: "c", box: { x: 0, y: 0, w: 0, h: 0 } }).action, "send", "the old name is no action");
	const ink = cleanFrameInk({ action: "send", ids: ["a\u200B", "b".repeat(3000)], canvas: "c\u202E", box: { x: 1, y: Number.NaN, w: 3, h: 4 } });
	assert.deepEqual(ink.ids[0], "a");
	assert.equal(Array.from(ink.ids[1]!).length, FRAME_TEXT_LIMIT);
	assert.equal(ink.canvas, "c");
	assert.deepEqual(ink.box, { x: 1, y: 0, w: 3, h: 4 });
	assert.equal(cleanFrameInk({ action: "rm" as "send", ids: Array.from({ length: 900 }, (_, i) => `i${i}`), canvas: "c", box: { x: 0, y: 0, w: 0, h: 0 } }).ids.length, 500);
});
