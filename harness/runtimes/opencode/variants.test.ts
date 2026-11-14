import assert from "node:assert/strict";
import { test } from "node:test";
import { rankedVariants, variantFor } from "./variants.ts";

/**
 * Mapping Decks' level onto the variants a model declares.
 *
 * The rules worth pinning down are the shape ones: a variant id that is not a Decks level
 * has no position on the scale, order of declaration must not matter, and a level off the
 * model's range lands on the nearest — including a wanted `xhigh` on a model that stops
 * at `high`, which is the case that used to read as "this runtime has no thinking scale".
 */

test("variant ids that are Decks levels are rankable, in scale order", () => {
	assert.deepEqual(rankedVariants(["low", "high"]), ["low", "high"]);
	assert.deepEqual(rankedVariants(["high", "low"]), ["low", "high"], "declaration order must not matter");
	assert.deepEqual(rankedVariants(["minimal", "medium", "xhigh", "low", "high"]), ["minimal", "low", "medium", "high", "xhigh"]);
	assert.deepEqual(rankedVariants(undefined), []);
});

test("custom variant ids are not on Decks' scale", () => {
	// A model whose variants are all its own names — a "fast" preset, say — can still
	// reason, but it has no answer to "how hard": nothing to rank, so reasoning: false.
	assert.deepEqual(rankedVariants(["thinking", "fast"]), []);
	assert.deepEqual(rankedVariants(["low", "fast", "high"]), ["low", "high"]);
});

test("a wanted level the model offers maps to itself", () => {
	assert.equal(variantFor("high", ["low", "high"]), "high");
	assert.equal(variantFor("off", ["off", "low", "high"]), "off");
});

test("a level past the model's top lands on the nearest, not nothing", () => {
	// The task's example: only `low`/`high` on offer and `xhigh` wanted.
	assert.equal(variantFor("xhigh", ["low", "high"]), "high");
	assert.equal(variantFor("max", ["minimal", "low", "medium", "high", "xhigh"]), "xhigh");
});

test("a level under the model's bottom lands on the cheapest it offers", () => {
	// "off" means don't think, but on a model with no off switch the nearest is what it
	// has — the lower-effort mistake, exactly as the picker's tie rule says.
	assert.equal(variantFor("off", ["low", "high"]), "low");
	assert.equal(variantFor("minimal", ["medium", "high"]), "medium");
});

test("between two equidistant levels the lower-effort one wins", () => {
	assert.equal(variantFor("medium", ["low", "high"]), "low");
	assert.equal(variantFor("high", ["medium", "xhigh"]), "medium");
});

test("no level wanted and no rankable variants both answer nothing", () => {
	assert.equal(variantFor(undefined, ["low", "high"]), undefined);
	assert.equal(variantFor("high", undefined), undefined);
	assert.equal(variantFor("high", []), undefined);
	assert.equal(variantFor("high", ["fast", "thinking"]), undefined);
});