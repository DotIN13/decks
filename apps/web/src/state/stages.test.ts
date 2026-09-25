import assert from "node:assert/strict";
import { test } from "node:test";
import type { StageRow } from "@decks/protocol";
import { searchStages } from "./stages.ts";

/**
 * What the manager's field matches, and the rule that it never shortens the list: a stage that
 * does not match is dimmed where it stands, so the wall keeps its shape while you type.
 */
const row = (name: string, words: string, agents: string[] = []): StageRow => ({
	name,
	boards: 3,
	rev: 1,
	words,
	agents: agents.map((who) => ({ id: who, name: who, color: "#000" })),
});

const LIST = [row("deploy", "restart prod systemd", ["Ada"]), row("cold-war", "khrushchev archive", []), row("political-llm", "photos judge", ["Iris"])];

test("a query matches the name, the words in the stage, and who is on it", () => {
	assert.deepEqual(searchStages(LIST, "cold").filter((one) => one.hit).map((one) => one.stage.name), ["cold-war"]);
	assert.deepEqual(searchStages(LIST, "khrushchev").filter((one) => one.hit).map((one) => one.stage.name), ["cold-war"]);
	assert.deepEqual(searchStages(LIST, "iris").filter((one) => one.hit).map((one) => one.stage.name), ["political-llm"]);
	assert.deepEqual(searchStages(LIST, "PROD").filter((one) => one.hit).map((one) => one.stage.name), ["deploy"]);
});

test("the list never gets shorter, and no query matches everything", () => {
	assert.equal(searchStages(LIST, "cold").length, 3, "three rows either way: the misses are dimmed, not dropped");
	assert.equal(searchStages(LIST, "   ").filter((one) => one.hit).length, 3);
	assert.equal(searchStages(LIST, "nothing here").filter((one) => one.hit).length, 0);
});
