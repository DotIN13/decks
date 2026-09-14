import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentState, ChatItem, ServerMessage } from "@decks/protocol";
import { Translator } from "../../agents/translator.ts";
import { handlePiEvent } from "./events.ts";

/**
 * Reading Pi's stream into the transcript, and the states it leaves behind.
 *
 * Pure, so it is cheap to test directly: events in, transcript and states out. The states are
 * the reason this file exists. A turn takes care of its own — `agent_start` claims the agent
 * and `agent_end` hands it back — but a **compaction has no agent run at all**: Pi emits
 * `compaction_start` and `compaction_end` and nothing else, and the shell's "thinking" went
 * up when the prompt was sent. Reading only the two notices out of those events left the row
 * saying "working" about an agent that had finished, which is the bug this covers: it is the
 * one place a state can be set that nothing else will take back.
 */
function transcript() {
	const sent: ServerMessage[] = [];
	const translator = new Translator("agent-1", (message) => sent.push(message), "/deck");
	const feed = (event: Record<string, unknown>) => handlePiEvent(translator, event as unknown as AgentSessionEvent);
	/** Every state the agent was put in, in order — what the chat list and the queue clock read. */
	const states = () => sent.filter((message) => message.type === "agent.state").map((message) => (message as { state: AgentState }).state);
	const notices = () => (translator.history().filter((item) => item.kind === "notice") as Array<Extract<ChatItem, { kind: "notice" }>>).map((item) => item.text);
	return { translator, feed, states, notices };
}

test("a compaction says the agent is working, and says when it has stopped", () => {
	const { feed, states, notices } = transcript();

	feed({ type: "compaction_start", reason: "manual" });
	assert.deepEqual(states(), ["thinking"], "a compaction is work, and Pi emits no agent_start for one");

	feed({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { summary: "s" } });
	assert.deepEqual(states(), ["thinking", "idle"], "and it ends where a turn ends, so nothing is left standing");

	assert.match(notices().join(" | "), /Compacting the conversation…/);
	assert.match(notices().join(" | "), /Compacted the conversation\./, "the end of it is readable, not only the start");
});

test("a compaction that failed or was cancelled still hands the agent back", () => {
	// Both are the same claim: nothing is running afterwards, whatever went wrong. A state
	// left standing here is a row that never stops working and a queue that never drains.
	for (const event of [
		{ aborted: true },
		{ aborted: false, errorMessage: "the summarisation request failed" },
	]) {
		const { feed, states, notices } = transcript();
		feed({ type: "compaction_start", reason: "manual" });
		feed({ type: "compaction_end", reason: "manual", willRetry: false, ...event });
		assert.deepEqual(states(), ["thinking", "idle"], JSON.stringify(event));
		assert.equal(notices().some((text) => /Compacted the conversation\./.test(text)), false, "nothing claims success");
	}
});

test("a compaction the turn carries on from leaves the agent working", () => {
	// An overflow compaction retries the turn that hit the wall. Coming down to idle between
	// the two would say the agent is free for the moment before it speaks again.
	const { feed, states } = transcript();
	feed({ type: "compaction_start", reason: "overflow" });
	feed({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true, result: { summary: "s" } });
	assert.deepEqual(states(), ["thinking"], "the turn it was compacting for is still to come");
});

test("a turn claims the agent on its way in and hands it back on its way out", () => {
	const { feed, states } = transcript();

	feed({ type: "agent_start" });
	feed({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: [] }, isError: false });
	assert.deepEqual(states(), ["thinking", "thinking"], "a finished tool is not a finished turn");

	feed({ type: "message_start", message: { role: "assistant" } });
	assert.deepEqual(states().at(-1), "streaming");
	feed({ type: "message_end", message: { role: "assistant" } });
	feed({ type: "agent_end", messages: [] });
	assert.equal(states().at(-1), "idle");
});
