import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caller } from "../../protocol/index.ts";
import { testServer } from "../kernel/testing.ts";
import type { ItemOp } from "../kernel/types.ts";
import { canvasFeature } from "./feature.ts";
import type { CanvasStore } from "./store.ts";
import { DECK, stickerFeature } from "./test-deck.ts";

// Every edit the canvas frame makes to its own items, through its pass, passes the pass's rule
// (README rule 9): each kind of item the fixture holds, moved, set, copied, put back, deleted.

const person: Caller = { kind: "person", id: "person", name: "you" };
const ITEMS = [
	{ type: "sticker", id: "card1", path: "canvases/plan/cards/s1/index.html" },
	{ type: "frame", id: "md1", layout: "vertical", width: 360, metadata: { type: "decks.markdown-card" }, children: [
		{ type: "text", id: "md1-t", content: "# Kyoto", metadata: { type: "decks.markdown" } },
		{ type: "frame", id: "md1-chip", name: "itinerary.pdf", metadata: { type: "decks.file", path: "itinerary.pdf" }, children: [{ type: "text", id: "md1-chip-t", content: "itinerary.pdf" }] },
	] },
	{ type: "note", id: "note1", content: "![[itinerary.pdf]] and [[Mei Tanaka]]" },
	{ type: "text", id: "text1", content: "words" },
	{ type: "browser", id: "doc1", url: "../../papers/paper.md", metadata: { type: "decks.document", path: "papers/paper.md" } },
	{ type: "browser", id: "app1", url: "/app/review/", metadata: { type: "decks.app", name: "review" } },
	{ type: "rectangle", id: "pic1", width: 200, height: 100, fill: { type: "image", url: "files/a.png", mode: "fill" } },
	{ type: "path", id: "arrow1", metadata: { type: "decks.arrow", from: "note1", to: "text1" } },
	{ type: "frame", id: "frame1", width: 300, height: 200, children: [{ type: "note", id: "frame1-n", content: "inside" }] },
	{ type: "ref", id: "ref1", ref: "frames/chip" },
];

async function placed() {
	const canvas = canvasFeature();
	const s = await testServer({ features: [canvas, stickerFeature()], deck: { ...DECK, "papers/paper.md": "# Paper" } });
	const doc = (canvas.canvases!(s.kernel) as CanvasStore).doc("plan");
	ITEMS.forEach((item, i) => doc.apply([{ op: "insert", item: item as never, at: { x: (i % 5) * 500, y: 600 + Math.floor(i / 5) * 400 } }], person));
	const pass = (ops: unknown[]) => doc.apply(ops as ItemOp[], person, undefined, true);
	return { s, doc, pass };
}

for (const { id, type } of ITEMS) {
	test(`the frame's edits to its own ${type} (${id}) pass through a pass`, async () => {
		const { s, doc, pass } = await placed();
		const node = () => structuredClone(doc.pen().children.find((n) => n.id === id)!) as Record<string, unknown>;
		pass([{ op: "move", id, at: { x: 40, y: 3000 } }]);
		pass([{ op: "update", id, set: { name: "renamed" } }]);
		pass([{ op: "copy", id, at: { x: 600, y: 3000 } }]);
		// Put back as itself (pen refuses a replace that reuses the children's ids, for anyone).
		if (!node().children) pass([{ op: "replace", id, item: node() as never }]);
		const { x: _x, y: _y, ...again } = node();
		pass([{ op: "delete", id }, { op: "insert", item: again as never, at: { x: 40, y: 3400 } }]);
		pass([{ op: "delete", id }]);
		await s.close();
	});
}

test("the frame turning a note into a markdown card, its embed a file chip by bare name, passes through a pass", async () => {
	const { s, doc, pass } = await placed();
	pass([{ op: "replace", id: "note1", item: { type: "frame", layout: "vertical", width: 360, metadata: { type: "decks.markdown-card" }, children: [
		{ type: "frame", id: "chip2", name: "budget.pdf", metadata: { type: "decks.file", path: "budget.pdf" }, children: [] },
		{ type: "text", id: "t2", content: "and [[Mei Tanaka]]", metadata: { type: "decks.markdown" } },
	] } }]);
	assert.equal(doc.pen().children.find((n) => n.id === "note1")?.type, "frame");
	await s.close();
});
