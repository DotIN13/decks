import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaudeAccount } from "@decks/protocol";
import { canMove, firstUsable } from "./accounts.ts";

const row = (id: string, extra: Partial<ClaudeAccount> = {}): ClaudeAccount => ({ id, signedIn: true, ...extra });

test("the row a conversation lands on is the first usable one, top down", () => {
	const list = [row("a"), row("b"), row("c")];
	assert.equal(firstUsable(list), "a", "the top of the list, which is what the arrows are for");
	// Order is the whole mechanism: the same three accounts, put in a different order, give a
	// different answer.
	assert.equal(firstUsable([list[2]!, list[1]!, list[0]!]), "c");
});

test("a row that cannot be used is passed over, not counted", () => {
	const list = [row("a", { signedIn: false }), row("b", { limitedUntil: 5_000 }), row("c")];
	assert.equal(firstUsable(list, 1_000), "c", "signed out, then spent, then the one that works");
});

test("a limit that has already lifted is not a limit", () => {
	const list = [row("a", { limitedUntil: 500 })];
	assert.equal(firstUsable(list, 1_000), "a");
	assert.equal(firstUsable(list, 100), undefined, "and while it is still spent there is nowhere to go");
});

test("the arrows stop at the ends", () => {
	const list = [row("a"), row("b"), row("c")];
	assert.equal(canMove(list, "a", "up"), false);
	assert.equal(canMove(list, "a", "down"), true);
	assert.equal(canMove(list, "c", "down"), false);
	assert.equal(canMove(list, "gone", "up"), false);
});
