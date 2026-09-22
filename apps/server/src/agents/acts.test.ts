import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "@decks/protocol";
import { Acts, blockAt, changedBlocks, fileNamed, END_GRACE_MS, HOLD_LIMIT_MS, MAX_IDS } from "./acts.ts";

const board = (blocks: string) => `<!doctype html><html><head><title>t</title></head><body class="board">\n${blocks}\n</body></html>`;
const ONE = board(`<div class="doc" data-id="doc"><h1>Title</h1><p>one</p></div>\n<aside class="card" data-id="aside">side</aside>`);
const TWO = board(`<div class="doc" data-id="doc"><h1>Title</h1><p>two</p></div>\n<aside class="card" data-id="aside">side</aside>`);
const THREE = board(`<div class="doc" data-id="doc"><h1>Title</h1><p>two</p></div>\n<aside class="card" data-id="aside">side</aside>\n<div class="card" data-id="new">new</div>`);

test("fileNamed: write and edit tools name their file; a read does not", () => {
	assert.equal(fileNamed("Write", { file_path: "/deck/boards/a.html", content: "x" }), "/deck/boards/a.html");
	assert.equal(fileNamed("Edit", { file_path: "/deck/boards/a.html", old_string: "a", new_string: "b" }), "/deck/boards/a.html");
	assert.equal(fileNamed("MultiEdit", { file_path: "/deck/boards/a.html" }), "/deck/boards/a.html");
	assert.equal(fileNamed("write", { path: "boards/a.html" }), "boards/a.html");
	assert.equal(fileNamed("edit", { path: "boards/a.html" }), "boards/a.html");
	assert.equal(fileNamed("str_replace_based_edit_tool", { path: "boards/a.html" }), "boards/a.html");
	assert.equal(fileNamed("Read", { file_path: "/deck/boards/a.html" }), undefined);
	assert.equal(fileNamed("Bash", { command: "sed -i s/a/b/ boards/a.html" }), undefined);
	assert.equal(fileNamed("Write", "nope"), undefined);
});

test("blockAt: the root block whose source holds the old text", () => {
	assert.equal(blockAt(ONE, "<p>one</p>"), "doc");
	assert.equal(blockAt(ONE, "side"), "aside");
	assert.equal(blockAt(ONE, "<title>t</title>"), undefined);
	assert.equal(blockAt(ONE, "not there"), undefined);
});

test("changedBlocks: the blocks whose markup differs, and the new ones", () => {
	assert.deepEqual(changedBlocks(ONE, ONE), []);
	assert.deepEqual(changedBlocks(ONE, TWO), ["doc"]);
	assert.deepEqual(changedBlocks(TWO, THREE), ["new"]);
	assert.deepEqual(changedBlocks("", THREE), ["doc", "aside", "new"]);
	// A block that went away is not named: there is nowhere to draw it.
	assert.deepEqual(changedBlocks(THREE, TWO), []);
});

/** A host whose clock and timers the test holds. */
function host(files: Record<string, string>) {
	const sent: ServerMessage[] = [];
	const timers: Array<{ ms: number; run: () => void; live: boolean }> = [];
	const acts = new Acts({
		emit: (message) => sent.push(message),
		identity: (id) => (id === "gone" ? undefined : { name: `Agent ${id}`, color: "#123456" }),
		boardPathOf: (file) => (file.startsWith("/deck/") && files[file.slice(6)] !== undefined ? file.slice(6) : undefined),
		read: (path) => files[path],
		schedule: (ms, run) => {
			const timer = { ms, run, live: true };
			timers.push(timer);
			return () => {
				timer.live = false;
			};
		},
		now: () => 1000,
	});
	const fire = (ms: number) => {
		for (const timer of timers.splice(0)) if (timer.live && timer.ms === ms) timer.run();
	};
	const acted = () => sent.filter((m): m is Extract<ServerMessage, { type: "agent.act" }> => m.type === "agent.act");
	return { acts, sent, acted, fire, timers };
}

test("an edit tool call holds the block the old text is in, and the landing says what changed", () => {
	const files = { "boards/a.html": ONE };
	const h = host(files);
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Edit", args: { file_path: "/deck/boards/a.html", old_string: "<p>one</p>", new_string: "<p>two</p>" }, phase: "start" } });
	assert.deepEqual(h.acted(), [{ type: "agent.act", agentId: "a1", path: "boards/a.html", phase: "start", what: "edit", ids: ["doc"], label: "Agent a1", color: "#123456", at: 1000 }]);
	files["boards/a.html"] = TWO;
	h.acts.landed("boards/a.html", TWO);
	assert.equal(h.acted().length, 2);
	assert.deepEqual(h.acted()[1], { type: "agent.act", agentId: "a1", path: "boards/a.html", phase: "done", what: "edit", ids: ["doc"], label: "Agent a1", color: "#123456", at: 1000 });
	// The tool's own end after the landing says nothing more: the hold was already let go.
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Edit", args: { file_path: "/deck/boards/a.html" }, phase: "end" } });
	h.fire(END_GRACE_MS);
	assert.equal(h.acted().length, 2);
});

test("a write tool call holds the whole board, and a landing that changes everything names no block", () => {
	const many = board(Array.from({ length: MAX_IDS + 1 }, (_, i) => `<div data-id="b${i}">${i}</div>`).join("\n"));
	const files = { "boards/a.html": ONE };
	const h = host(files);
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Write", args: { file_path: "/deck/boards/a.html", content: many }, phase: "start" } });
	assert.equal(h.acted()[0]?.ids, undefined);
	h.acts.landed("boards/a.html", many);
	assert.equal(h.acted()[1]?.phase, "done");
	assert.equal(h.acted()[1]?.ids, undefined, "more than MAX_IDS changed blocks is a rewrite of the board");
});

test("a tool that ends without the file landing lets go after a grace, and a lost one after the limit", () => {
	const h = host({ "boards/a.html": ONE });
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Edit", args: { file_path: "/deck/boards/a.html", old_string: "nope" }, phase: "start" } });
	assert.equal(h.acted()[0]?.ids, undefined, "old text not in the file: the board is held, not a block");
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Edit", args: { file_path: "/deck/boards/a.html" }, phase: "end" } });
	assert.equal(h.acted().length, 1);
	h.fire(END_GRACE_MS);
	assert.deepEqual(h.acted()[1], { type: "agent.act", agentId: "a1", path: "boards/a.html", phase: "done", what: "edit", label: "Agent a1", color: "#123456", at: 1000 });

	const lost = host({ "boards/a.html": ONE });
	lost.acts.act("a1", { kind: "tool", event: { callId: "c2", name: "Write", args: { file_path: "/deck/boards/a.html" }, phase: "start" } });
	lost.fire(HOLD_LIMIT_MS);
	assert.equal(lost.acted()[1]?.phase, "done");
	// A landing after the limit is nobody's: the hold is gone.
	lost.acts.landed("boards/a.html", TWO);
	assert.equal(lost.acted().length, 2);
});

test("a tool on a file that is not a board, or by an agent that is gone, says nothing", () => {
	const h = host({ "boards/a.html": ONE });
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Write", args: { file_path: "/deck/assets/x.png" }, phase: "start" } });
	h.acts.act("a1", { kind: "tool", event: { callId: "c2", name: "Write", args: { file_path: "/elsewhere/boards/a.html" }, phase: "start" } });
	h.acts.act("gone", { kind: "tool", event: { callId: "c3", name: "Write", args: { file_path: "/deck/boards/a.html" }, phase: "start" } });
	assert.deepEqual(h.acted(), []);
	// The gone agent's hold still exists and is dropped whole with the agent.
	h.acts.forget("gone");
	h.acts.landed("boards/a.html", TWO);
	assert.deepEqual(h.acted(), []);
});

test("a stage verb is a done act with no diff", () => {
	const h = host({ "boards/a.html": ONE });
	h.acts.act("a1", { kind: "verb", what: "resize", path: "boards/a.html" });
	assert.deepEqual(h.acted(), [{ type: "agent.act", agentId: "a1", path: "boards/a.html", phase: "done", what: "resize", label: "Agent a1", color: "#123456", at: 1000 }]);
});

test("a second tool call on the same board replaces the first hold", () => {
	const h = host({ "boards/a.html": ONE });
	h.acts.act("a1", { kind: "tool", event: { callId: "c1", name: "Edit", args: { file_path: "/deck/boards/a.html", old_string: "side" }, phase: "start" } });
	h.acts.act("a2", { kind: "tool", event: { callId: "c2", name: "Edit", args: { file_path: "/deck/boards/a.html", old_string: "<p>one</p>" }, phase: "start" } });
	h.acts.landed("boards/a.html", TWO);
	const done = h.acted().filter((m) => m.phase === "done");
	assert.equal(done.length, 1);
	assert.equal(done[0]?.agentId, "a2");
	// The first hold's limit timer was cancelled with it.
	h.fire(HOLD_LIMIT_MS);
	assert.equal(h.acted().filter((m) => m.phase === "done").length, 1);
});
