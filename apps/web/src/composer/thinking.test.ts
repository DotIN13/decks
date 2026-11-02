import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelOption, ThinkingLevel } from "@decks/protocol";
import { levelsFor, nearestLevel, optionFor, THINKING_LEVELS } from "./thinking.ts";

const model = (provider: string, id: string, reasoning = true): ModelOption => ({ provider, model: id, label: id, reasoning });

test("a level the new model already offers survives the switch untouched", () => {
	assert.equal(nearestLevel("high", THINKING_LEVELS), "high");
	assert.equal(nearestLevel("off", ["off", "low", "high"]), "off");
});

test("a level the new model does not offer becomes the nearest one it does", () => {
	// The point of the whole function: `max` on a model that stops at `high` means `high`,
	// not the `medium` a silent reset would have given.
	assert.equal(nearestLevel("max", ["off", "low", "medium", "high"]), "high");
	assert.equal(nearestLevel("minimal", ["medium", "high", "max"]), "medium");
	assert.equal(nearestLevel("off", ["low", "medium"]), "low");
});

test("equal distances go to whichever the model lists first, the lower effort by convention", () => {
	// `low` and `high` are both one step from `medium`; the scale order in `supported` is
	// what decides, and the cheaper of the two is the better guess.
	assert.equal(nearestLevel("medium", ["low", "high"]), "low");
	assert.equal(nearestLevel("medium", ["high", "low"]), "high");
});

test("no level asked for, or one this build has never heard of, is read as medium", () => {
	assert.equal(nearestLevel(undefined, THINKING_LEVELS), "medium");
	assert.equal(nearestLevel(undefined, ["off", "low", "xhigh"]), "low");
	assert.equal(nearestLevel("nonsense" as ThinkingLevel, ["off", "medium", "max"]), "medium");
});

test("a model with no scale answers nothing, which is not the same as answering off", () => {
	// `undefined` tells the caller to send no level at all. Sending `off` would be a
	// standing instruction to a model that has no idea what to do with one.
	assert.equal(nearestLevel("high", []), undefined);
	assert.equal(nearestLevel(undefined, []), undefined);
});

test("levelsFor is all of the scale or none of it, which is all Decks' protocol can say", () => {
	assert.deepEqual(levelsFor(model("anthropic", "opus-5")), THINKING_LEVELS);
	assert.deepEqual(levelsFor(model("openai", "o-mini", false)), []);
	assert.deepEqual(levelsFor(undefined), []);
});

test("optionFor matches on provider and id together, because a name is not unique", () => {
	const models = [model("anthropic", "opus-5"), model("openai", "gpt-4", false), model("azure", "gpt-4")];
	assert.equal(optionFor(models, { provider: "azure", model: "gpt-4" })?.reasoning, true);
	assert.equal(optionFor(models, { provider: "openai", model: "gpt-4" })?.reasoning, false);
	assert.equal(optionFor(models, { provider: "openai", model: "opus-5" }), undefined);
	assert.equal(optionFor(models, undefined), undefined);
});
