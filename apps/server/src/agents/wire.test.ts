import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { forBrowser, TOOL_PREVIEW } from "./wire.ts";

type Tool = Extract<ChatItem, { kind: "tool" }>;
const tool = (patch: Partial<Tool> = {}): Tool => ({ kind: "tool", id: "A:t:1", name: "Bash", title: "ls", state: "done", ...patch });

test("a row that is not a tool call goes as it is", () => {
	const said: ChatItem = { kind: "assistant", id: "a1", text: "hello", at: 1 };
	assert.equal(forBrowser(said), said);
});

test("a tool call leaves its arguments behind, and keeps a short output whole", () => {
	const sent = forBrowser(tool({ args: { command: "x".repeat(5000) }, result: "done" })) as Tool;
	assert.equal("args" in sent, false);
	assert.equal(sent.result, "done");
	assert.equal(sent.full, undefined, "a whole output is not a preview");
	assert.equal(sent.title, "ls");
});

test("a long output is cut to a preview that says how long the whole of it is", () => {
	const whole = "line\n".repeat(1000);
	const sent = forBrowser(tool({ result: whole })) as Tool;
	assert.equal(sent.result?.length, TOOL_PREVIEW);
	assert.equal(sent.full, whole.length);
	assert.ok(whole.startsWith(sent.result ?? "#"));
});

test("the preview does not stop halfway through a character", () => {
	const whole = `${"a".repeat(TOOL_PREVIEW - 1)}😀${"b".repeat(50)}`;
	const sent = forBrowser(tool({ result: whole })) as Tool;
	assert.equal(sent.result, "a".repeat(TOOL_PREVIEW - 1));
});

test("the row the server keeps is not touched", () => {
	const kept = tool({ args: { path: "boards/plan.html" }, result: "z".repeat(TOOL_PREVIEW * 3) });
	forBrowser(kept);
	assert.deepEqual(kept.args, { path: "boards/plan.html" });
	assert.equal(kept.result?.length, TOOL_PREVIEW * 3);
	assert.equal(kept.full, undefined);
});
