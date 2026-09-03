import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolItem } from "./float-rows.ts";
import { distinctNames, toolSlots } from "./tool-groups.ts";

const call = (id: string, name: string, state: ToolItem["state"] = "done"): ToolItem => ({
	kind: "tool",
	id,
	name,
	title: name,
	state,
});

test("a run of finished calls goes behind one header", () => {
	const slots = toolSlots([call("t1", "read"), call("t2", "grep"), call("t3", "read")]);
	assert.deepEqual(slots.map((slot) => slot.kind), ["group"]);
	const group = slots[0];
	assert.equal(group?.kind, "group");
	if (group?.kind === "group") {
		assert.deepEqual(group.calls.map((each) => each.id), ["t1", "t2", "t3"]);
		assert.equal(group.id, "t1", "keyed on its first call, so the id is stable while the run grows");
	}
});

test("the call still running is kept out, and kept below the ones that finished", () => {
	const slots = toolSlots([call("t1", "read"), call("t2", "grep"), call("t3", "write", "running")]);
	assert.deepEqual(slots.map((slot) => slot.kind), ["group", "call"]);
	const live = slots[1];
	assert.equal(live?.kind, "call");
	if (live?.kind === "call") assert.equal(live.call.state, "running", "a group that hid it would stop indicating");
});

test("an errored call never collapses", () => {
	const slots = toolSlots([call("t1", "read"), call("t2", "edit", "error"), call("t3", "read"), call("t4", "read")]);
	assert.deepEqual(slots.map((slot) => slot.kind), ["call", "call", "group"]);
	const failed = slots[1];
	assert.equal(failed?.kind, "call");
	if (failed?.kind === "call") assert.equal(failed.call.id, "t2");
	// And the two finished calls after it are a group of their own rather than being swept
	// into the one before: the order says what happened when.
	const after = slots[2];
	if (after?.kind === "group") assert.deepEqual(after.calls.map((each) => each.id), ["t3", "t4"]);
});

test("one call is a row, not a header saying 1", () => {
	assert.deepEqual(toolSlots([call("t1", "read")]), [{ kind: "call", id: "t1", call: call("t1", "read") }]);
	assert.deepEqual(toolSlots([]), []);
});

test("a finished call on either side of a live one gives two rows and no header", () => {
	const slots = toolSlots([call("t1", "read"), call("t2", "write", "running"), call("t3", "read")]);
	assert.deepEqual(slots.map((slot) => slot.kind), ["call", "call", "call"]);
});

test("the names dedupe, keep the order they first ran in, and truncate", () => {
	const many = [call("t1", "read"), call("t2", "read"), call("t3", "grep"), call("t4", "glob"), call("t5", "edit")];
	assert.deepEqual(distinctNames(many), { names: ["read", "grep", "glob"], more: 1 });
	assert.deepEqual(distinctNames(many, 5), { names: ["read", "grep", "glob", "edit"], more: 0 });
	assert.deepEqual(distinctNames([call("t1", "read"), call("t2", "read")]), { names: ["read"], more: 0 });
	// A tool with no name of its own contributes nothing rather than an empty separator.
	assert.deepEqual(distinctNames([call("t1", " "), call("t2", "read")]), { names: ["read"], more: 0 });
});
