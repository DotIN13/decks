import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { applyDelta, liveDelta } from "./live-chat.ts";

/**
 * Feeding a mirror board.
 *
 * One rule does every case — keep the first `from`, then append these — so what is worth
 * pinning is that the rule *is* enough: an append, a turn growing while it streams, and a
 * rewind that throws work away all come out of the same comparison, and a conversation
 * that has not moved produces nothing to send at all.
 */

const ask = (id: string, text: string): ChatItem => ({ kind: "user", id, text, at: 0 });
const say = (id: string, text: string, streaming = false): ChatItem => ({ kind: "assistant", id, text, at: 0, ...(streaming ? { streaming } : {}) });

test("an unchanged conversation is nothing to send", () => {
	const items = [ask("1", "hello"), say("2", "hi")];
	assert.equal(liveDelta(items, items), undefined);
	// A different array of equal items is still nothing: the store hands out fresh
	// objects, and a mirror repainting for that would repaint on every keystroke anywhere.
	assert.equal(liveDelta(items, [ask("1", "hello"), say("2", "hi")]), undefined);
});

test("a new turn is sent on its own, not the whole conversation", () => {
	const before = [ask("1", "hello"), say("2", "hi")];
	const after = [...before, ask("3", "and again")];
	const delta = liveDelta(before, after);
	assert.deepEqual(delta, { from: 2, items: [ask("3", "and again")] });
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a turn growing while it streams resends only that turn", () => {
	const before = [ask("1", "hello"), say("2", "hi th", true)];
	const after = [ask("1", "hello"), say("2", "hi there", true)];
	const delta = liveDelta(before, after);
	assert.equal(delta?.from, 1, "the finished turn above it is not resent");
	assert.equal(delta?.items.length, 1);
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("streaming ending is a change even when the text did not", () => {
	const before = [say("2", "done", true)];
	const after = [say("2", "done")];
	assert.deepEqual(liveDelta(before, after), { from: 0, items: after });
});

/*
 * A rewind truncates the transcript and then grows a different branch, which is the one
 * case where a board holding the old turns would be silently wrong. It needs no case of
 * its own: the first turn that differs is where the branch is, and everything from there
 * is what gets sent.
 */
test("a rewind resends from the branch point", () => {
	const before = [ask("1", "hello"), say("2", "hi"), ask("3", "no, wait")];
	const after = [ask("1", "hello"), say("2", "hi"), ask("4", "actually this")];
	const delta = liveDelta(before, after);
	assert.deepEqual(delta, { from: 2, items: [ask("4", "actually this")] });
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a truncation with nothing to put back is still expressible", () => {
	const before = [ask("1", "hello"), say("2", "hi")];
	const after = [ask("1", "hello")];
	const delta = liveDelta(before, after);
	assert.deepEqual(delta, { from: 1, items: [] });
	assert.deepEqual(applyDelta(before, delta!), after);
});

test("a board with nothing yet is sent everything", () => {
	const after = [ask("1", "hello"), say("2", "hi")];
	assert.deepEqual(liveDelta([], after), { from: 0, items: after });
});

test("tool calls are compared by what changes about them", () => {
	const running: ChatItem = { kind: "tool", id: "t", name: "bash", title: "git status", state: "running" };
	const done: ChatItem = { kind: "tool", id: "t", name: "bash", title: "git status", state: "done", result: "clean" };
	assert.equal(liveDelta([running], [running]), undefined);
	assert.deepEqual(liveDelta([running], [done]), { from: 0, items: [done] });
});
