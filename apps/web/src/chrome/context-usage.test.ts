import assert from "node:assert/strict";
import { test } from "node:test";
import { contextLevel, contextPercent, usageLevel } from "./context-usage.ts";

const usage = (contextTokens: number | null, contextWindow = 200_000) => ({ contextTokens, contextWindow, cost: 0 });

test("the percentage is the tokens over the window", () => {
	assert.equal(contextPercent(usage(100_000)), 50);
	assert.equal(contextPercent(usage(184_000)), 92);
});

test("not reported yet is not zero", () => {
	assert.equal(contextPercent(undefined), undefined, "no usage at all");
	assert.equal(contextPercent(usage(null)), undefined, "before the first reply, and after a compaction");
	assert.equal(contextPercent(usage(0)), 0, "but zero is a reading, and a falsy one");
	assert.equal(contextLevel(usage(0)), undefined);
});

test("a window of zero is not a division", () => {
	assert.equal(contextPercent(usage(1000, 0)), undefined);
	assert.equal(contextPercent(usage(1000, -1)), undefined);
});

test("the two thresholds are inclusive, and nothing is drawn below the first", () => {
	assert.equal(contextLevel(usage(138_000)), undefined, "69%");
	assert.equal(contextLevel(usage(140_000)), "warn", "exactly 70%");
	assert.equal(contextLevel(usage(169_000)), "warn", "84.5%");
	assert.equal(contextLevel(usage(170_000)), "high", "exactly 85%");
	assert.equal(contextLevel(usage(400_000)), "high", "and over the window is still high, not a fourth state");
});

test("one band function, so the ring and the plan meters agree", () => {
	// The whole reason `usageLevel` is exported: picone bands its dial at 70/85 and its
	// meter at 75/90, with a comment claiming they match. Stated once, they cannot drift.
	assert.equal(usageLevel(69.9), undefined);
	assert.equal(usageLevel(70), "warn");
	assert.equal(usageLevel(84.6), "warn");
	assert.equal(usageLevel(85), "high");
	assert.equal(usageLevel(120), "high");
	assert.equal(contextLevel(usage(140_000)), usageLevel(70), "a 70% context and a 70% window are the same colour");
});

test("a share nobody would state has no colour", () => {
	// Null is "the window exists and its share is unknown". Zero is a reading. Only one of
	// them is a fact about how full something is.
	assert.equal(usageLevel(null), undefined);
	assert.equal(usageLevel(undefined), undefined);
	assert.equal(usageLevel(0), undefined);
});
