import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasFolder, cardOf, deckPathOk, isCardPath, ownerFolderBase, referenceFor, resolveReference } from "./layout.ts";

// The deck's layout rules, from their sentences, in the order layout.ts states them.

test("file calls reach only the deck, and nothing hidden", () => {
	assert.ok(deckPathOk("docs/a.md"));
	assert.ok(!deckPathOk("../etc/passwd"));
	assert.ok(!deckPathOk("/etc/passwd"));
	assert.ok(!deckPathOk(".git/config"));
});

test("a canvas points at its own parts and the deck's assets, docs and apps", () => {
	assert.deepEqual(resolveReference("plan", "cards/a/index.html"), { path: "canvases/plan/cards/a/index.html" });
	assert.deepEqual(resolveReference("plan", "assets/x.png"), { path: "assets/x.png" });
	assert.ok("refused" in resolveReference("plan", "../other/cards/a/index.html"));
	assert.ok("refused" in resolveReference("plan", ".decks/x"));
	assert.ok("refused" in resolveReference("plan", "https://example.com/x"));
});

test("a friend's canvas reads its own copies, and no apps", () => {
	assert.deepEqual(resolveReference("shared/ann/plan", "docs/a.md"), { path: "shared/canvases/ann/plan/docs/a.md" });
	assert.ok("refused" in resolveReference("shared/ann/plan", "apps/x/index.html"));
	assert.equal(ownerFolderBase("Ann Lee!"), "ann-lee");
});

test("referenceFor is resolveReference turned round", () => {
	assert.deepEqual(referenceFor("plan", "canvases/plan/files/a.png"), { path: "files/a.png" });
	assert.ok("refused" in referenceFor("plan", "canvases/other/files/a.png"));
	assert.equal(canvasFolder("shared/ann/plan"), "shared/canvases/ann/plan");
});

test("a card is cards/<name>/index.html, and its files belong to it", () => {
	assert.ok(isCardPath("canvases/plan/cards/a/index.html"));
	assert.ok(!isCardPath("canvases/plan/cards/a/b.html"));
	assert.equal(cardOf("canvases/plan/cards/a/chart.js"), "canvases/plan/cards/a/index.html");
});
