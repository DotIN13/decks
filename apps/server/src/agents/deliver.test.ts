import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentKind, AgentState } from "@decks/protocol";
import { Turns } from "./turns.ts";

/**
 * `agent.send` delivers now: an idle agent starts a turn on it; a busy one whose runtime takes a
 * message mid-turn gets it in that turn (Pi and opencode 2 steer; Claude and opencode 1 take it at
 * the next step); a busy Antigravity agent, which reads one prompt per turn, gets it queued.
 */
function fake(kind: AgentKind, state: AgentState) {
	const prompted: string[] = [];
	const turns = new Turns({
		id: "rune",
		kind,
		emit: () => {},
		name: () => "Rune",
		state: () => state,
		prompt: async (text) => void prompted.push(text),
		run: async () => ({ report: "", cards: [] }),
		notice: () => {},
		brief: (task, cards) => `${task}${cards.length ? ` [${cards.join(", ")}]` : ""}`,
		report: () => {},
		outside: () => undefined,
		mailChanged: () => {},
	});
	return { prompted, turns, send: (task: string) => turns.deliver({ from: "a1", fromName: "Ada", task, cards: ["pages/a.html"], at: 1 }) };
}

test("an idle agent of any runtime starts a turn on the message", () => {
	for (const kind of ["pi", "claude", "opencode", "opencode2", "antigravity"] as const) {
		const one = fake(kind, "idle");
		assert.deepEqual(one.send("look"), { delivered: true, turn: "new" }, kind);
		assert.match(one.prompted[0]!, /Ada sent you this, to act on now:\n\nlook \[pages\/a\.html\]/);
	}
});

test("a busy agent is steered where its runtime can take a message mid-turn, opencode 1 included", () => {
	for (const kind of ["pi", "opencode2", "claude", "opencode"] as const) {
		const one = fake(kind, "thinking");
		const answer = one.send("stop and look");
		assert.equal(answer.delivered, true, kind);
		assert.equal(answer.turn, "running", kind);
		assert.equal(one.prompted.length, 1, `${kind} got it in the turn`);
		assert.equal(one.turns.queued, 0);
	}
	assert.match(fake("opencode", "thinking").send("x").note!, /opencode takes a message mid-turn at its next step/);
});

test("a busy Antigravity agent gets it queued, and is told so", () => {
	const one = fake("antigravity", "thinking");
	const answer = one.send("stop and look");
	assert.deepEqual([answer.delivered, answer.turn], [false, "queued"]);
	assert.equal(one.prompted.length, 0);
	assert.equal(one.turns.queued, 1);
	assert.match(answer.note!, /cannot take a message in the middle of a turn/);
});
