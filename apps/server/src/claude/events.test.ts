import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatItem, ServerMessage } from "@decks/protocol";
import { Translator } from "../agents/translator.ts";
import { handleClaudeMessage, newStreamState, readClaudeToolResult } from "./events.ts";

/**
 * Reading Claude's stream into the transcript.
 *
 * Worth testing directly because it is pure: messages in, transcript out. The two things
 * that are easy to get wrong are both here — text arriving twice, and a tool result
 * arriving as a user message.
 */
function transcript() {
	const sent: ServerMessage[] = [];
	const translator = new Translator("agent-1", (message) => sent.push(message), "/deck");
	return { translator, state: newStreamState(), sent };
}

const items = (translator: Translator): ChatItem[] => translator.history();
const text = (translator: Translator) =>
	items(translator)
		.filter((item) => item.kind === "assistant")
		.map((item) => (item as Extract<ChatItem, { kind: "assistant" }>).text)
		.join("|");

test("streamed text becomes one assistant message", () => {
	const { translator, state } = transcript();
	const feed = (message: unknown) => handleClaudeMessage(translator, state, message as SDKMessage);

	feed({ type: "stream_event", event: { type: "message_start" } });
	feed({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
	feed({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } });
	feed({ type: "result", subtype: "success" });

	assert.equal(text(translator), "Hello");
});

test("a complete assistant message does not repeat what was streamed", () => {
	const { translator, state } = transcript();
	const feed = (message: unknown) => handleClaudeMessage(translator, state, message as SDKMessage);

	feed({ type: "stream_event", event: { type: "message_start" } });
	feed({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } });
	// The same turn's finished message, which the SDK also sends.
	feed({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } });
	feed({ type: "result", subtype: "success" });

	assert.equal(text(translator), "Hello", "not HelloHello");
});

test("a turn with no stream events still shows its reply", () => {
	const { translator, state } = transcript();
	handleClaudeMessage(translator, state, { type: "assistant", message: { content: [{ type: "text", text: "Only this" }] } } as SDKMessage);
	handleClaudeMessage(translator, state, { type: "result", subtype: "success" } as SDKMessage);
	assert.equal(text(translator), "Only this");
});

test("a tool call and its replayed result become one chip", () => {
	const { translator, state } = transcript();
	const feed = (message: unknown) => handleClaudeMessage(translator, state, message as SDKMessage);

	feed({
		type: "assistant",
		message: { content: [{ type: "tool_use", id: "call-1", name: "read", input: { path: "boards/plan.html" } }] },
	});
	let tool = items(translator).find((item) => item.kind === "tool") as Extract<ChatItem, { kind: "tool" }>;
	assert.ok(tool, "the call opens a chip");
	assert.equal(tool.state, "running");
	assert.equal(tool.name, "read");

	// Claude reports the result as a user-role message, not as a paired event.
	feed({
		type: "user",
		message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: [{ type: "text", text: "<html>" }] }] },
	});
	tool = items(translator).find((item) => item.kind === "tool") as Extract<ChatItem, { kind: "tool" }>;
	assert.equal(tool.state, "done");
	assert.equal(tool.result, "<html>");
});

test("a failed tool result is marked as an error", () => {
	const { translator, state } = transcript();
	const feed = (message: unknown) => handleClaudeMessage(translator, state, message as SDKMessage);
	feed({ type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "bash", input: {} }] } });
	feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c", content: "boom", is_error: true }] } });
	const tool = items(translator).find((item) => item.kind === "tool") as Extract<ChatItem, { kind: "tool" }>;
	assert.equal(tool.state, "error");
});

test("a turn that ends badly says so", () => {
	const { translator, state } = transcript();
	handleClaudeMessage(translator, state, { type: "result", subtype: "error_during_execution", result: "ran out" } as unknown as SDKMessage);
	const notice = items(translator).find((item) => item.kind === "notice") as Extract<ChatItem, { kind: "notice" }>;
	assert.ok(notice, "there is a notice");
	assert.equal(notice.level, "error");
	assert.match(notice.text, /error_during_execution/);
});

test("compaction is a system frame, not a type of its own", () => {
	const { translator, state } = transcript();
	handleClaudeMessage(translator, state, {
		type: "system",
		subtype: "compact_boundary",
		compact_metadata: { trigger: "auto", pre_tokens: 1 },
	} as unknown as SDKMessage);
	const notice = items(translator).find((item) => item.kind === "notice") as Extract<ChatItem, { kind: "notice" }>;
	assert.ok(notice);
	assert.match(notice.text, /Compacted/);
});

test("a tool result's content is either an array of blocks or a bare string", () => {
	assert.deepEqual(readClaudeToolResult("plain"), { text: "plain", images: 0 });
	assert.deepEqual(readClaudeToolResult([{ type: "text", text: "a" }, { type: "image" }]), { text: "a", images: 1 });
	assert.deepEqual(readClaudeToolResult(undefined), { text: "", images: 0 });
});
