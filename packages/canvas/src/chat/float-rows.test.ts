import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { floatRows } from "./float-rows.ts";

const user = (id: string, text = "hello"): ChatItem => ({ kind: "user", id, text, at: 1 });
const assistant = (id: string, text: string, streaming = false, thinking?: string): ChatItem => ({ kind: "assistant", id, text, at: 2, streaming, ...(thinking ? { thinking } : {}) });
const tool = (id: string, name: string, state: "running" | "done" | "error" = "done"): ChatItem => ({ kind: "tool", id, name, title: name, state });
const notice = (id: string, text: string, level: "info" | "warn" | "error" = "info"): ChatItem => ({ kind: "notice", id, text, level, at: 4 });

test("user and assistant items become bubbles, tools collapse into one row", () => {
	const rows = floatRows([user("u1"), assistant("a1", "a reply"), tool("t1", "read_file"), tool("t2", "write_file"), user("u2"), assistant("a2", "done")]);
	assert.deepEqual(rows.map((row) => row.kind), ["user", "assistant", "tools", "user", "assistant"]);
	const tools = rows[2];
	assert.equal(tools?.kind, "tools");
	if (tools?.kind === "tools") assert.deepEqual(tools.calls.map((call) => call.name), ["read_file", "write_file"]);
});

test("tool rows remember the worst state — running or error", () => {
	const rows = floatRows([user("u1"), tool("t1", "a", "done"), tool("t2", "b", "running"), tool("t3", "c", "done")]);
	const tools = rows[1];
	assert.equal(tools?.kind, "tools");
	if (tools?.kind === "tools") {
		assert.equal(tools.running, true);
		assert.equal(tools.failed, false);
	}
	const failed = floatRows([user("u1"), tool("t1", "a", "error"), tool("t2", "b", "done")])[1];
	assert.equal(failed?.kind, "tools");
	if (failed?.kind === "tools") assert.equal(failed.failed, true);
});

/*
 * A bubble needs something in it — including while it is arriving, which is the part that
 * changed. A reply is created the moment the model starts, and drawing a card for it put an
 * empty box in the column until the first token: seconds for a model that thinks first, and
 * the whole of an opening tool call for a turn that starts with one, after which the box
 * silently vanished again. The server no longer announces a reply that early; this is the
 * same rule read from the other end, for a browser handed a history mid-turn.
 */
test("an assistant bubble with nothing in it has nothing to float", () => {
	assert.deepEqual(floatRows([user("u1"), assistant("a1", ""), assistant("a2", " real")]).map((row) => row.id), ["u1", "a2"]);
	assert.deepEqual(floatRows([user("u1"), assistant("a1", "", true)]).map((row) => row.id), ["u1"], "not even while it is streaming");

	// One token in, and it is a bubble — as is a reply that is so far only thinking.
	assert.equal(floatRows([user("u1"), assistant("a1", "H", true)])[1]?.kind, "assistant");
	assert.equal(floatRows([user("u1"), assistant("a1", "", true, "weighing it up")])[1]?.kind, "assistant");
});

test("rows before the first user message belong to their own turn", () => {
	const rows = floatRows([notice("n1", "starting up"), assistant("a1", "hello, what should we learn?")]);
	for (const row of rows) assert.equal(row.turnId, "n1");
});

test("turn ids move with the user message that starts them", () => {
	const rows = floatRows([user("u1"), assistant("a1", "first"), tool("t1", "read_file"), user("u2"), assistant("a2", "second")]);
	assert.deepEqual(rows.map((row) => row.turnId), ["u1", "u1", "u1", "u2", "u2"]);
});

test("tool runs do not merge across turns", () => {
	const rows = floatRows([tool("t1", "a"), user("u1"), tool("t2", "b"), assistant("a1", "ok")]);
	assert.deepEqual(rows.map((row) => row.kind), ["tools", "user", "tools", "assistant"]);
});