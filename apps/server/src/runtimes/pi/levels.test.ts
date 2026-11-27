import assert from "node:assert/strict";
import { test } from "node:test";
import { levelFor, levelsOf } from "./backend.ts";

/** DeepSeek v4.1 Flash as pi describes it: low, high and max, nothing else. */
const deepseek = { thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" } };

test("a pi model's levels are the ones its map does not null out, in scale order", () => {
	assert.deepEqual(levelsOf(deepseek), ["low", "high", "max"]);
	assert.equal(levelsOf({}), undefined, "no map: pi says nothing, and every level is offered");
});

test("a level the model takes is set as asked; one it lacks goes to the nearest it has, so Decks records what runs", () => {
	assert.equal(levelFor(deepseek, "high"), "high");
	assert.equal(levelFor(deepseek, "xhigh"), "high", "xhigh is nearer high than max");
	assert.equal(levelFor(deepseek, "medium"), "low", "a tie goes to the cheaper level, as nearestLevel says");
	assert.equal(levelFor({}, "medium"), "medium", "no map: passed on as asked");
});
