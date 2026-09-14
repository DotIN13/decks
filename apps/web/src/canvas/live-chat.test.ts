import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { turnCards } from "../chat/turn-cards.ts";
import { applyDelta, liveDelta } from "./live-chat.ts";

/**
 * Feeding a mirror board.
 *
 * One rule does every case — keep the first `from`, then append these — so what is worth
 * pinning is that the rule *is* enough: an append, a turn growing while it streams, and a
 * rewind that throws work away all come out of the same comparison, and a conversation
 * that has not moved produces nothing to send at all.
 *
 * The cards are built from items by the same function the app calls, so what is tested is the
 * pipeline rather than a hand-written wire: `turnCards` on both sides of the comparison is
 * what makes "the turn that changed" mean the same thing to the board as to the column.
 */

const ask = (id: string, text: string): ChatItem => ({ kind: "user", id, text, at: 0 });
const say = (id: string, text: string, streaming = false): ChatItem => ({ kind: "assistant", id, text, at: 0, ...(streaming ? { streaming } : {}) });
const cards = (...items: ChatItem[]) => turnCards(items);

test("an unchanged conversation is nothing to send", () => {
	const items = [ask("1", "hello"), say("2", "hi")];
	assert.equal(liveDelta(cards(...items), cards(...items)), undefined);
	// A different array of equal items is still nothing: the store hands out fresh
	// objects, and a mirror repainting for that would repaint on every keystroke anywhere.
	assert.equal(liveDelta(cards(...items), cards(ask("1", "hello"), say("2", "hi"))), undefined);
});

test("a new turn is sent on its own, not the whole conversation", () => {
	const before = cards(ask("1", "hello"), say("2", "hi"));
	const after = cards(ask("1", "hello"), say("2", "hi"), ask("3", "and again"));
	const delta = liveDelta(before, after);
	assert.equal(delta?.from, 2, "the two cards above it are not resent");
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a turn growing while it streams resends only that turn", () => {
	const before = cards(ask("1", "hello"), say("2", "hi th", true));
	const after = cards(ask("1", "hello"), say("2", "hi there", true));
	const delta = liveDelta(before, after);
	assert.equal(delta?.from, 1, "the finished turn above it is not resent");
	assert.equal(delta?.turns.length, 1);
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("streaming ending is a change even when the text did not", () => {
	const before = cards(say("2", "done", true));
	const after = cards(say("2", "done"));
	assert.deepEqual(liveDelta(before, after)?.from, 0);
	assert.deepEqual(applyDelta(before, liveDelta(before, after)!), after);
});

/*
 * A call finishing, and a call being *added* to a turn already drawn.
 *
 * The card is the unit, so a turn that read four files and is now reading a fifth is one
 * changed card rather than five changed rows — which is the reason the stamp is a card's
 * parts joined rather than a card's id.
 */
test("a tool call finishing inside a turn resends that turn", () => {
	const running: ChatItem = { kind: "tool", id: "t", name: "bash", title: "git status", state: "running" };
	const done: ChatItem = { kind: "tool", id: "t", name: "bash", title: "git status", state: "done", result: "clean" };
	const before = cards(ask("1", "go"), say("2", "looking"), running);
	const after = cards(ask("1", "go"), say("2", "looking"), done);
	const delta = liveDelta(before, after);
	assert.equal(delta?.from, 1, "the user's message is untouched");
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a call joining a group is a change to the card that holds it", () => {
	const call = (id: string): ChatItem => ({ kind: "tool", id, name: "read", title: id, state: "done" });
	const before = cards(ask("1", "go"), call("t1"), call("t2"));
	const after = cards(ask("1", "go"), call("t1"), call("t2"), call("t3"));
	assert.equal(liveDelta(before, after)?.from, 1);
});

/*
 * A rewind truncates the transcript and then grows a different branch, which is the one
 * case where a board holding the old turns would be silently wrong. It needs no case of
 * its own: the first turn that differs is where the branch is, and everything from there
 * is what gets sent.
 */
test("a rewind resends from the branch point", () => {
	const before = cards(ask("1", "hello"), say("2", "hi"), ask("3", "no, wait"));
	const after = cards(ask("1", "hello"), say("2", "hi"), ask("4", "actually this"));
	const delta = liveDelta(before, after);
	assert.equal(delta?.from, 2);
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a truncation with nothing to put back is still expressible", () => {
	const before = cards(ask("1", "hello"), say("2", "hi"));
	const after = cards(ask("1", "hello"));
	const delta = liveDelta(before, after);
	assert.deepEqual(delta, { from: 1, turns: [] });
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a board with nothing yet is sent everything", () => {
	const after = cards(ask("1", "hello"), say("2", "hi"));
	assert.deepEqual(liveDelta([], after), { from: 0, turns: after });
});
