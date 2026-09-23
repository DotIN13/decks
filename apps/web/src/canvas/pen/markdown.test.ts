import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parseMarkdown } from "./markdown.ts";

test("a card's markdown reads into headings, paragraphs, lists, quotes and code", () => {
	const blocks = parseMarkdown("# Plan\n\nFirst we **measure**,\nthen we cut.\n\n- one\n  - nested\n1. first\n- [x] done\n> said so\n\n```\nx = 1\n```\n---");
	assert.deepEqual(blocks.map((b) => b.kind), ["heading", "paragraph", "item", "item", "item", "item", "quote", "code", "rule"]);
	assert.deepEqual(blocks[1], { kind: "paragraph", runs: [{ text: "First we " }, { text: "measure", bold: true }, { text: ", then we cut." }] });
	assert.equal(blocks[3]!.kind === "item" && blocks[3]!.depth, 1);
	assert.equal(blocks[4]!.kind === "item" && blocks[4]!.ordered && blocks[4]!.number, 1);
	assert.equal(blocks[5]!.kind === "item" && blocks[5]!.checked, true);
	assert.equal(blocks[7]!.kind === "code" && blocks[7]!.text, "x = 1");
});

test("inline marks: bold, italic, code and links, and an underscore inside a word is not italic", () => {
	assert.deepEqual(inline("a *b* `c` [d](https://x.io)"), [{ text: "a " }, { text: "b", italic: true }, { text: " " }, { text: "c", code: true }, { text: " " }, { text: "d", link: "https://x.io" }]);
	assert.deepEqual(inline("snake_case_name"), [{ text: "snake_case_name" }]);
	assert.deepEqual(inline("**bold** and _it_"), [{ text: "bold", bold: true }, { text: " and " }, { text: "it", italic: true }]);
});
