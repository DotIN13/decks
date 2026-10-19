import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_MAX_W, clipOptions, colourName, inlineMarkdown, landingOf, landOps, partsOfClip, partsOfHtml, partsOfText, readClip, type Clip, type Placed, type Tree } from "./clip.ts";

const clip = (tree: Tree[], more: Partial<Clip> = {}): Clip => ({ v: 1, board: "boards/plan.html", block: "doc", scale: 1, fontSize: 15, width: 300, height: 40, inside: ["p", "div"], tree, ...more });
const at = { x: 100, y: 200 };
const none = () => undefined;
type Insert = { op: "insert"; node: Record<string, unknown> & { children?: Array<Record<string, unknown>> }; box?: Record<string, number>; parent?: string; index?: number };
const land = (c: Clip, zoom = 1, placed: (p: unknown) => Placed | undefined = none, into?: { card: string; index: number; inner: number }) =>
	landOps(partsOfClip(c), { ...clipOptions(c, zoom), at, id: "new", placed, ...(into ? { into } : {}) }) as unknown as Insert[];

test("words keep bold, italic, links and inline code, and land as a text item at their size", () => {
	const c = clip(["Each tile made the engine ", { t: "b", k: ["redraw "] }, { t: "em", k: ["twice"] }, ", see ", { t: "a", a: { href: "https://x.dev/a" }, k: ["the notes"] }, " and ", { t: "code", k: ["samples_for"] }, "."]);
	const [op] = land(c);
	assert.equal(op!.node.type, "text");
	assert.equal(op!.node.content, "Each tile made the engine **redraw** *twice*, see [the notes](https://x.dev/a) and `samples_for`.");
	assert.equal(op!.node.fontSize, 15);
	assert.deepEqual(op!.node.metadata, { type: "decks.markdown", source: { board: "boards/plan.html", block: "doc" } });
	assert.equal(op!.box!.x1, 100);
	assert.ok(op!.box!.x2! - 100 >= 300, "at least as wide as on the board");
});

test("a heading is a text item at the heading's size, its level kept", () => {
	const c = clip(["Why pans stalled"], { inside: ["h2", "div"], fontSize: 26 });
	const [op] = land(c);
	assert.equal(op!.node.content, "## Why pans stalled");
	// The engine draws an h2 1.3 times its words: 26 on the board is 20 here.
	assert.equal(op!.node.fontSize, 20);
	assert.equal(landingOf(partsOfClip(c), clipOptions(c, 1)).label, "text item, heading");
});

test("the size on screen: a board drawn at half size on a canvas at 0.5 zoom lands at its own size", () => {
	const c = clip(["words"], { scale: 0.5, fontSize: 20, width: 200 });
	const [op] = land(c, 0.5);
	assert.equal(op!.node.fontSize, 20);
	const [big] = land({ ...c, scale: 1 }, 0.5);
	assert.equal(big!.node.fontSize, 40, "a board shown twice as big as the canvas's zoom lands twice as big");
});

test("two items of a list make a card with that list", () => {
	const c = clip([{ t: "li", k: ["Tiles painted once"] }, { t: "li", k: ["One sample when ", { t: "strong", k: ["idle"] }] }], { inside: ["ul", "div"] });
	const ops = land(c);
	assert.equal(ops.length, 1);
	const card = ops[0]!.node;
	assert.equal(card.type, "frame");
	assert.equal((card.metadata as { type: string }).type, "decks.card");
	assert.equal(card.layout, "vertical");
	assert.equal(card.children!.length, 1);
	assert.equal(card.children![0]!.content, "- Tiles painted once\n- One sample when **idle**");
	assert.equal(landingOf(partsOfClip(c), clipOptions(c, 1)).label, "card · list");
});

test("numbered lists stay numbered, tasks keep their ticks, nesting is indented", () => {
	const [part] = partsOfHtml([{ t: "ol", k: [{ t: "li", k: ["one", { t: "ul", k: [{ t: "li", a: { task: "x" }, k: ["done"] }] }] }, { t: "li", k: ["two"] }] }]);
	assert.equal(part!.kind, "list");
	assert.equal((part as { markdown: string }).markdown, "1. one\n   - [x] done\n2. two");
});

test("two rows of a table get the header row they sat under", () => {
	const row = (a: string, b: string, c: string): Tree => ({ t: "tr", k: [{ t: "td", a: { col: "0" }, k: [a] }, { t: "td", a: { col: "1" }, k: [b] }, { t: "td", a: { col: "2", align: "right" }, k: [c] }] });
	const head: Tree = { t: "tr", k: [{ t: "th", a: { col: "0" }, k: ["Stage"] }, { t: "th", a: { col: "1" }, k: ["Before"] }, { t: "th", a: { col: "2" }, k: ["After"] }] };
	const c = clip([row("Herobrine", "58 ms", "9 ms"), row("Rust", "41 ms", "7 ms")], { inside: ["tbody", "table", "div"], head });
	const card = land(c)[0]!.node;
	assert.equal(card.children![0]!.content, "| Stage | Before | After |\n| --- | --- | ---: |\n| Herobrine | 58 ms | 9 ms |\n| Rust | 41 ms | 7 ms |");
});

test("some cells of a row take the header cells over their columns", () => {
	const head: Tree = { t: "tr", k: ["Stage", "Before", "After"].map((w, i) => ({ t: "th", a: { col: String(i) }, k: [w] })) };
	const c = clip([{ t: "td", a: { col: "1" }, k: ["58 ms"] }, { t: "td", a: { col: "2" }, k: ["9 ms"] }], { inside: ["tr", "tbody", "table"], head });
	assert.equal((partsOfClip(c)[0] as { markdown: string }).markdown, "| Before | After |\n| --- | --- |\n| 58 ms | 9 ms |");
});

test("words inside one cell are words", () => {
	const c = clip(["58"], { inside: ["td", "tr", "tbody", "table"] });
	assert.equal(land(c)[0]!.node.type, "text");
});

test("a very wide table lands in a card 900 wide", () => {
	const c = clip([{ t: "tr", k: [{ t: "td", k: ["a"] }] }, { t: "tr", k: [{ t: "td", k: ["b"] }] }], { inside: ["tbody", "table"], width: 1600 });
	assert.equal(land(c)[0]!.box!.x2! - 100, CARD_MAX_W);
});

test("code keeps its language, in a fence", () => {
	const c = clip([{ t: "pre", a: { lang: "rust" }, k: ["fn samples_for(cmd: &Cmd) -> u32 {\n    if cmd.is_mesh() { 4 } else { 1 }\n}\n"] }], { inside: ["div"], lang: "rust" });
	const card = land(c)[0]!.node;
	assert.equal(card.children![0]!.content, "```rust\nfn samples_for(cmd: &Cmd) -> u32 {\n    if cmd.is_mesh() { 4 } else { 1 }\n}\n```");
	assert.equal(landingOf(partsOfClip(c), clipOptions(c, 1)).label, "card · code, rust");
	// Words picked inside the code are that code.
	const part = partsOfClip(clip(["is_mesh()"], { inside: ["span", "code", "pre"], lang: "rust" }))[0] as { markdown: string };
	assert.equal(part.markdown, "```rust\nis_mesh()\n```");
});

test("a quote and a callout stay what they were", () => {
	assert.equal((partsOfClip(clip(["Measured on the iPad mini."], { inside: ["blockquote"] }))[0] as { markdown: string }).markdown, "> Measured on the iPad mini.");
	const warn = partsOfHtml([{ t: "div", a: { class: "callout", tone: "warn" }, k: [{ t: "p", k: ["Careful."] }] }])[0] as { markdown: string };
	assert.equal(warn.markdown, "> [!warning]\n> Careful.");
});

test("a selection across blocks is a card of each part in order", () => {
	const c = clip(
		[
			{ t: "h3", k: ["Why pans stalled"] },
			{ t: "p", k: ["Each new tile."] },
			{ t: "ul", k: [{ t: "li", k: ["a"] }, { t: "li", k: ["b"] }] },
			{ t: "blockquote", k: ["Measured."] },
		],
		{ inside: ["div"] },
	);
	const card = land(c)[0]!.node;
	assert.deepEqual(
		card.children!.map((child) => child.content),
		["### Why pans stalled", "Each new tile.", "- a\n- b", "> Measured."],
	);
	assert.ok(card.children!.every((child) => child.fontSize === 15 && child.width === "fill_container"));
	assert.equal(landingOf(partsOfClip(c), clipOptions(c, 1)).label, "card · 4 parts");
});

test("a picture is an image item at its size on screen, its alt text its name, remembering its board", () => {
	const c = clip([{ t: "img", a: { src: "http://h/api/board/assets/chart.png", path: "assets/chart.png", alt: "Frame times", w: "170", h: "75" } }], { inside: [] });
	const placed = (p: unknown) => ((p as { path?: string }).path ? { url: `../../${(p as { path: string }).path}` } : undefined);
	const [op] = land(c, 2, placed as never);
	assert.equal(op!.node.type, "rectangle");
	assert.equal(op!.node.name, "Frame times");
	assert.deepEqual(op!.node.fill, { type: "image", url: "../../assets/chart.png", mode: "fill" });
	assert.deepEqual(op!.node.metadata, { source: { board: "boards/plan.html", block: "doc" } });
	// On a canvas at zoom 2 a board drawn at 1 was half as big on screen: it lands half as big.
	assert.deepEqual(op!.box, { x1: 100, y1: 200, x2: 185, y2: 238 });
	assert.equal(land(c, 1, none).length, 0, "a picture nobody placed is left out");
});

test("an SVG lands shown live, a film as the canvas's player", () => {
	const svg = clip([{ t: "svg", a: { svg: "<svg/>", w: "340", h: "150", alt: "chart" } }], { inside: [] });
	const [op] = land(svg, 1, () => ({ url: "../../assets/chart-still.png", file: "assets/chart.svg", still: "assets/chart-still.png" }));
	assert.equal((op!.node.metadata as { type: string }).type, "decks.live-file");
	assert.equal((op!.node.metadata as { file: string }).file, "assets/chart.svg");
	const film = clip([{ t: "video", a: { src: "x", path: "assets/a.mp4", w: "320", h: "180" } }], { inside: [] });
	const [player] = land(film, 1, () => ({ url: "../../assets/a.jpg", file: "assets/a.mp4", media: { kind: "video", poster: "assets/a.jpg", seconds: 3 } }));
	assert.equal((player!.node.metadata as { type: string }).type, "decks.media");
	assert.equal(player!.box!.x2! - 100, 320);
});

test("a drop on a card is a block at the slot", () => {
	const ops = land(clip([{ t: "li", k: ["x"] }, { t: "li", k: ["y"] }], { inside: ["ul"] }), 1, none, { card: "plan", index: 2, inner: 280 });
	assert.equal(ops.length, 1);
	assert.equal(ops[0]!.parent, "plan");
	assert.equal(ops[0]!.index, 2);
	assert.equal(ops[0]!.node.content, "- x\n- y");
	const pic = land(clip([{ t: "img", a: { path: "assets/p.png", w: "600", h: "300" } }], { inside: [] }), 1, () => ({ url: "../../assets/p.png" }), { card: "plan", index: 0, inner: 280 });
	assert.equal(pic[0]!.node.width, 280, "a picture is never wider than the card's words");
	assert.equal(pic[0]!.node.height, 140);
});

test("a colour that matches one of the canvas's colours becomes it; a grey is dropped", () => {
	assert.equal(colourName("#e5484d"), "red");
	assert.equal(colourName("#3b5cf6"), "blue");
	assert.equal(colourName("#15803d"), "green");
	assert.equal(colourName("#5c5c5c"), undefined);
	assert.equal(inlineMarkdown(["a ", { t: "span", c: "#d92e3c", k: ["not flexible"] }, " b"]), "a [not flexible]{.red} b");
	assert.equal(inlineMarkdown([{ t: "span", c: "#777777", k: ["grey"] }]), "grey");
});

test("words that look like markdown stay words", () => {
	assert.equal(inlineMarkdown(["2 * 3 = [six] and snake_case"]), "2 \\* 3 = \\[six\\] and snake\\_case");
	assert.equal(inlineMarkdown(["# not a heading"]), "\\# not a heading");
});

test("pasted markdown is read: lists, tables, fenced code and headings", () => {
	const parts = partsOfText("# Plan\n\nSome words\nover two lines.\n\n- one\n- two\n\n  - nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n> [!tip] Note\n> body");
	assert.deepEqual(
		parts.map((part) => part.kind),
		["heading", "text", "list", "table", "code", "quote"],
	);
	assert.equal((parts[2] as { markdown: string }).markdown, "- one\n- two\n  - nested");
	assert.equal((parts[4] as { markdown: string }).markdown, "```ts\nconst x = 1;\n```");
	const ops = landOps(parts, { k: 1, at, id: "p", placed: none }) as unknown as Insert[];
	assert.equal(ops[0]!.node.type, "frame");
	assert.equal(ops[0]!.node.children!.length, 6);
	assert.equal(ops[0]!.box!.x2! - 100, 480, "a card with a table or code is 480 wide");
});

test("plain text is a text item; several paragraphs make a card", () => {
	const one = landOps(partsOfText("Just a sentence."), { k: 1, at, id: "t", placed: none }) as unknown as Insert[];
	assert.equal(one[0]!.node.type, "text");
	assert.equal(one[0]!.node.fontSize, 24);
	const two = landOps(partsOfText("First paragraph.\n\nSecond one."), { k: 1, at, id: "t", placed: none }) as unknown as Insert[];
	assert.equal(two[0]!.node.type, "frame");
	assert.equal(two[0]!.node.children!.length, 2);
});

test("pasted as plain text, nothing in it means anything", () => {
	const parts = partsOfText("- not a list *really*\nsecond line", true);
	assert.equal(parts.length, 1);
	assert.equal((parts[0] as { markdown: string }).markdown, "\\- not a list \\*really\\*\\\nsecond line");
});

test("HTML from another app goes through the same walk", () => {
	const parts = partsOfHtml([{ t: "body", k: [{ t: "h1", k: ["Title"] }, { t: "div", k: ["inline ", { t: "b", k: ["bold"] }] }, { t: "table", k: [{ t: "tbody", k: [{ t: "tr", k: [{ t: "td", k: ["a|b"] }] }] }] }] }]);
	assert.deepEqual(
		parts.map((part) => [part.kind, (part as { markdown?: string }).markdown]),
		[
			["heading", "Title"],
			["text", "inline **bold**"],
			["table", "| a\\|b |\n| --- |"],
		],
	);
});

test("a clip is read only when it is one", () => {
	assert.equal(readClip("nope"), undefined);
	assert.equal(readClip(JSON.stringify({ v: 2, tree: [] })), undefined);
	assert.ok(readClip(JSON.stringify({ v: 1, tree: ["x"] })));
	assert.equal(clipOptions(clip(["x"], { scale: 0.5 }), 0.25).k, 2);
});
