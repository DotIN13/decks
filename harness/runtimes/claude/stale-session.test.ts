import assert from "node:assert/strict";
import { test } from "node:test";
import { isStaleSession } from "./stale-session.ts";

/**
 * The sentence that ends a turn when the session cannot be found.
 *
 * Three of these are the exact strings from the morning this was written: the CLI's own
 * sentence, the SDK's wrapper around it, and the same text arriving as the error a control
 * request throws. The rest are the refusals that must *not* be read as this, because the
 * recovery starts a fresh session and forgetting a conversation is not something to do by
 * accident.
 */
test("the CLI's own sentence is recognised", () => {
	assert.equal(isStaleSession("No conversation found with session ID: d062222f-2f54-4f44-88e9-fc1469c78a2f"), true);
	assert.equal(isStaleSession("  no conversation found with session id: 4f2a  "), true);
});

test("it is recognised through the SDK's wrapper, which is how the pump sees it", () => {
	assert.equal(isStaleSession("Claude Code returned an error result: No conversation found with session ID: d062222f-2f54-4f44-88e9-fc1469c78a2f"), true);
	assert.equal(isStaleSession("Error: Claude Code returned an error result: No conversation found with session ID: abc"), true);
});

test("an answer that merely mentions a session or a conversation is not it", () => {
	assert.equal(isStaleSession("I found the session and read the transcript"), false);
	assert.equal(isStaleSession("No conversation is resumed when the id is missing"), false);
	assert.equal(isStaleSession("The session ID was recorded in the account's store"), false);
});

test("another failure is left to whoever handles it", () => {
	// The transient case has its own retry, and it must not be restarted as a fresh session.
	assert.equal(isStaleSession("OAuth token refresh failed because another Claude Code process is refreshing it; this is usually transient. retry in a minute"), false);
	assert.equal(isStaleSession("Please run /login"), false);
	assert.equal(isStaleSession("Invalid API key"), false);
});

test("nothing to match on is not a match", () => {
	assert.equal(isStaleSession(undefined), false);
	assert.equal(isStaleSession(""), false);
	assert.equal(isStaleSession("   "), false);
	// A long reply that quotes the sentence is an answer, not the error: one line is the error.
	assert.equal(isStaleSession(`${"x".repeat(2001)} No conversation found with session ID: abc`), false);
});
