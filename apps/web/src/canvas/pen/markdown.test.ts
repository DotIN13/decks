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
	assert.equal(alert.alert, "orange");
	assert.equal(alert.title, "Warning");
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

test("Obsidian's own: highlights in six colours, [[links]], embeds, image widths, callouts and hidden comments", () => {
	const blocks = parseMarkdown("Budget ==🟡¥90,000== and ==plain== for [[Mei Tanaka]] and [[Kyoto plan|the plan]]. %%not shown%%\n\n![Kinkaku-ji|240](kinkaku.jpg)\n\n![[itinerary.pdf]]\n\n![[map.png|300]]\n\n> [!tip]- Go early\n> the gates are empty\n\n%%\na hidden block\n%%\n\nend");
	assert.deepEqual(kinds(blocks), ["paragraph", "image", "embed", "image", "quote", "paragraph"]);
	const runs = (blocks[0] as Extract<Block, { kind: "paragraph" }>).runs;
	assert.deepEqual(runs.find((run) => run.text === "¥90,000"), { text: "¥90,000", mark: "yellow" });
	assert.deepEqual(runs.find((run) => run.text === "plain"), { text: "plain", mark: "default" });
	assert.deepEqual(runs.find((run) => run.wiki === "Kyoto plan"), { text: "the plan", wiki: "Kyoto plan" });
	assert.ok(!wordsOf([blocks[0]!]).includes("not shown"));
	assert.deepEqual(blocks[1], { kind: "image", url: "kinkaku.jpg", alt: "Kinkaku-ji", width: 240 });
	assert.deepEqual(blocks[2], { kind: "embed", target: "itinerary.pdf" });
	assert.deepEqual(blocks[3], { kind: "image", url: "map.png", alt: "map.png", width: 300 });
	const callout = blocks[4] as Extract<Block, { kind: "quote" }>;
	assert.deepEqual([callout.alert, callout.title, wordsOf(callout.blocks)], ["cyan", "Go early", "the gates are empty"]);
	assert.equal(wordsOf([blocks[5]!]), "end");
});

test("ours on top: coloured words and an agent's suggestions with their reason", () => {
	const [p] = parseMarkdown("It is [not flexible]{.red}, ask about {~~Arashiyama~>Ohara~~}{>>quieter in November<<}, {++really ++}and {--very --}soon.");
	const runs = (p as Extract<Block, { kind: "paragraph" }>).runs;
	assert.deepEqual(runs.find((run) => run.colour), { text: "not flexible", colour: "red" });
	assert.deepEqual(runs.filter((run) => run.reason), [{ text: "Arashiyama", removed: true, reason: "quieter in November" }, { text: "Ohara", added: true, reason: "quieter in November" }]);
	assert.deepEqual(runs.find((run) => run.text === "really "), { text: "really ", added: true });
	assert.deepEqual(runs.find((run) => run.text === "very "), { text: "very ", removed: true });
	assert.equal(wordsOf([p!]).includes("{"), false);
});

test("a card goes to Obsidian without its colours and with open suggestions as the words they would replace", async () => {
	const { toObsidian } = await import("./card-syntax.ts");
	assert.equal(toObsidian("It is [not flexible]{.red}, ask about {~~Arashiyama~>Ohara~~}{>>quieter<<} {++new ++}and {--old --}==🟡x=="), "It is not flexible, ask about Arashiyama %%quieter%% and old ==🟡x==");
});

test("styled words carry a size and a face as well as a colour, underline is <u>, and Obsidian gets the words alone", async () => {
	const [p] = parseMarkdown("A [big serif]{.large .serif} word, [nested [inside]{.red}]{.mono}, and <u>under</u> it.");
	const runs = (p as Extract<Block, { kind: "paragraph" }>).runs;
	assert.deepEqual(runs.find((run) => run.text === "big serif"), { text: "big serif", size: "large", face: "serif" });
	assert.deepEqual(runs.find((run) => run.text === "inside"), { text: "inside", face: "mono", colour: "red" });
	assert.deepEqual(runs.find((run) => run.text === "under"), { text: "under", underline: true });
	const { toObsidian } = await import("./card-syntax.ts");
	assert.equal(toObsidian("A [big serif]{.large .serif} word, [nested [inside]{.red}]{.mono}."), "A big serif word, nested inside.");
});
