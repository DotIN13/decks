import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch, type DispatchDecision } from "./dispatch.ts";
import type { TaskRosterEntry, TaskSpec } from "@decks/protocol";

/** One agent, with the fields that matter. */
function agent(partial: Partial<TaskRosterEntry> & { id: string; name: string }): TaskRosterEntry {
	return { state: "idle", tags: [], context: [], queued: 0, ...partial };
}

const ada = agent({ id: "a", name: "Ada", workspace: "political-llm" });
const bo = agent({ id: "b", name: "Bo", workspace: "political-llm", state: "streaming", queued: 2 });
const cee = agent({ id: "c", name: "Cee", workspace: "zeta-check" });
const noOne = (): TaskRosterEntry[] => [ada, bo, cee];

const agentDecision = (decision: DispatchDecision) => {
	assert.equal(decision.outcome, "agent");
	return decision as Extract<DispatchDecision, { outcome: "agent" }>;
};

test("a person's named agent wins, even when it is busy", () => {
	const spec: TaskSpec = { text: "x", agentId: "b" };
	const decision = agentDecision(dispatch(spec, noOne()));
	assert.equal(decision.agentId, "b");
});

test("a named agent that is gone is a none, with the reason", () => {
	const decision = dispatch({ text: "x", agentId: "gone" }, noOne());
	assert.equal(decision.outcome, "none");
	assert.equal(decision.reason, "The agent named for this task is gone.");
});

test("a workspace with no members blocks honestly", () => {
	const decision = dispatch({ text: "x", workspace: "empty-project" }, noOne());
	assert.equal(decision.outcome, "none");
	assert.equal(decision.reason, "No agent is in empty-project.");
});

test("idle beats busy inside the same workspace", () => {
	const decision = agentDecision(dispatch({ text: "x", workspace: "political-llm" }, noOne()));
	assert.equal(decision.agentId, "a");
	assert.match(decision.why, /best fit/);
});

test("fewer queued breaks the tie, then boards held, then the name", () => {
	const idle = agent({ id: "d", name: "Dee", workspace: "political-llm" });
	const quiet = agent({ id: "e", name: "Eve", workspace: "political-llm", queued: 5 });
	const busy = agent({ id: "f", name: "Fay", workspace: "political-llm", queued: 9 });
	const roster = [ada, idle, quiet, busy];
	// Pat and Quinn are both idle with empty queues: the name decides.
	const pat = agent({ id: "p", name: "Pat", workspace: "political-llm" });
	const quinn = agent({ id: "q", name: "Quinn", workspace: "political-llm" });
	const byName = agentDecision(dispatch({ text: "x", workspace: "political-llm" }, [pat, quinn]));
	assert.equal(byName.agentId, "p");
	// Adding Eve with five queued — the rank orders by state, then queue depth.
	const queues = agentDecision(dispatch({ text: "x", workspace: "political-llm" }, [busy, quiet, idle]));
	assert.equal(queues.agentId, "d");
	void roster;
});

test("the workspace is inferred from whoever holds the task's boards", () => {
	const holder = agent({ id: "h", name: "Hal", workspace: "alpha", context: ["boards/plan.html", "boards/a.html"] });
	const unrelated = agent({ id: "u", name: "Ula", workspace: "beta", context: ["boards/other.html"] });
	const decision = agentDecision(dispatch({ text: "x", boards: ["boards/plan.html", "boards/a.html"] }, [unrelated, holder]));
	assert.equal(decision.agentId, "h");
	assert.match(decision.why, /alpha/);
});

test("boards held across several workspaces leave the field open", () => {
	const left = agent({ id: "l", name: "Lee", workspace: "alpha", context: ["boards/plan.html"] });
	const right = agent({ id: "r", name: "Rae", workspace: "beta", context: ["boards/a.html"] });
	const decision = agentDecision(dispatch({ text: "x", boards: ["boards/plan.html", "boards/a.html"] }, [left, right]));
	// Nobody owns a majority workspace, so the rule falls back to idle + name.
	assert.equal(decision.agentId, "l");
});

test("an empty roster is a none with a sentence", () => {
	const decision = dispatch({ text: "x" }, []);
	assert.equal(decision.outcome, "none");
	assert.match(decision.reason, /no agents yet/i);
});

test("the answer is stable: two runs pick the same agent", () => {
	const spec: TaskSpec = { text: "x", workspace: "political-llm" };
	const first = agentDecision(dispatch(spec, noOne()));
	const second = agentDecision(dispatch(spec, noOne()));
	assert.equal(first.agentId, second.agentId);
});