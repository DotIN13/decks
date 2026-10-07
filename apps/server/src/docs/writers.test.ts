import assert from "node:assert/strict";
import { test } from "node:test";
import { Writers } from "./writers.ts";

function setup() {
	let now = 1000;
	const writers = new Writers({
		name: (id) => ({ a1: "Wren", a2: "Tempo" })[id],
		cwd: () => "/deck",
		now: () => now,
	});
	return { writers, tick: (ms: number) => (now += ms) };
}

test("an edit tool naming the file credits its agent, by relative or absolute path", () => {
	const { writers } = setup();
	writers.tool("a1", { callId: "c1", name: "Edit", args: { file_path: "docs/paper.md", old_string: "a", new_string: "b" }, phase: "start" });
	assert.equal(writers.who("/deck/docs/paper.md"), "Wren");
	assert.equal(writers.who("/deck/docs/other.md"), undefined);
});

test("a script that names a .docx credits its agent, and the newest call wins", () => {
	const { writers, tick } = setup();
	writers.tool("a1", { callId: "c1", name: "Write", args: { file_path: "/deck/docs/form.docx" }, phase: "start" });
	writers.tool("a1", { callId: "c1", name: "Write", args: {}, phase: "end" });
	tick(500);
	writers.tool("a2", { callId: "c2", name: "Bash", args: { command: "python3 fix.py docs/form.docx" }, phase: "start" });
	assert.equal(writers.who("/deck/docs/form.docx"), "Tempo");
});

test("a call that ended a while ago, or a read, explains nothing", () => {
	const { writers, tick } = setup();
	writers.tool("a1", { callId: "c1", name: "Edit", args: { file_path: "/deck/a.md" }, phase: "start" });
	writers.tool("a1", { callId: "c1", name: "Edit", args: {}, phase: "end" });
	tick(5000);
	writers.tool("a2", { callId: "c2", name: "Read", args: { file_path: "/deck/a.md" }, phase: "start" });
	assert.equal(writers.who("/deck/a.md"), undefined);
});
