import assert from "node:assert/strict";
import { test } from "node:test";
import { BARE_NAMES, EVENTS, LINE_NAMES, OLD_EVENT_NAMES, isNounVerb } from "./names.ts";

test("every event is noun.verb, and listed once", () => {
	assert.equal(new Set(EVENTS).size, EVENTS.length);
	for (const name of EVENTS) assert.ok(isNounVerb(name), `${name} is noun.verb`);
	for (const name of Object.keys(LINE_NAMES)) assert.ok(isNounVerb(name), `${name} is noun.verb`);
});

test("an old name maps to an event that exists, and no new name is an old one", () => {
	const events = new Set<string>(EVENTS);
	for (const [now, old] of Object.entries(OLD_EVENT_NAMES)) {
		assert.ok(events.has(now), `${now} is an event`);
		assert.ok(!events.has(old!), `${old} is not said any more`);
	}
	for (const bare of BARE_NAMES) assert.ok(!isNounVerb(bare));
});
