import assert from "node:assert/strict";
import { test } from "node:test";
import { BARE_NAMES, EVENTS, LINE_NAMES, isNounVerb } from "./names.ts";

test("every event is noun.verb, and listed once", () => {
	assert.equal(new Set(EVENTS).size, EVENTS.length);
	for (const name of EVENTS) assert.ok(isNounVerb(name), `${name} is noun.verb`);
	for (const name of Object.keys(LINE_NAMES)) assert.ok(isNounVerb(name), `${name} is noun.verb`);
});

test("the bare names are not noun.verb", () => {
	for (const bare of BARE_NAMES) assert.ok(!isNounVerb(bare));
});
