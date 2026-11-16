import assert from "node:assert/strict";
import { test } from "node:test";
import { deckPathEdits } from "./drawing-read.ts";

// A card's path as the frame keys it: from the deck's root, in the canvas's own folder, a friend's included.

const insert = (path: string) => ({ op: "insert" as const, id: "c", parent: null, after: null, list: false, props: { type: "browser", metadata: { type: "decks.card", path } } });
const pathOf = (edit: ReturnType<typeof deckPathEdits>[number]) => ((edit as unknown as { props: { metadata: { path: string } } }).props.metadata.path);

test("a card on the person's own canvas is named from canvases/<name>", () => {
	assert.equal(pathOf(deckPathEdits("plan", [insert("cards/one/index.html")])[0]!), "canvases/plan/cards/one/index.html");
});

test("a card on a friend's canvas is named from shared/canvases/<owner>/<name>, never canvases/shared/…", () => {
	assert.equal(pathOf(deckPathEdits("shared/ada/old-notes", [insert("cards/one/index.html")])[0]!), "shared/canvases/ada/old-notes/cards/one/index.html");
});

test("a path already from the deck's root is left as it is", () => {
	assert.equal(pathOf(deckPathEdits("plan", [insert("shared/canvases/ada/old-notes/cards/one/index.html")])[0]!), "shared/canvases/ada/old-notes/cards/one/index.html");
});
