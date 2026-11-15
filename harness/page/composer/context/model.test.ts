import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentUsage } from "@decks/protocol";
import { dialLabel, usageRows } from "./model.ts";

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
