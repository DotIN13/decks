import assert from "node:assert/strict";
import { test } from "node:test";
import { PROGRESS_REMINDER, progressReminder } from "./progress-reminder.ts";

test("a message that starts a turn asks for the progress card first, one sent into a running turn does not", () => {
	assert.equal(progressReminder(true), PROGRESS_REMINDER);
	assert.match(PROGRESS_REMINDER, /before you run anything/);
	assert.equal(progressReminder(false), undefined);
});
