import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransientAuthFailure, MAX_TRANSIENT_RETRIES, retryDelayMs } from "./transient.ts";

/**
 * The sentence this reads, kept verbatim.
 *
 * The match is on prose because the SDK reports the turn as a success whose content is an
 * error sentence — there is nothing structural to key off. So the exact strings live here:
 * a CLI release that rewords one is a failing test, which is the only way this can be found
 * before somebody notices their turns have stopped retrying.
 */
const REAL =
	"Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. " +
	"This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again";

test("the message the CLI actually sent is recognised", () => {
	assert.equal(isTransientAuthFailure(REAL), true);
});

test("each half of it is enough on its own", () => {
	assert.equal(isTransientAuthFailure("another Claude Code process is refreshing it"), true);
	assert.equal(isTransientAuthFailure("the previous attempt exited mid-refresh"), true);
	assert.equal(isTransientAuthFailure("This is usually transient; retry shortly"), true);
});

/*
 * The trap in the real message: it *ends* by suggesting you sign in again. A test that
 * refused to retry anything mentioning login would refuse to retry the one case this exists
 * for, so a permanent phrase only wins when the transient wording is absent.
 */
test("a refusal that needs a person is never retried", () => {
	assert.equal(isTransientAuthFailure("Login expired · Please run /login"), false);
	assert.equal(isTransientAuthFailure("OAuth token revoked · Please run /login"), false);
	assert.equal(isTransientAuthFailure("Your organization has disabled API key authentication"), false);
	// And the real message, which says both things, is still transient.
	assert.equal(isTransientAuthFailure(REAL), true, "because it says the failure persists, not that it is final");
});

test("an ordinary answer is not a failure", () => {
	assert.equal(isTransientAuthFailure("Here is the plan: first, refresh the token cache."), false);
	assert.equal(isTransientAuthFailure(""), false);
	assert.equal(isTransientAuthFailure(undefined), false);
});

/*
 * A guard against the thing that would be worst: an agent that *writes about* this bug
 * having its own turns swallowed and retried. A reply long enough to be a real answer is
 * treated as one however it is worded.
 */
test("a long reply is an answer, whatever it quotes", () => {
	const essay = `${REAL} ${"and then a great deal more about what it means. ".repeat(60)}`;
	assert.ok(essay.length > 2000);
	assert.equal(isTransientAuthFailure(essay), false);
});

test("the wait grows, and it is bounded", () => {
	assert.equal(retryDelayMs(1), 4000, "short enough that a slow turn is all anybody sees");
	assert.equal(retryDelayMs(2), 20_000, "long enough for a refresh stuck behind a timeout");
	assert.equal(MAX_TRANSIENT_RETRIES, 2, "and then the message stands, rather than a turn that never ends");
});
