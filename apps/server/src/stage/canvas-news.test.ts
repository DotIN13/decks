import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { penWriter } from "./pens.ts";

/*
 * An agent is told, with its next message, what others changed on its canvas since its last one
 * (`agents/canvas-news.ts`): a person's edit and another agent's are, its own is not.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-canvas-news-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

test("canvas changes since an agent's last message come with its next, its own left out", () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		one.newStage("Plan");
		const canvas = one.stageName()!;
		assert.deepEqual(one.canvasNotes(), [], "the first message has nothing to compare with");

		app.pens.edit(canvas, [{ op: "insert", node: { id: "n1", type: "note", content: "Ship on Friday", x: 0, y: 0 } }]);
		const told = one.canvasNotes();
		assert.match(told[0]!, /^\[Since your last message, on "Plan" \(/);
		assert.deepEqual(told.slice(1, -1), [' you added the note "Ship on Friday" (n1)']);
		assert.deepEqual(one.canvasNotes(), [], "and told once");

		penWriter.run(one.id, () => app.pens.edit(canvas, [{ op: "update", id: "n1", set: { content: "Ship on Monday" } }]));
		assert.deepEqual(one.canvasNotes(), [], "its own edit is not news to it");

		penWriter.run(two.id, () => app.pens.edit(canvas, [{ op: "insert", node: { id: "n2", type: "note", content: "Why?", x: 0, y: 200 } }]));
		assert.deepEqual(one.canvasNotes().slice(1, -1), [' Two added the note "Why?" (n2)'], "another agent's edit is named");
	} finally {
		cleanup();
	}
});
