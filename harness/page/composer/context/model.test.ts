import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentUsage } from "@decks/protocol";
import { contextLevel, contextPercent, dialLabel, usageLevel, usageRows } from "./model.ts";

// The context dial's rows and spoken label.

test("the summary shows used, window and cost, in that order", () => {
	const usage = { contextTokens: 12345, contextWindow: 200000, cost: 0.5 } as AgentUsage;
	assert.deepEqual(usageRows(usage), [
		{ key: "Used", value: "12,345" },
		{ key: "Window", value: "200,000" },
		{ key: "This session", value: "$0.500" },
	]);
});

test("the dial says how full the context is", () => {
	assert.equal(dialLabel(41.6), "Context 42% full, the numbers behind it");
});

const reading = (contextTokens: number | null, contextWindow = 200_000) => ({ contextTokens, contextWindow, cost: 0 });

test("the percentage is the tokens over the window", () => {
	assert.equal(contextPercent(reading(100_000)), 50);
	assert.equal(contextPercent(reading(184_000)), 92);
});

test("not reported yet is not zero", () => {
	assert.equal(contextPercent(undefined), undefined, "no usage at all");
	assert.equal(contextPercent(reading(null)), undefined, "before the first reply, and after a compaction");
	assert.equal(contextPercent(reading(0)), 0, "but zero is a reading, and a falsy one");
	assert.equal(contextLevel(reading(0)), undefined);
});

test("a window of zero is not a division", () => {
	assert.equal(contextPercent(reading(1000, 0)), undefined);
	assert.equal(contextPercent(reading(1000, -1)), undefined);
});

test("the two thresholds are inclusive, and nothing is drawn below the first", () => {
	assert.equal(contextLevel(reading(138_000)), undefined, "69%");
	assert.equal(contextLevel(reading(140_000)), "warn", "exactly 70%");
	assert.equal(contextLevel(reading(169_000)), "warn", "84.5%");
	assert.equal(contextLevel(reading(170_000)), "high", "exactly 85%");
	assert.equal(contextLevel(reading(400_000)), "high", "and over the window is still high, not a fourth state");
});

test("one band function, so the ring and the plan meters agree", () => {
	assert.equal(usageLevel(69.9), undefined);
	assert.equal(usageLevel(70), "warn");
	assert.equal(usageLevel(84.6), "warn");
	assert.equal(usageLevel(85), "high");
	assert.equal(usageLevel(120), "high");
	assert.equal(contextLevel(reading(140_000)), usageLevel(70), "a 70% context and a 70% window are the same colour");
});

test("a share nobody would state has no colour", () => {
	assert.equal(usageLevel(null), undefined);
	assert.equal(usageLevel(undefined), undefined);
	assert.equal(usageLevel(0), undefined);
});
