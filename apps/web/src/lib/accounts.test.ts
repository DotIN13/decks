import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaudeAccount } from "@decks/protocol";
import { canMove, nextUp } from "./accounts.ts";

const row = (id: string, extra: Partial<ClaudeAccount> = {}): ClaudeAccount => ({ id, signedIn: true, ...extra });

test("the next account is the first usable one below the top of the list", () => {
	const list = [row("a"), row("b"), row("c")];
	assert.equal(nextUp(list, "a"), "b");
	// Order is the whole mechanism: the same three accounts, put in a different order, hand
	// over to a different one.
	assert.equal(nextUp([list[2]!, list[1]!, list[0]!], "a"), "c");
});

test("a row that cannot be used is passed over, not counted", () => {
	const list = [row("a"), row("b", { signedIn: false }), row("c", { limitedUntil: 5_000 }), row("d")];
	assert.equal(nextUp(list, "a", 1_000), "d", "signed out, then spent, then the one that works");
});

test("a limit that has already lifted is not a limit", () => {
	const list = [row("a"), row("b", { limitedUntil: 500 })];
	assert.equal(nextUp(list, "a", 1_000), "b");
	assert.equal(nextUp(list, "a", 100), undefined, "and while it is still spent there is nowhere to go");
});

test("the arrows stop at the ends", () => {
	const list = [row("a"), row("b"), row("c")];
	assert.equal(canMove(list, "a", "up"), false);
	assert.equal(canMove(list, "a", "down"), true);
	assert.equal(canMove(list, "c", "down"), false);
	assert.equal(canMove(list, "gone", "up"), false);
});
