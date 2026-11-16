import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { appTool, canvasShowsApp, canvasShowsDocument, conversationForApp } from "./app-caller.ts";

/**
 * An app as a caller. Two decisions are worth a test each, and both are about not inheriting something:
 *
 * - it acts for the conversation on a canvas that shows it, so what it changes lands on the canvas
 *   the person is looking at rather than on whichever chat was touched last;
 * - its identity is the app's own, so `decks.agent.update({ name })` from an app cannot rename a colleague.
 */

function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-app-caller-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "apps", "polls"), { recursive: true });
	writeFileSync(join(deck, "apps", "polls", "index.html"), "<h1>Polls</h1>");
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	// Restored rows: chats that exist and start no runtime, which is all this needs.
	const front = app.agents.create({ name: "Front", restored: { id: "front", context: [], inPlay: [], createdAt: 2 } });
	const shows = app.agents.create({ name: "Shows", restored: { id: "shows", context: [], inPlay: [], createdAt: 1 } });
	const pens = app.stage.pens!;
	front.seat.newStage("Front");
	shows.seat.newStage("Shows");
	pens.edit(shows.seat.stageName()!, [
		{ op: "insert", node: { type: "browser", id: "polls", name: "Polls", width: 600, height: 400, metadata: { type: "decks.app", name: "polls" } }, box: { x1: 0, y1: 0 } },
		{ op: "insert", node: { type: "browser", id: "notes", name: "notes.md", width: 600, height: 400, metadata: { type: "decks.document", path: "docs/notes.md" } }, box: { x1: 800, y1: 0 } },
	]);
	return { app, front, shows, pens, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

test("a canvas shows an app or a document by an item of it on its drawing", () => {
	const { front, shows, pens, cleanup } = open();
	try {
		assert.equal(canvasShowsApp(pens, shows.seat.stageName(), "polls"), true);
		assert.equal(canvasShowsApp(pens, front.seat.stageName(), "polls"), false);
		assert.equal(canvasShowsApp(pens, shows.seat.stageName(), "other"), false);
		assert.equal(canvasShowsApp(pens, undefined, "polls"), false);
		assert.equal(canvasShowsDocument(pens, shows.seat.stageName(), "docs/notes.md"), true);
		assert.equal(canvasShowsDocument(pens, shows.seat.stageName(), "docs/other.md"), false);
	} finally {
		cleanup();
	}
});

test("an app acts for the conversation on a canvas showing it, whichever chat is on screen, and its calls are that canvas's", async () => {
	const { app, front, shows, cleanup } = open();
	try {
		app.agents.focus(front.id);
		assert.equal(conversationForApp(app, "polls").id, "shows", "not the chat on screen, which does not show the app");
		assert.equal(conversationForApp(app, "nowhere").id, app.agents.focused().id, "an app on no canvas falls back to the focused chat");
		const { tool, conversation } = appTool(app, "polls");
		assert.equal(conversation.id, "shows");
		const here = await tool.call("here", [], {});
		assert.equal(here.ok, true, here.error);
		assert.equal((here.value as { name: string }).name, shows.seat.stageName());
		const note = await tool.call("canvas.insert", [{ type: "note", id: "from-app", content: "hello" }], {});
		assert.equal(note.ok, true, note.error);
		assert.ok(app.stage.pens!.get(shows.seat.stageName()!).doc.children.some((one) => one.id === "from-app"), "the note is on the canvas showing the app");
		assert.ok(!app.stage.pens!.get(front.seat.stageName()!).doc.children.some((one) => one.id === "from-app"));
	} finally {
		cleanup();
	}
});

test("an app's identity is its own: renaming itself touches nobody, and it has no row to tag", async () => {
	const { app, shows, cleanup } = open();
	try {
		const { tool } = appTool(app, "polls");
		const me = await tool.call("agent.me", [], {});
		assert.equal((me.value as { name: string; id?: string }).name, "app polls");
		assert.equal((me.value as { id?: string }).id, undefined, "an app is no agent, and says no agent's id");
		const renamed = await tool.call("agent.update", [{ name: "Poll runner", tags: ["counting"], workspace: "votes" }], {});
		assert.equal(renamed.ok, true, renamed.error);
		assert.equal(((await tool.call("agent.me", [], {})).value as { name: string }).name, "Poll runner", "the label it goes by for this caller");
		assert.equal(shows.chat().name, "Shows", "the conversation it acts for keeps its name");
		assert.deepEqual(app.agents.summaries().find((one) => one.id === "shows")?.tags, [], "and has no tags");
		// What an app's own code may not do, each said in a sentence.
		assert.match((await tool.call("ports", [{ open: 3000 }], {})).error ?? "", /An app's own code cannot open or close ports/);
		assert.match((await tool.call("view.goto", [shows.seat.stageName()], {})).error ?? "", /agent/i);
	} finally {
		cleanup();
	}
});
