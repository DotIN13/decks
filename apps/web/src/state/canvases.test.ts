import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasRow } from "@decks/protocol";
import { searchCanvases } from "./canvases.ts";

/**
 * What the manager's field matches, and the rule that it never shortens the list: a canvas that
 * does not match is dimmed where it stands, so the wall keeps its shape while you type.
 */
const row = (name: string, words: string, agents: string[] = []): CanvasRow => ({
	name,
	title: name,
	cards: 3,
	rev: 1,
	words,
	agents: agents.map((who) => ({ id: who, name: who, color: "#000" })),
});

const LIST = [row("deploy", "restart prod systemd", ["Ada"]), row("cold-war", "khrushchev archive", []), row("political-llm", "photos judge", ["Iris"])];

test("a query matches the name, the words in the canvas, and who is on it", () => {
	assert.deepEqual(searchCanvases(LIST, "cold").filter((one) => one.hit).map((one) => one.canvas.name), ["cold-war"]);
	assert.deepEqual(searchCanvases(LIST, "khrushchev").filter((one) => one.hit).map((one) => one.canvas.name), ["cold-war"]);
	assert.deepEqual(searchCanvases(LIST, "iris").filter((one) => one.hit).map((one) => one.canvas.name), ["political-llm"]);
	assert.deepEqual(searchCanvases(LIST, "PROD").filter((one) => one.hit).map((one) => one.canvas.name), ["deploy"]);
});

test("the list never gets shorter, and no query matches everything", () => {
	assert.equal(searchCanvases(LIST, "cold").length, 3, "three rows either way: the misses are dimmed, not dropped");
	assert.equal(searchCanvases(LIST, "   ").filter((one) => one.hit).length, 3);
	assert.equal(searchCanvases(LIST, "nothing here").filter((one) => one.hit).length, 0);
});
