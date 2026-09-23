import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdown, wordsOf, type Block } from "./markdown.ts";

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

test("a card reads as GitHub reads it: headings, paragraphs, lists, quotes, code, tables and rules", () => {
	const blocks = parseMarkdown("# Plan\n\nFirst we **measure**, then ~~guess~~ cut.\n\n- one\n  - nested\n\n1. first\n\n> said so\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|:--|--:|\n| 1 | *2* |\n\n---\n###### small");
	assert.deepEqual(kinds(blocks), ["heading", "paragraph", "list", "list", "quote", "code", "table", "rule", "heading"]);
	assert.deepEqual(blocks[1], { kind: "paragraph", runs: [{ text: "First we " }, { text: "measure", bold: true }, { text: ", then " }, { text: "guess", strike: true }, { text: " cut." }] });
	const list = blocks[2] as Extract<Block, { kind: "list" }>;
	assert.equal(list.items[0]!.blocks[1]!.kind, "list");
	const code = blocks[5] as Extract<Block, { kind: "code" }>;
	assert.deepEqual([code.lang, code.text], ["ts", "const x = 1;"]);
	const table = blocks[6] as Extract<Block, { kind: "table" }>;
	assert.deepEqual(table.align, ["left", "right"]);
	assert.deepEqual(table.rows[0]![1], [{ text: "2", italic: true }]);
	assert.equal((blocks[8] as Extract<Block, { kind: "heading" }>).level, 6);
});

test("task lists, autolinks, images, alerts, footnotes and emoji", () => {
	const blocks = parseMarkdown("- [x] done\n- [ ] not yet\n\nSee https://github.com and [docs](https://x.io) :tada:\n\n![a chart](chart.png)\n\n> [!WARNING]\n> Mind the gap\n\nA claim[^src].\n\n[^src]: The source.");
	assert.deepEqual(kinds(blocks), ["list", "paragraph", "image", "quote", "paragraph", "footnotes"]);
	const list = blocks[0] as Extract<Block, { kind: "list" }>;
	assert.deepEqual(list.items.map((item) => item.checked), [true, false]);
	const links = (blocks[1] as Extract<Block, { kind: "paragraph" }>).runs.filter((run) => run.link).map((run) => run.link);
	assert.deepEqual(links, ["https://github.com", "https://x.io"]);
	assert.ok(wordsOf([blocks[1]!]).includes("🎉"));
	assert.deepEqual(blocks[2], { kind: "image", url: "chart.png", alt: "a chart" });
	const alert = blocks[3] as Extract<Block, { kind: "quote" }>;
	assert.equal(alert.alert, "warning");
	assert.equal(wordsOf(alert.blocks), "Mind the gap");
	assert.deepEqual((blocks[4] as Extract<Block, { kind: "paragraph" }>).runs.at(-2), { text: "1", sup: true });
	assert.equal(wordsOf([blocks[5]!]), "The source.");
});

test("raw HTML shows its words, a <br> breaks the line, and entities are decoded", () => {
	const [p] = parseMarkdown("Press <kbd>Ctrl</kbd> &amp; go<br>next");
	assert.equal(wordsOf([p!]), "Press Ctrl & go\nnext");
});

test("code in a known language is coloured as GitHub colours it, and an unknown one is left plain", async () => {
	const { highlight } = await import("./highlight.ts");
	const runs = highlight('const answer = "yes"; // why', "ts");
	assert.equal(runs.map((run) => run.text).join(""), 'const answer = "yes"; // why');
	assert.equal(runs.find((run) => run.text === "const")?.colour, "#cf222e");
	assert.equal(runs.find((run) => run.text.includes('"yes"'))?.colour, "#0a3069");
	assert.equal(runs.find((run) => run.text.includes("// why"))?.colour, "#59636e");
	assert.deepEqual(highlight("a < b", "klingon"), [{ text: "a < b" }]);
	assert.equal(highlight("const x = 1", "js", "dark").find((run) => run.text === "const")?.colour, "#ff7b72");
});
