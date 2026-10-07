import assert from "node:assert/strict";
import { test } from "node:test";
import type { PenNode } from "@decks/pen";
import { cardChildren, cardEdits, cardMarkdown, fileItem, markdownText, newCard, obsidianNote } from "./card-frame.ts";

let n = 0;
const options = { fresh: () => `new-${++n}`, inner: 288, size: (url: string) => (url === "wide.png" ? { w: 600, h: 300 } : undefined) };

test("a card's markdown is split into one item per block, a picture as an image-filled rectangle", () => {
	n = 0;
	const kids = cardChildren("# Plan\n\nWords, ==🟡marked==.\n\n![Gate|200](gate.png)\n\n- one\n- two\n\n![[wide.png]]", [], options);
	assert.deepEqual(kids.map((k) => k.type), ["text", "text", "rectangle", "text", "rectangle"]);
	assert.deepEqual(kids.map((k) => k.content), ["# Plan", "Words, ==🟡marked==.", undefined, "- one\n- two", undefined]);
	assert.deepEqual([kids[2]!.width, kids[2]!.height, kids[2]!.name, (kids[2]!.fill as { url: string }).url], [200, 113, "Gate", "gate.png"]);
	// A picture is never wider than the card's words, and keeps its own shape when it is known.
	assert.deepEqual([kids[4]!.width, kids[4]!.height], [288, 144]);
	assert.equal(kids[0]!.metadata?.type, "decks.markdown");
});

test("an edit keeps every untouched block as the same item, and the changed one keeps its id", () => {
	n = 0;
	const before = cardChildren("# Plan\n\nFirst.\n\nSecond.", [], options);
	const after = cardChildren("# Plan\n\nFirst, changed.\n\nSecond.", before, options);
	assert.equal(after[0], before[0]);
	assert.equal(after[2], before[2]);
	assert.deepEqual([after[1]!.id, after[1]!.content], [before[1]!.id, "First, changed."]);
	const added = cardChildren("# Plan\n\nFirst.\n\nNew.\n\nSecond.", before, options);
	assert.deepEqual(added.map((k) => k.id), [before[0]!.id, before[1]!.id, "new-4", before[2]!.id]);
});

test("the markdown and the items go round: a picture written back with its width, a sticky note held in place", () => {
	const note = { type: "note", id: "sticky", name: "Sticky", content: "hi" } as PenNode;
	const kids = [markdownText("a", "# Plan"), { type: "rectangle", id: "p", name: "Gate", width: 200, height: 100, fill: { type: "image", url: "gate.png", mode: "fill" } } as PenNode, note];
	const md = cardMarkdown(kids);
	assert.equal(md, "# Plan\n\n![Gate|200](gate.png)\n\n<!--decks:item sticky-->");
	const back = cardChildren(md, kids, options);
	assert.deepEqual(back, kids);
	assert.deepEqual(cardChildren("# Plan\n\n![Gate|200](gate.png)", kids, options).map((k) => k.id), ["a", "p"]);
});

test("a new card is a column frame with one empty block", () => {
	const card = newCard("c", "t");
	assert.deepEqual([card.type, card.layout, card.metadata?.type, card.children?.length, card.children?.[0]?.metadata?.type], ["frame", "vertical", "decks.card", 1, "decks.markdown"]);
});

test("a save is one edit per item that changed: delete, insert, move and update, and nothing for the rest", () => {
	n = 0;
	const before = cardChildren("# Plan\n\nFirst.\n\nSecond.\n\nThird.", [], options);
	const [h, a, b, c] = before.map((k) => k.id);
	assert.deepEqual(cardEdits("card", before, cardChildren("# Plan\n\nFirst.\n\nSecond.\n\nThird.", before, options)), []);
	assert.deepEqual(cardEdits("card", before, cardChildren("# Plan\n\nFirst, changed.\n\nSecond.\n\nThird.", before, options)), [{ op: "update", id: a, set: { content: "First, changed." } }]);
	assert.deepEqual(cardEdits("card", before, cardChildren("# Plan\n\nSecond.\n\nThird.", before, options)), [{ op: "delete", id: a }]);
	const added = cardChildren("# Plan\n\nFirst.\n\nNew.\n\nSecond.\n\nThird.", before, options);
	assert.deepEqual(cardEdits("card", before, added), [{ op: "insert", parent: "card", index: 2, node: added[2] }]);
	assert.deepEqual(cardEdits("card", before, cardChildren("# Plan\n\nThird.\n\nFirst.\n\nSecond.", before, options)), [{ op: "move", id: c, parent: "card", index: 1 }]);
	void h; void b;
});

test("a card goes to Obsidian as one note: colour and open suggestions out, pictures kept, other items left out", () => {
	const card = { type: "frame", id: "c", metadata: { type: "decks.card" }, children: [markdownText("a", "# Plan"), markdownText("b", "It is [firm]{.red}, ask about {~~Arashiyama~>Ohara~~}{>>quieter<<}."), { type: "rectangle", id: "p", name: "Gate", width: 200, height: 100, fill: { type: "image", url: "gate.png", mode: "fill" } }, { type: "note", id: "n", content: "x" }] } as PenNode;
	assert.equal(obsidianNote(card), "# Plan\n\nIt is firm, ask about Arashiyama %%quieter%%.\n\n![Gate|200](gate.png)\n");
});

test("a file is a piece of its own: ![[name]] alone on its line is a file chip, and the chip is ![[name]] again", () => {
	n = 0;
	const kids = cardChildren("# Plan\n\n![[assets/itinerary.pdf]]\n\nWords with ![[inline.pdf]] in them.", [], options);
	assert.deepEqual(kids.map((k) => [k.type, k.metadata?.type]), [["text", "decks.markdown"], ["frame", "decks.file"], ["text", "decks.markdown"]]);
	assert.deepEqual([kids[1]!.name, kids[1]!.metadata?.path, kids[1]!.children?.map((c) => c.type)], ["itinerary.pdf", "assets/itinerary.pdf", ["icon", "text"]]);
	assert.equal(cardMarkdown(kids), "# Plan\n\n![[assets/itinerary.pdf]]\n\nWords with ![[inline.pdf]] in them.");
	// Saved again unchanged, the chip is the same item.
	assert.equal(cardChildren(cardMarkdown(kids), kids, options)[1], kids[1]);
	const film = { type: "rectangle", id: "f", metadata: { type: "decks.media", kind: "video", file: "assets/walk.mp4" } } as PenNode;
	assert.equal(cardMarkdown([film]), "![[assets/walk.mp4]]");
	assert.equal(fileItem("a/b.mp3", () => "x").children?.[0]?.icon, "file-video");
});
