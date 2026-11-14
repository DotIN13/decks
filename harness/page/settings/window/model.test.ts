import assert from "node:assert/strict";
import { test } from "node:test";
import { labelOf, sectionOf } from "./model.ts";

// Settings opens on the section last opened, else on Notifications.

test("a kept section opens; anything else opens Notifications", () => {
	assert.equal(sectionOf("voice"), "voice");
	assert.equal(sectionOf("billing"), "notifications");
	assert.equal(sectionOf(null), "notifications");
	assert.equal(labelOf("chrome"), "Chrome");
});
