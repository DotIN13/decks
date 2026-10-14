import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem, ServerMessage } from "@decks/protocol";
import { Translator } from "../../agents/translator.ts";
import { Opencode2Stream } from "./events.ts";

/**
 * Reading OpenCode 2's stream into the transcript.
 *
 * The events are the shapes a live OpenCode 2.0.29 server sent for one turn with a tool call
 * (recorded 2026-10-14), trimmed to the fields read here.
 */
function transcript(sessionId = "ses_1") {
	const sent: ServerMessage[] = [];
	const translator = new Translator("agent-1", (message) => sent.push(message), "/deck");
	const ended: string[] = [];
	const readings: Array<{ context?: number | null; cost?: number }> = [];
	const models: string[] = [];
	const asked: Array<{ id: string; action: string; message: string | undefined }> = [];
	const stream = new Opencode2Stream(translator, sessionId, {
		ended: (outcome) => ended.push(outcome),
		usage: (reading) => readings.push(reading),
		model: (provider, model, variant) => models.push(`${provider}/${model}/${variant ?? ""}`),
		permission: (id, action, message) => asked.push({ id, action, message }),
	});
	return { translator, feed: (type: string, data: Record<string, unknown>) => stream.handle({ type, data: { sessionID: sessionId, ...data } }), ended, readings, models, asked, stream };
}

const said = (translator: Translator) =>
	translator
		.history()
		.filter((item): item is Extract<ChatItem, { kind: "assistant" }> => item.kind === "assistant")
		.map((item) => item.text)
		// Reasoning opens an assistant item of its own, with the thinking and no text.
		.filter(Boolean)
		.join("|");

const tools = (translator: Translator) => translator.history().filter((item): item is Extract<ChatItem, { kind: "tool" }> => item.kind === "tool");

const M1 = { assistantMessageID: "msg_1", ordinal: 0 };
const M2 = { assistantMessageID: "msg_2", ordinal: 0 };

test("a turn with a tool call becomes the reply, the call and its result, and then ends", () => {
	const t = transcript();
	t.feed("session.step.started", { model: { id: "deepseek-v4.1-flash", providerID: "opencode-go", variant: "high" }, assistantMessageID: "msg_1" });
	t.feed("session.reasoning.delta", { ...M1, delta: "Let me call it." });
	t.feed("session.tool.input.started", { assistantMessageID: "msg_1", id: "call_1", name: "stage_eval" });
	t.feed("session.reasoning.ended", { ...M1, text: "Let me call it." });
	t.feed("session.tool.called", { assistantMessageID: "msg_1", id: "call_1", input: { code: "return 1+1" } });
	t.feed("session.tool.success", { assistantMessageID: "msg_1", id: "call_1", content: [{ type: "text", text: "2" }] });
	t.feed("session.step.ended", { tokens: { input: 3825, output: 43, reasoning: 74, cache: { read: 2688, write: 0 } }, cost: 0.00065 });
	t.feed("session.text.delta", { ...M2, delta: "The stage tool returned 2." });
	t.feed("session.text.ended", { ...M2, text: "The stage tool returned 2." });
	t.feed("session.execution.succeeded", {});
	t.feed("session.usage.updated", { cost: 0.0012, tokens: { input: 9000, output: 90, reasoning: 74, cache: { read: 5000, write: 0 } } });

	assert.equal(said(t.translator), "The stage tool returned 2.", "the closing event does not say the reply twice");
	const [call] = tools(t.translator);
	assert.equal(call?.name, "stage_eval", "the name comes from the one event that carries it");
	assert.deepEqual(call?.args, { code: "return 1+1" });
	assert.equal(call?.result, "2");
	assert.equal(call?.state, "done");
	assert.deepEqual(t.ended, ["succeeded"]);
	assert.deepEqual(t.models, ["opencode-go/deepseek-v4.1-flash/high"]);
	assert.deepEqual(t.readings, [{ context: 3825 + 43 + 74 + 2688 }, { cost: 0.0012 }], "context from the step, only cost from the running totals");
});

test("a run that never streamed is said whole at its end", () => {
	const t = transcript();
	t.feed("session.text.ended", { ...M1, text: "Short." });
	t.feed("session.execution.succeeded", {});
	assert.equal(said(t.translator), "Short.");
});

test("another session's events are not this chat's", () => {
	const t = transcript("ses_1");
	t.stream.handle({ type: "session.text.delta", data: { sessionID: "ses_2", ...M1, delta: "not mine" } });
	t.stream.handle({ type: "session.execution.succeeded", data: { sessionID: "ses_2" } });
	assert.equal(said(t.translator), "");
	assert.deepEqual(t.ended, []);
});

test("a failed turn says its error once and still ends", () => {
	const t = transcript();
	t.feed("session.step.failed", { error: { type: "provider.no-route", message: "Model unavailable" } });
	t.feed("session.execution.failed", { error: { type: "provider.no-route", message: "Model unavailable" } });
	const notices = t.translator.history().filter((item) => item.kind === "notice");
	assert.equal(notices.length, 1);
	assert.deepEqual(t.ended, ["failed"]);
});

test("an interrupted turn closes the tool calls it left open", () => {
	const t = transcript();
	t.feed("session.tool.input.started", { id: "call_1", name: "shell" });
	t.feed("session.tool.called", { id: "call_1", input: { command: "sleep 100" } });
	t.feed("session.execution.interrupted", { reason: "user" });
	const [call] = tools(t.translator);
	assert.equal(call?.state, "error");
	assert.deepEqual(t.ended, ["interrupted"]);
});

test("a permission request reaches the backend with what it asks for", () => {
	const t = transcript();
	t.feed("permission.asked", { id: "per_1", action: "shell", resources: ["ls"], message: "run ls" });
	t.feed("permission.asked", { action: "shell" });
	assert.deepEqual(t.asked, [{ id: "per_1", action: "shell", message: "run ls" }], "a request with no id cannot be answered, so it is not passed on");
});

test("moving the session runs as an execution of its own, and ends no turn", () => {
	const t = transcript();
	t.feed("session.execution.started", {});
	t.feed("session.moved", { directory: "/iso" });
	t.feed("session.execution.succeeded", {});
	assert.deepEqual(t.ended, [], "the move is not the agent's turn");
	t.feed("session.execution.started", {});
	t.feed("session.step.started", { model: { id: "m", providerID: "p" } });
	t.feed("session.text.delta", { ...M1, delta: "ok" });
	t.feed("session.execution.succeeded", {});
	assert.deepEqual(t.ended, ["succeeded"]);
});
