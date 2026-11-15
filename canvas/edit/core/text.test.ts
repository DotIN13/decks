import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD, MARKDOWN, SHAPE, type PenDocument, type PenNode } from "@decks/pen";
import { FILE } from "../../model/file-kinds.ts";
import { cancelOps, cardInner, escapeKeeps, cardLook, cardOf, commitOf, emptyVanishes, enclosing, fileOf, labelBox, legacyCard, pictureUrls, shapeOf, textLook, type TextSession } from "./text.ts";

const font = (family: string, weight: number, italic: boolean) => `${family}/${weight}/${italic}`;
const palette = { paper: "#fff", fg: "#111" };
const node = (fields: Record<string, unknown>) => fields as unknown as PenNode;
const docOf = (...children: PenNode[]): PenDocument => ({ version: "2.6", children }) as PenDocument;
const STYLE = { font: "Inter/400/false", size: 14, weight: 400, italic: false, spacing: 0, line: undefined, align: "left" };

test("textLook sets a text, a note and a prompt as the canvas does", () => {
	const doc = docOf();
	// A text grows as wide as its words, with no padding, in dark ink on light.
	assert.deepEqual(textLook(doc, node({ id: "t", type: "text", content: "hi" }), undefined, "light", palette, font), { ...STYLE, pad: 0, ink: "#1f2328", grows: "wide" });
	// A fixed-width text grows down; its own fill is its ink.
	assert.deepEqual(textLook(doc, node({ id: "t", type: "text", content: "hi", textGrowth: "fixed-width", fontSize: 20, fill: "#ff0000" }), undefined, "dark", palette, font), {
		...STYLE,
		size: 20,
		pad: 0,
		ink: "rgba(255, 0, 0, 1)",
		grows: "tall",
	});
	// A note and a prompt: padded 16, on their paper.
	assert.deepEqual(textLook(doc, node({ id: "n", type: "note", content: "hi" }), undefined, "light", palette, font), { ...STYLE, pad: 16, ink: "#1f2328", paper: "#fde68a", grows: "tall" });
	assert.deepEqual(textLook(undefined, node({ id: "p", type: "prompt", content: "hi" }), undefined, "light", palette, font).paper, "#ddd6fe");
	// A markdown note card from before: the app's paper and words, typed as markdown.
	const look = textLook(doc, node({ id: "m", type: "rectangle", metadata: { type: MARKDOWN } }), undefined, "light", palette, font);
	assert.equal(look.paper, "#fff");
	assert.equal(look.ink, "#111");
	assert.equal(look.markdown, true);
});

test("cardLook is the first block's look on the card's padding and paper", () => {
	const doc = docOf();
	const card = node({ id: "c", type: "frame", layout: "vertical", padding: 24, fill: "#00ff00", metadata: { type: CARD }, children: [{ id: "b", type: "text", content: "# Hi", fontSize: 16 }] });
	assert.deepEqual(cardLook(doc, card, "dark", palette, font, 20), { ...STYLE, size: 16, pad: 24, ink: "#111", grows: "tall", paper: "rgba(0, 255, 0, 1)", markdown: true });
	// No padding of its own: the card's 20; no fill: the app's paper.
	const plain = cardLook(doc, node({ ...card, padding: undefined, fill: undefined }), "light", palette, font, 20);
	assert.equal(plain.pad, 20);
	assert.equal(plain.paper, "#fff");
});

test("what an item is part of: its shape, its card, its file", () => {
	const label = node({ id: "label", type: "text", content: "x" });
	const shape = node({ id: "shape", type: "frame", metadata: { type: SHAPE }, children: [node({ id: "outline", type: "path" }), label] });
	const block = node({ id: "block", type: "text", content: "y" });
	const card = node({ id: "card", type: "frame", metadata: { type: CARD }, children: [block] });
	const name = node({ id: "name", type: "text", content: "a.pdf" });
	const file = node({ id: "file", type: "frame", metadata: { type: FILE, path: "files/a.pdf" }, children: [node({ id: "tile", type: "frame", children: [name] })] });
	const pathless = node({ id: "bare", type: "frame", metadata: { type: FILE }, children: [] });
	const doc = docOf(shape, card, file, pathless, node({ id: "loose", type: "text", content: "z" }));

	assert.equal(shapeOf(doc, "shape"), "shape");
	assert.equal(shapeOf(doc, "label"), "shape");
	assert.equal(shapeOf(doc, "loose"), undefined);
	assert.equal(shapeOf(undefined, "shape"), undefined);
	assert.equal(cardOf(doc, "block")?.id, "card");
	assert.equal(cardOf(doc, "card"), undefined);
	// A file's chip from two levels in, and none for a chip with no path.
	assert.equal(fileOf(doc, "name")?.metadata.path, "files/a.pdf");
	assert.equal(fileOf(doc, "file")?.id, "file");
	assert.equal(fileOf(doc, "bare"), undefined);
	assert.equal(fileOf(doc, "loose"), undefined);
	assert.equal(enclosing(doc, "name", (one) => one.id === "tile")?.id, "tile");
});

test("a shape's new words, a card's width for words, and the pictures in markdown", () => {
	assert.deepEqual(labelBox({ x: 100, y: 50, w: 120, h: 80 }), { x: 110, y: 80, w: 100, h: 20 });
	// A narrow shape still gets 20 across.
	assert.deepEqual(labelBox({ x: 0, y: 0, w: 30, h: 10 }), { x: 10, y: -5, w: 20, h: 20 });
	const card = node({ id: "c", type: "frame", width: 300, padding: 12 });
	assert.equal(cardInner(card, undefined, 20), 276);
	assert.equal(cardInner(card, 400, 20), 376);
	assert.equal(cardInner(node({ id: "c", type: "frame" }), undefined, 20), 280);
	assert.equal(cardInner(node({ id: "c", type: "frame", width: 60 }), undefined, 20), 40);
	assert.deepEqual(pictureUrls("![a](pics/a.png) text ![[b.JPG|200]] ![[notes.md]] ![c](https://x.test/c.webp)"), ["pics/a.png", "b.JPG", "https://x.test/c.webp"]);
});

const session = (fields: Partial<TextSession>): TextSession => ({ id: "t", box: { x: 0, y: 0, w: 10, h: 10 }, value: "", style: { font: "", size: 14, weight: 400, italic: false, spacing: 0, align: "left", pad: 0, ink: "", grows: "wide" }, ...fields });

test("what putting the typing away writes", () => {
	const text = session({ kind: "text" });
	assert.deepEqual(commitOf(undefined, "x", undefined, true), { do: "close" });
	assert.deepEqual(commitOf(text, "x", "y", false), { do: "close" });
	// A fresh text left empty goes; a fresh note stays, empty.
	assert.deepEqual(commitOf({ ...text, fresh: true }, "  ", "", true), { do: "vanish", ops: [{ op: "delete", id: "t" }] });
	assert.deepEqual(commitOf(session({ kind: "note", fresh: true }), "", "", true), { do: "unchanged" });
	assert.deepEqual(commitOf(text, "same", "same", true), { do: "unchanged" });
	assert.deepEqual(commitOf(text, "new", "old", true), { do: "update", ops: [{ op: "update", id: "t", set: { content: "new" } }] });
	assert.deepEqual(commitOf(session({ card: true }), "# new", "# old", true), { do: "card" });
	assert.deepEqual(commitOf(session({ kind: "rectangle", legacy: true }), "new", "old", true), { do: "card" });
	// Escape: only a fresh text goes.
	assert.deepEqual(cancelOps({ ...text, fresh: true }), [{ op: "delete", id: "t" }]);
	assert.deepEqual(cancelOps(text), []);
	assert.deepEqual(cancelOps(session({ kind: "note", fresh: true })), []);
	assert.deepEqual(cancelOps(undefined), []);
	// …but a note, a card or a text just made keeps what was typed into it: Escape puts it away as a click elsewhere does.
	assert.equal(escapeKeeps(session({ kind: "note", fresh: true })), true);
	assert.equal(escapeKeeps(session({ card: true, fresh: true })), true);
	assert.equal(escapeKeeps(session({ kind: "text", fresh: true })), true);
	assert.equal(escapeKeeps(session({ kind: "note" })), false);
	assert.equal(escapeKeeps(undefined), false);
	// Kept, a fresh note's words are written, and a fresh text left empty still goes.
	assert.deepEqual(commitOf(session({ kind: "note", fresh: true }), "hello", "", true), { do: "update", ops: [{ op: "update", id: "t", set: { content: "hello" } }] });
	assert.equal(emptyVanishes({ kind: "text" }), true);
	assert.equal(emptyVanishes({ kind: "text", card: true }), false);
});

test("a note card from before becomes a card frame in its place", () => {
	const sizes = { gap: 16, pad: 20, radius: 12 };
	assert.deepEqual(legacyCard(node({ id: "old", type: "rectangle", x: 5, y: 6, width: 280, fill: "#eee", content: "words" }), sizes), {
		type: "frame",
		id: "old",
		name: "Card",
		x: 5,
		y: 6,
		width: 280,
		layout: "vertical",
		gap: 16,
		padding: 20,
		cornerRadius: 12,
		fill: "#eee",
		metadata: { type: CARD },
		children: [],
	});
	assert.deepEqual(legacyCard(node({ id: "old", type: "rectangle", name: "Mine" }), sizes), { type: "frame", id: "old", name: "Mine", width: 320, layout: "vertical", gap: 16, padding: 20, cornerRadius: 12, metadata: { type: CARD }, children: [] });
});
