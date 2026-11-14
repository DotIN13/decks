import assert from "node:assert/strict";
import { test } from "node:test";
import { availableModes, currentMode, modeTinted } from "./model.ts";

test("only the modes the runtime offers are shown, in the chip's order", () => {
	assert.deepEqual(availableModes(["auto", "manual"]).map((m) => m.mode), ["manual", "auto"]);
});

test("the chip shows the agent's mode, else the first offered", () => {
	assert.equal(currentMode(["plan", "auto"], "auto").mode, "auto");
	assert.equal(currentMode(["plan", "auto"], undefined).mode, "plan");
	assert.equal(currentMode([], undefined).mode, "manual");
});

test("only asking first is untinted", () => {
	assert.equal(modeTinted("manual"), false);
	assert.equal(modeTinted(undefined), false);
	assert.equal(modeTinted("plan"), true);
});
