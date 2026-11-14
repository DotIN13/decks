import assert from "node:assert/strict";
import { test } from "node:test";
import { noLimitsWords, whoseLimits } from "./model.ts";

// The usage panel says whose limits these are, and why there are none.

test("with no plan windows the panel says why", () => {
	assert.match(noLimitsWords({ kind: "pi", limits: [] } as never), /bills per token/);
	assert.match(noLimitsWords({ kind: "claude", limits: null } as never), /not running against a claude.ai plan/);
	assert.equal(noLimitsWords({ kind: "claude", limits: [] } as never), "The plan reports no active windows.");
});

test("whose limits is empty when nothing is known", () => {
	assert.equal(whoseLimits(undefined), "");
});
