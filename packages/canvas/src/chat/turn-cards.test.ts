import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { turnCards } from "./turn-cards.ts";

/**
 * The fold both surfaces draw: a message is a card, a turn is the parts inside one.
 *
 * Worth its own file because the rule is *shared* — the column renders these cards and a
 * mirror board is handed them — so the interesting cases are the ones where the two could
 * disagree about what the conversation contains. One of them already did.
 */

const ask = (id: string, text: string, entryId?: string): ChatItem => ({ kind: "user", id, text, at: 0, ...(entryId ? { entryId } : {}) });
const say = (id: string, text: string, extra: { thinking?: string; streaming?: boolean } = {}): ChatItem => ({
	kind: "assistant",
	id,
	text,
	at: 0,
	...extra,
});
const tool = (id: string, name: string, state: "running" | "done" | "error" = "done"): ChatItem => ({
	kind: "tool",
	id,
	name,
	title: name,
	state,
});
const notice = (id: string, text: string): ChatItem => ({ kind: "notice", id, level: "warn", text, at: 0 });

test("a reply and the calls it made are one card, in order", () => {
	const cards = turnCards([ask("u", "how does it work"), say("s1", "let me look"), tool("t1", "read"), say("s2", "here is how")]);

	assert.deepEqual(cards.map((card) => card.kind), ["mine", "agent"]);
	const agent = cards[1];
	assert.equal(agent?.kind, "agent");
	if (agent?.kind !== "agent") return;
	assert.deepEqual(
		agent.parts.map((part) => part.kind),
		["text", "tools", "text"],
		"the calls sit between the two things said rather than in cards of their own",
	);
	// The card is keyed on its first part, which is what a list needs to be stable while the
	// turn grows at its end.
	assert.equal(agent.id, "s1");
});

test("a run of finished calls is one slot carrying its own names", () => {
	const cards = turnCards([ask("u", "go"), tool("t1", "read"), tool("t2", "grep"), tool("t3", "read"), tool("t4", "write", "running")]);

	const agent = cards[1];
	if (agent?.kind !== "agent") throw new Error("expected an agent card");
	const part = agent.parts[0];
	if (part?.kind !== "tools") throw new Error("expected the calls to be one tools part");
	assert.deepEqual(part.slots.map((slot) => slot.kind), ["group", "call"]);
	const group = part.slots[0];
	if (group?.kind !== "group") throw new Error("expected a group");
	assert.deepEqual(group.calls.map((call) => call.id), ["t1", "t2", "t3"]);
	assert.deepEqual(group.names, ["read", "grep"], "deduped, in the order they first ran");
	assert.equal(group.more, 0);
	const live = part.slots[1];
	assert.equal(live?.kind === "call" ? live.call.id : undefined, "t4", "the running call keeps a line of its own");
});

/*
 * The case the mirror board's own copy of this fold got wrong.
 *
 * A turn that has finished and whose only content is thinking said nothing. The column drops
 * it; the copy kept it, so the same conversation had a row in a mirror that was nowhere in the
 * column. Asserted here rather than only over the wire, because it is what a second
 * implementation of the rule cost.
 */
test("a finished turn with nothing but thinking is not a card", () => {
	assert.deepEqual(turnCards([ask("u", "go"), say("s", "", { thinking: "…thinking it over…" })]).map((card) => card.kind), ["mine"]);
});

test("…but a turn still arriving with nothing but thinking is", () => {
	const cards = turnCards([ask("u", "go"), say("s", "", { thinking: "…thinking it over…", streaming: true })]);
	assert.deepEqual(cards.map((card) => card.kind), ["mine", "agent"]);
});

test("a notice is its own card, not a line inside a reply's", () => {
	const cards = turnCards([say("s", "working on it"), notice("n", "This chat continues on the default model."), say("s2", "done")]);
	assert.deepEqual(cards.map((card) => card.kind), ["agent", "notice", "agent"]);
});

test("a card carries the time, and a message carries its rewind point", () => {
	const cards = turnCards([ask("u", "go", "entry-1"), say("s", "done")]);
	assert.equal(cards[0]?.kind === "mine" ? cards[0].entryId : undefined, "entry-1");
	assert.equal(cards[0]?.at, 0);
});

/*
 * A window is folded from its own start.
 *
 * `Stream` folds the part of the conversation in the DOM rather than all of it, so the first
 * item is regularly a tool call rather than a user message. That was true of the fold when it
 * lived in the component and is true of this one; it is asserted because it is the one thing
 * the move could quietly have changed.
 */
test("a window folds from where it starts", () => {
	const cards = turnCards([tool("t1", "read"), tool("t2", "grep"), say("s", "here is how")]);
	assert.deepEqual(cards.map((card) => card.kind), ["agent"]);
	const agent = cards[0];
	if (agent?.kind !== "agent") return;
	assert.deepEqual(agent.parts.map((part) => part.kind), ["tools", "text"]);
});
