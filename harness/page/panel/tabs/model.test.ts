import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsOf, drawnOf, itemLit, noAppsWords, noItemsWords } from "./model.ts";

// The Canvas tab lists cards apart from what is drawn; empty lists say why.

const card = { id: "c", kind: "board", label: "Plan", path: "cards/plan/index.html" } as never;
const note = { id: "n", kind: "note", label: "Note" } as never;

test("cards and drawn items are apart; a card is lit when it is the one open", () => {
	assert.deepEqual(cardsOf([card, note]), [card]);
	assert.deepEqual(drawnOf([card, note]), [note]);
	assert.equal(itemLit(card, new Set(), "canvases/x/cards/plan/index.html"), true);
	assert.equal(itemLit(note, new Set(["n"]), undefined), true);
	assert.equal(itemLit(note, new Set(), undefined), false);
});

test("an empty list says whether nothing matches or nothing is there", () => {
	assert.equal(noItemsWords(" "), "Nothing on this canvas yet.");
	assert.match(noItemsWords("x"), /matches “x”/);
	assert.equal(noAppsWords(undefined, ""), "Looking for apps…");
	assert.match(noAppsWords([], ""), /no apps yet/);
});
