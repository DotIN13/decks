import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentUsage, ChatItem, ServerMessage } from "@decks/protocol";
import { Translator } from "../agents/translator.ts";
import { AntigravityStream } from "./events.ts";

/**
 * Reading the `agy` stream into the transcript.
 *
 * Worth testing directly because it is pure: events in, transcript out. Four things here
 * are easy to get wrong and were each learned by watching a live session — the prompt
 * coming back as a `user_input` step, text arriving on both `ACTIVE` and `DONE` agent
 * steps, a tool call opening and closing with the same `step_index`, and the accumulated
 * `response` on the result being a repeat of what the deltas already said.
 */
function transcript(conversation: (id: string) => void = () => {}) {
	const sent: ServerMessage[] = [];
	const translator = new Translator("agent-1", (message) => sent.push(message), "/deck");
	let idle = 0;
	let usage: AgentUsage | undefined;
	let status = "";
	let conv = "";
	const stream = new AntigravityStream(translator, {
		idle: (reading, finalStatus) => {
			idle += 1;
			usage = reading;
			status = finalStatus;
		},
		conversation: (id) => {
			conversation(id);
			conv = id;
		},
	});
	return {
		stream,
		translator,
		step: (step: unknown) => stream.step(step as never),
		result: (result: unknown) => stream.result(result as never),
		init: (payload: unknown) => stream.init(payload as never),
		idles: () => idle,
		usage: () => usage,
		status: () => status,
		conv: () => conv,
	};
}

const said = (translator: Translator) =>
	translator
		.history()
		.filter((item): item is Extract<ChatItem, { kind: "assistant" }> => item.kind === "assistant")
		.map((item) => item.text)
		.join("|");

const tools = (translator: Translator) =>
	translator.history().filter((item): item is Extract<ChatItem, { kind: "tool" }> => item.kind === "tool");

const notices = (translator: Translator) =>
	translator.history().filter((item): item is Extract<ChatItem, { kind: "notice" }> => item.kind === "notice");

test("deltas across ACTIVE and DONE become one assistant message", () => {
	const t = transcript();
	t.step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Hel" });
	t.step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "lo" });
	t.step({ step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "\n" });
	t.result({ status: "SUCCESS", response: "Hello\n" });
	assert.equal(said(t.translator), "Hello\n");
	assert.equal(t.idles(), 1);
	assert.equal(t.status(), "SUCCESS");
});

test("the prompt coming back is not the assistant talking", () => {
	const t = transcript();
	t.step({ step_index: 0, state: "DONE", step_type: "user_input" });
	t.result({ status: "SUCCESS", response: "" });
	assert.equal(said(t.translator), "");
});

test("a tool call opens at ACTIVE and closes at DONE with its result", () => {
	const t = transcript();
	t.step({
		step_index: 2,
		state: "ACTIVE",
		step_type: "tool",
		tool_name: "call_mcp_tool",
		tool_info: { name: "call_mcp_tool", parameters: { ServerName: "decks", ToolName: "stage_eval", Arguments: { code: "return 1" } } },
	});
	t.step({
		step_index: 2,
		state: "DONE",
		step_type: "tool",
		tool_name: "call_mcp_tool",
		tool_info: { name: "call_mcp_tool", parameters: {}, output: "4" },
	});
	t.result({ status: "SUCCESS", response: "" });
	const calls = tools(t.translator);
	assert.equal(calls.length, 1, "one chip, not two");
	assert.equal(calls[0]!.name, "call_mcp_tool");
	// The chip names the tool inside the CLI's one lever, so a canvas call is readable.
	assert.equal(calls[0]!.title, "call_mcp_tool · stage_eval");
	assert.equal(calls[0]!.state, "done");
	assert.equal(calls[0]!.result, "4");
});

test("a failed tool reads as failed", () => {
	const t = transcript();
	t.step({ step_index: 3, state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: {} } });
	t.step({
		step_index: 3,
		state: "ERROR",
		step_type: "tool",
		tool_name: "run_command",
		tool_info: { name: "run_command", parameters: {}, error: { type: "TOOL_ERROR", message: "boom" } },
	});
	assert.equal(tools(t.translator)[0]!.state, "error");
	assert.equal(tools(t.translator)[0]!.result, "boom");
});

test("a reply and a tool call are two things in the column", () => {
	const t = transcript();
	t.step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Let me look" });
	t.step({ step_index: 2, state: "ACTIVE", step_type: "tool", tool_name: "stage_eval", tool_info: { name: "stage_eval", parameters: { code: "1" } } });
	t.step({ step_index: 2, state: "DONE", step_type: "tool", tool_name: "stage_eval", tool_info: { name: "stage_eval", parameters: {}, output: "4" } });
	const assistant = t.translator.history().filter((item) => item.kind === "assistant");
	const call = tools(t.translator);
	assert.equal(assistant.length, 1, "the bubble closes before the chip opens");
	assert.equal(call.length, 1);
});

test("the result's accumulated response is not said twice", () => {
	// Deltas carried the whole reply; `result.response` is the same text again. The
	// turn's news is usage and status, not another copy of the words.
	const t = transcript();
	t.step({ step_index: 1, state: "DONE", step_type: "agent_response", text_delta: "walnut" });
	t.result({ status: "SUCCESS", response: "walnut\n", usage: { total_tokens: 17, input_tokens: 11, output_tokens: 4 } });
	assert.equal(said(t.translator), "walnut");
	assert.deepEqual(t.usage(), { contextTokens: 17, contextWindow: 0, cost: 0 });
});

test("an ERROR result ends the reply and says so", () => {
	const t = transcript();
	t.step({ step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "half" });
	t.result({ status: "ERROR", error: "invalid model selection (--model \"does-not-exist\"): no such model" });
	assert.equal(t.idles(), 1, "an error is still a finished turn");
	assert.equal(t.status(), "ERROR");
	assert.match(notices(t.translator)[0]!.text, /does-not-exist/);
});

test("a soft-denied tool becomes a warning, not a crash", () => {
	const t = transcript();
	t.result({ status: "SUCCESS", denied_actions: [{ action: "mcp", display_name: "MCP" }, { action: "read_file", display_name: "ViewFile" }] });
	assert.match(notices(t.translator).map((n) => n.text).join(" "), /MCP/);
	assert.equal(t.status(), "SUCCESS");
});

test("the unexplained steps of a newer CLI are ignored", () => {
	const t = transcript();
	t.step({ step_index: 1, state: "DONE", step_type: "checkpoint", duration_seconds: 0.5, usage: { input_tokens: 10 } });
	t.step({ step_index: 2, state: "DONE", step_type: "something_else" });
	t.result({ status: "SUCCESS" });
	assert.equal(t.translator.history().length, 0);
});

test("init reports the conversation, once", () => {
	const t = transcript();
	t.init({ conversation_id: "153f701e-11e4-4952-bfa8-10992149b960", model: "gemini-3.8-flash-low" });
	assert.equal(t.conv(), "153f701e-11e4-4952-bfa8-10992149b960");
});

test("usage with no numbers is unknown, not zero", () => {
	const t = transcript();
	t.result({ status: "SUCCESS", response: "" });
	assert.deepEqual(t.usage(), { contextTokens: null, contextWindow: 0, cost: 0 });
});