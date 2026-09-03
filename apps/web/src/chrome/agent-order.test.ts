import type { AgentChat, AgentState } from "@decks/protocol";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentList, agentOrder, agentStatus, since, stackFaces, STACK_CAP } from "./agent-order.ts";

/*
 * The corner's two rules are both subtractions — no idle agents, and not the one you are
 * already in — and both of them are the kind of thing that gets quietly re-added by
 * someone making the list "complete". So they are asserted here rather than trusted to the
 * comment that explains them.
 */

/** A chat with only the fields the ordering reads, and the required ones filled in. */
function chat(id: string, state: AgentState, lastAt?: number): AgentChat {
	return {
		id,
		name: id,
		state,
		unread: 0,
		contextCount: 0,
		kind: "claude",
		capabilities: { modes: [] },
		commands: [],
		lastAt,
	};
}

const ids = (chats: AgentChat[]) => chats.map((c) => c.id);

test("done is derived, not reported", () => {
	assert.equal(agentStatus("idle", 0), "idle");
	assert.equal(agentStatus("idle", 2), "done", "idle with unread is the green ring");
	assert.equal(agentStatus("waiting", 0), "waiting");
	// Three runtime states, one ring: the transcript shows the difference, the corner does not.
	assert.equal(agentStatus("thinking", 0), "working");
	assert.equal(agentStatus("streaming", 0), "working");
	assert.equal(agentStatus("tool", 0), "working");
	// Unread does not outrank a live turn: a working agent is working, not "done".
	assert.equal(agentStatus("tool", 5), "working");
});

test("asking, then finished, then busy", () => {
	const chats = [chat("busy", "tool"), chat("read", "idle"), chat("green", "idle"), chat("asking", "waiting")];
	assert.deepEqual(ids(agentOrder(chats, { green: 1 })), ["asking", "green", "busy"]);
});

test("an idle agent is not in the corner at all", () => {
	const chats = [chat("quiet", "idle"), chat("busy", "thinking")];
	assert.deepEqual(ids(agentOrder(chats, {})), ["busy"]);
	// Reading it is what retires it: the same agent, once its unread is cleared, leaves.
	assert.deepEqual(ids(agentOrder(chats, { quiet: 3 })), ["quiet", "busy"]);
	assert.deepEqual(ids(agentOrder(chats, { quiet: 0 })), ["busy"]);
});

test("the agent whose window this is has no face in the corner", () => {
	const chats = [chat("here", "tool"), chat("there", "tool")];
	assert.deepEqual(ids(agentOrder(chats, {}, "here")), ["there"]);
	// And excluding it must not be confused with excluding its *status*.
	assert.deepEqual(ids(agentOrder(chats, {}, "nobody")), ["here", "there"]);
});

test("ties go to the most recent, and equal ties keep their order", () => {
	const chats = [chat("old", "waiting", 1_000), chat("new", "waiting", 9_000), chat("mid", "waiting", 5_000)];
	assert.deepEqual(ids(agentOrder(chats, {})), ["new", "mid", "old"]);
	const never = [chat("a", "waiting"), chat("b", "waiting"), chat("c", "waiting")];
	assert.deepEqual(ids(agentOrder(never, {})), ["a", "b", "c"], "a stable sort, so faces do not swap about");
});

test("three faces, then a number", () => {
	const chats = [chat("a", "waiting", 4), chat("b", "waiting", 3), chat("c", "waiting", 2), chat("d", "waiting", 1)];
	const split = stackFaces(agentOrder(chats, {}));
	assert.equal(STACK_CAP, 3);
	assert.deepEqual(ids(split.shown), ["a", "b", "c"]);
	assert.equal(split.more, 1);
	// Exactly at the cap there is no chip — `+0` is a control that says nothing.
	assert.equal(stackFaces(agentOrder(chats.slice(0, 3), {})).more, 0);
	assert.deepEqual(ids(stackFaces([]).shown), []);
});

test("the dropdown is what exists, not what is happening", () => {
	const chats = [chat("busy", "tool"), chat("quiet", "idle", 10), chat("asking", "waiting"), chat("here", "streaming")];
	// Everyone, idle included, with the focused agent pinned to the top.
	assert.deepEqual(ids(agentList(chats, {}, "here")), ["here", "asking", "busy", "quiet"]);
	// And below the pin the order is exactly the corner's, so a face is in the same place twice.
	assert.deepEqual(ids(agentList(chats, {}, "here")).slice(1, 3), ids(agentOrder(chats, {}, "here")));
});

test("how long ago, in the room a corner has", () => {
	const now = 1_000_000_000;
	assert.equal(since(undefined, now), "");
	assert.equal(since(now, now), "just now");
	assert.equal(since(now - 30_000, now), "just now", "zero of something reads badly shortened");
	assert.equal(since(now - 120_000, now), "2m");
	assert.equal(since(now - 3 * 3_600_000, now), "3h");
	assert.equal(since(now - 50 * 3_600_000, now), "2d");
});
