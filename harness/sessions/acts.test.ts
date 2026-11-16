// Each kind's own write tool, fed to that runtime's event reader as the runtime sends it: the
// harness tells the server, as the agent, agent.act start when it begins and card.claim when it ends.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { clientFor } from "@decks/sdk";
import { fakeServer } from "@decks/sdk/testing";
import { AntigravityStream } from "../runtimes/antigravity/events.ts";
import { handleClaudeMessage, newStreamState } from "../runtimes/claude/events.ts";
import { OpencodeStream } from "../runtimes/opencode/events.ts";
import { Opencode2Stream } from "../runtimes/opencode2/events.ts";
import { handlePiEvent } from "../runtimes/pi/events.ts";
import { Translator } from "../runtimes/shared/translator.ts";
import { actWhat, writeTeller, writtenCard } from "./acts.ts";

const CARD = "canvases/plan/cards/notes/index.html";
const FILE = `/deck/${CARD}`;
const none = () => {};

/** A translator wired as the session wires it, against a fake server; the calls it made. */
async function kind(name: string, feed: (t: Translator) => void) {
	const fake = await fakeServer(4679, { "card.claim": (args) => [{ path: String(args.cards), title: "Notes" }] });
	try {
		const translator = new Translator("a1", none, "/deck");
		const client = clientFor(fake.url, fake.token);
		translator.onTool = writeTeller(() => client, "/deck");
		feed(translator);
		await new Promise((done) => setTimeout(done, 100));
		const calls = fake.calls.map((one) => [one.name, one.args]);
		assert.deepEqual(calls, [["agent.act", { cards: [CARD], phase: "start", what: actWhat("edit") }], ["card.claim", { cards: CARD }]], name);
	} finally {
		await fake.close();
	}
}

test("a write tool's file names its card; another tool, or a file outside a card, names none", () => {
	assert.equal(writtenCard("Edit", { file_path: FILE }, "/deck"), CARD);
	assert.equal(writtenCard("write", { path: "canvases/plan/cards/notes/card.css" }, "/deck"), CARD);
	assert.equal(writtenCard("read", { path: CARD }, "/deck"), undefined);
	assert.equal(writtenCard("edit", { path: "/elsewhere/x.md" }, "/deck"), undefined);
	assert.equal(actWhat("Write"), "write");
	assert.equal(actWhat("str_replace_based_edit_tool"), "edit");
});

test("Claude: Edit", () =>
	kind("claude", (t) => {
		const state = newStreamState();
		handleClaudeMessage(t, state, { type: "assistant", message: { content: [{ type: "tool_use", id: "c1", name: "Edit", input: { file_path: FILE, old_string: "a", new_string: "b" } }] } } as unknown as SDKMessage);
		handleClaudeMessage(t, state, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "ok" }] }] } } as unknown as SDKMessage);
	}));

test("Pi: edit", () =>
	kind("pi", (t) => {
		handlePiEvent(t, { type: "tool_execution_start", toolCallId: "c1", toolName: "edit", args: { path: CARD } } as unknown as AgentSessionEvent);
		handlePiEvent(t, { type: "tool_execution_end", toolCallId: "c1", toolName: "edit", result: { content: [] }, isError: false } as unknown as AgentSessionEvent);
	}));

test("opencode: edit", () =>
	kind("opencode", (t) => {
		const stream = new OpencodeStream(t, "ses_1", { idle: none, usage: none, model: none, permission: none });
		const part = (state: unknown) => ({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "p1", messageID: "m1", type: "tool", callID: "c1", tool: "edit", state } } });
		stream.handle(part({ status: "running", input: { filePath: FILE }, title: "edit" }));
		stream.handle(part({ status: "completed", input: { filePath: FILE }, output: "ok" }));
	}));

test("OpenCode 2: edit", () =>
	kind("opencode2", (t) => {
		const stream = new Opencode2Stream(t, "ses_1", { ended: none, usage: none, model: none, permission: none });
		const feed = (type: string, data: Record<string, unknown>) => stream.handle({ type, data: { sessionID: "ses_1", ...data } });
		feed("session.tool.input.started", { assistantMessageID: "m1", id: "c1", name: "edit" });
		feed("session.tool.called", { assistantMessageID: "m1", id: "c1", input: { filePath: FILE } });
		feed("session.tool.success", { assistantMessageID: "m1", id: "c1", content: [{ type: "text", text: "ok" }] });
	}));

test("Antigravity: replace_file_content", () =>
	kind("antigravity", (t) => {
		const stream = new AntigravityStream(t, { idle: none, conversation: none } as never);
		stream.step({ step_index: 1, state: "ACTIVE", step_type: "tool", tool_name: "replace_file_content", tool_info: { name: "replace_file_content", parameters: { TargetFile: FILE } } } as never);
		stream.step({ step_index: 1, state: "DONE", step_type: "tool", tool_name: "replace_file_content", tool_info: { name: "replace_file_content", parameters: {}, output: "ok" } } as never);
	}));
