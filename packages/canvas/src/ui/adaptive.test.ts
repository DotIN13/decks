import assert from "node:assert/strict";
import { test } from "node:test";
import { DECKS_COLORS } from "@decks/pen";
import { ADAPTIVE, sameColor } from "./adaptive.ts";

test("the picker's Adaptive rows hold every Decks colour once, by role, and an old name is the same colour as its new one", () => {
	assert.deepEqual(ADAPTIVE.flat().sort(), Object.keys(DECKS_COLORS).sort());
	assert.deepEqual(ADAPTIVE.map((row) => row[0]), ["decks-text", "decks-fill-slate", "decks-fill-red", "decks-accent-red"]);
	assert.ok(sameColor("$decks-ink", "$decks-text"), "a stored $decks-ink shows Text selected");
	assert.ok(sameColor("$decks-card", "$decks-surface"));
	assert.ok(!sameColor("$decks-ink", "$decks-text-muted"));
	assert.ok(sameColor("#ff0000", "#ff0000"));
	assert.ok(!sameColor("$brand", "$decks-text"));
});
