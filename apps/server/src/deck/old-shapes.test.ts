import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LATEST, runAtOpen } from "../migrations/index.ts";
import { Deck } from "./loader.ts";
import { closeOldShapes, openOldShapes, readsOldShapes } from "./old-shapes.ts";
import { parseDeckFile } from "./schema.ts";

const deckWith = (files: Record<string, string>) => {
	const deck = mkdtempSync(join(tmpdir(), "decks-old-shapes-"));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(deck, path, ".."), { recursive: true });
		writeFileSync(join(deck, path), text);
	}
	return deck;
};
const OLD_DECK_JSON = JSON.stringify({ version: 1, boards: { "boards/plan.html": { x: 40, y: 60 } } });

test("a deck at the latest version does not read shapes from before 0.1.0", () => {
	const deck = deckWith({ "deck.json": OLD_DECK_JSON, "boards/plan.html": "<title>Plan</title>", ".decks/migrations.json": JSON.stringify({ version: LATEST }) });
	runAtOpen(deck);
	assert.equal(readsOldShapes(deck), false, "no mark: the deck is up to date");
	const opened = Deck.open(deck);
	assert.equal(opened.readsOldShapes, false);
	// The places an old deck.json held are not read: nothing here is old enough to mean them.
	assert.deepEqual(parseDeckFile(OLD_DECK_JSON, { oldPlaces: opened.readsOldShapes }).arrangement, {});
	assert.deepEqual(parseDeckFile(OLD_DECK_JSON, { oldPlaces: true }).arrangement, { "boards/plan.html": { x: 40, y: 60 } });
	rmSync(deck, { recursive: true, force: true });
});

test("a deck opened from below 0.1.0 is marked, reads them, and stops once that run has ended cleanly", () => {
	const deck = deckWith({ "deck.json": OLD_DECK_JSON, "boards/plan.html": "<title>Plan</title>", "stages/wren/stage.pen": JSON.stringify({ version: "2.14", children: [] }) });
	assert.equal(readsOldShapes(deck), true, "a folder no Decks with versions has opened counts as old");
	runAtOpen(deck);
	const record = JSON.parse(readFileSync(join(deck, ".decks/migrations.json"), "utf8"));
	assert.equal(record.version, LATEST);
	assert.ok(record["old-shapes"]?.opened, "opened from before versions: marked");
	assert.equal(Deck.open(deck).readsOldShapes, true);
	// A second start before the first ended cleanly still reads them.
	runAtOpen(deck);
	assert.equal(readsOldShapes(deck), true);
	closeOldShapes(deck);
	assert.equal(readsOldShapes(deck), false);
	assert.equal(Deck.open(deck).readsOldShapes, false);
	// Closed stays closed: the deck is at the latest now, so no later start opens it again.
	runAtOpen(deck);
	assert.equal(readsOldShapes(deck), false);
	rmSync(deck, { recursive: true, force: true });
});

test("the mark is opened once, and closing a deck that has none writes nothing", () => {
	const deck = deckWith({ ".decks/migrations.json": JSON.stringify({ version: LATEST }) });
	closeOldShapes(deck);
	assert.deepEqual(JSON.parse(readFileSync(join(deck, ".decks/migrations.json"), "utf8")), { version: LATEST });
	openOldShapes(deck, new Date("2026-11-16T00:00:00Z"));
	openOldShapes(deck, new Date("2026-11-17T00:00:00Z"));
	assert.equal(JSON.parse(readFileSync(join(deck, ".decks/migrations.json"), "utf8"))["old-shapes"].opened, "2026-11-16T00:00:00.000Z");
	rmSync(deck, { recursive: true, force: true });
});
