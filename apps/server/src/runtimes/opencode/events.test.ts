import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentUsage, ChatItem, ServerMessage } from "@decks/protocol";
import { Translator } from "../../agents/translator.ts";
import { OpencodeStream } from "./events.ts";

/**
 * Reading opencode's stream into the transcript.
 *
 * Worth testing directly because it is pure: events in, transcript out. Three things here
 * are easy to get wrong and two of them were wrong first time — the prompt coming back as
 * parts of a *user* message, text arriving both as deltas and as a finished part, and one
 * event stream carrying more than one session.
 */
function transcript(sessionId = "ses_1") {
	const sent: ServerMessage[] = [];
	const translator = new Translator("agent-1", (message) => sent.push(message), "/deck");
	let idle = 0;
	let usage: AgentUsage | undefined;
	let model: string | undefined;
	const asked: Array<{ id: string; kind: string; title: string | undefined }> = [];
	const stream = new OpencodeStream(translator, sessionId, {
		idle: () => (idle += 1),
		usage: (reading) => (usage = reading),
		model: (provider, name) => (model = `${provider}/${name}`),
		permission: (id, kind, title) => asked.push({ id, kind, title }),
	});
	return {
		stream,
		translator,
		sent,
		feed: (event: unknown) => stream.handle(event),
		idles: () => idle,
		usage: () => usage,
		model: () => model,
		asked: () => asked,
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

test("deltas become one assistant message", () => {
	const t = transcript();
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "text", delta: "Hel" } });
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "text", delta: "lo" } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	assert.equal(said(t.translator), "Hello");
	assert.equal(t.idles(), 1);
});

test("a finished part does not repeat what the deltas already said", () => {
	const t = transcript();
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "text", delta: "Hello" } });
	t.feed({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "text", text: "Hello there" } } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	// Only the tail the deltas had not carried.
	assert.equal(said(t.translator), "Hello there");
});

test("a part that never streamed is said whole", () => {
	const t = transcript();
	t.feed({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "text", text: "short" } } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	assert.equal(said(t.translator), "short");
});

test("the prompt coming back is not the assistant talking", () => {
	/*
	 * opencode publishes the user's own message as parts on the same stream and in the
	 * same shape as the reply. Before this filter existed, every turn opened with the
	 * transcript saying the user's words back to them in the assistant's voice.
	 */
	const t = transcript();
	t.feed({ type: "message.updated", properties: { sessionID: "ses_1", info: { id: "m0", role: "user" } } });
	t.feed({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p0", messageID: "m0", type: "text", text: "do the thing" } } });
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m0", partID: "p0", field: "text", delta: "do the thing" } });
	t.feed({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "text", text: "done" } } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	assert.equal(said(t.translator), "done");
});

test("opencode's own scaffolding is not a reply either", () => {
	const t = transcript();
	t.feed({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "text", text: "summary", synthetic: true } } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	assert.equal(said(t.translator), "");
});

test("reasoning goes to the thinking block, not the reply", () => {
	const t = transcript();
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "reasoning", delta: "hmm" } });
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p2", field: "text", delta: "yes" } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	const item = t.translator.history().find((i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant")!;
	assert.equal(item.text, "yes");
	assert.equal(item.thinking, "hmm");
});

test("a tool call opens once and closes with its result", () => {
	const t = transcript();
	const part = (state: unknown) => ({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "tool", callID: "c1", tool: "stage_eval", state } } });
	t.feed(part({ status: "pending", input: { code: "1" } }));
	t.feed(part({ status: "running", input: { code: "1" }, title: "stage_eval" }));
	t.feed(part({ status: "completed", input: { code: "1" }, output: "4", title: "stage_eval" }));
	t.feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	const calls = tools(t.translator);
	assert.equal(calls.length, 1, "pending then running must not be two chips");
	assert.equal(calls[0]!.name, "stage_eval");
	assert.equal(calls[0]!.state, "done");
	assert.equal(calls[0]!.result, "4");
});

test("a failed tool reads as failed", () => {
	const t = transcript();
	const part = (state: unknown) => ({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "tool", callID: "c1", tool: "bash", state } } });
	t.feed(part({ status: "running", input: {}, title: "bash" }));
	t.feed(part({ status: "error", input: {}, error: "exit 1" }));
	assert.equal(tools(t.translator)[0]!.state, "error");
	assert.equal(tools(t.translator)[0]!.result, "exit 1");
});

test("another session on the same stream is not this chat", () => {
	// One server can hold more than one session, and every event is tagged. Without the
	// filter, two agents on one server would write into each other's transcripts.
	const t = transcript("ses_1");
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_2", messageID: "m9", partID: "p9", field: "text", delta: "not mine" } });
	t.feed({ type: "session.idle", properties: { sessionID: "ses_2" } });
	assert.equal(said(t.translator), "");
	assert.equal(t.idles(), 0, "another session going idle must not end this turn");
});

test("two agents on one shared server each read their own transcript", () => {
	// The two halves of the filter, listened to at once: the same single event stream
	// carries both conversations, and each one lands only in its own transcript — the
	// reply, the usage and the idle all stay on the session they were tagged with.
	const a = transcript("ses_1");
	const b = transcript("ses_2");
	const feed = (event: unknown) => {
		a.feed(event);
		b.feed(event);
	};
	feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "text", delta: "hi" } });
	feed({ type: "message.part.delta", properties: { sessionID: "ses_2", messageID: "m2", partID: "p2", field: "text", delta: "yo" } });
	feed({ type: "session.idle", properties: { sessionID: "ses_1" } });
	feed({ type: "session.idle", properties: { sessionID: "ses_2" } });
	assert.equal(said(a.translator), "hi");
	assert.equal(said(b.translator), "yo");
	assert.equal(a.idles(), 1, "one idle ends one turn, and only its own");
	assert.equal(b.idles(), 1);
});

test("the server talking about itself is ignored", () => {
	const t = transcript();
	t.feed({ type: "plugin.added", properties: { id: "core/config-reference" } });
	t.feed({ type: "catalog.updated", properties: {} });
	assert.equal(t.translator.history().length, 0);
});

test("an assistant message reports what it used, and on what", () => {
	const t = transcript();
	t.feed({
		type: "message.updated",
		properties: {
			sessionID: "ses_1",
			info: { id: "m1", role: "assistant", providerID: "opencode", modelID: "muse-spark", cost: 0.25, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 0 } } },
		},
	});
	assert.equal(t.model(), "opencode/muse-spark");
	assert.deepEqual(t.usage(), { contextTokens: 117, contextWindow: 0, cost: 0.25 });
});

test("an error ends the reply and says so", () => {
	const t = transcript();
	t.feed({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "m1", partID: "p1", field: "text", delta: "half" } });
	t.feed({ type: "session.error", properties: { sessionID: "ses_1", error: { name: "ProviderAuthError", data: { message: "no key" } } } });
	const notices = t.translator.history().filter((item) => item.kind === "notice");
	assert.equal(notices.length, 1);
	assert.match((notices[0] as Extract<ChatItem, { kind: "notice" }>).text, /no key/);
});

test("a permission request is handed to the backend, not merely noticed", () => {
	/*
	 * A request opencode never gets an answer to holds the tool call forever, so the
	 * stream must pass it on. `type` names the permission; a frame without one cannot be
	 * answered and must not reach the backend pretending it can.
	 */
	const t = transcript();
	t.feed({ type: "permission.updated", properties: { sessionID: "ses_1", id: "per_1", type: "external_directory", title: "Read /tmp/board.png" } });
	t.feed({ type: "permission.updated", properties: { sessionID: "ses_1", id: "per_2", type: "bash", title: "Run a command" } });
	t.feed({ type: "permission.updated", properties: { sessionID: "ses_1", title: "nameless" } });
	assert.deepEqual(t.asked(), [
		{ id: "per_1", kind: "external_directory", title: "Read /tmp/board.png" },
		{ id: "per_2", kind: "bash", title: "Run a command" },
	]);
});
