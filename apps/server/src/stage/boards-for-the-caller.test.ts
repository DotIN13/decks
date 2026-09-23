import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/*
 * Whose arrangement `stage.boards()` answers with.
 *
 * A move is written on the canvas of the agent that made it (`stage.move` → `host.place`), and
 * the read used to be served from **whichever conversation the browser was last looking at**
 * (`stageState()` with no argument → `agents.looking()`). An agent working while the person is
 * reading another chat therefore moved a board and then read back the other stage's number for
 * it — which, for a board neither had moved before, is the place they were both seeded with: the
 * value before the move, exactly, with the move itself on disk and correct.
 *
 * That is the bug reported on 21 September 2026 as "stage.boards() returned pre-move positions
 * twice, and now will not reproduce". It reproduces whenever the caller is not the conversation
 * on screen, which is why it came and went.
 */

function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-boards-caller-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	for (const name of ["plan.html", "risks.html"]) {
		writeFileSync(join(deck, "boards", name), `<!doctype html><html><head><title>${name}</title></head><body class="board"></body></html>`);
	}
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

test("a board an agent moved reads back moved, whoever the browser is looking at", () => {
	const { app, cleanup } = open();
	try {
		// Restored rows: a chat that exists and starts no runtime, which is all this needs.
		const mover = app.agents.create({ name: "Mover", restored: { id: "mover", context: [], inPlay: [], createdAt: 1 } });
		const elsewhere = app.agents.create({ name: "Elsewhere", restored: { id: "elsewhere", context: [], inPlay: [], createdAt: 1 } });
		// Both have the board up, so both have a place for it — as two agents on one project do.
		for (const agent of [mover, elsewhere]) agent.setInPlay(["boards/plan.html"], { place: true });
		const before = app.stage.boards(mover.id).find((board) => board.path === "boards/plan.html")!;

		// The person is reading the other conversation while this one works.
		app.agents.look(elsewhere.id);
		const moved = app.stage.move(mover.id, "boards/plan.html", { x: before.x - 1140, y: before.y + 60 });
		assert.equal(moved?.x, before.x - 1140, "the move answers with what was asked for");

		const read = app.stage.boards(mover.id).find((board) => board.path === "boards/plan.html")!;
		assert.equal(read.x, before.x - 1140, "and the read agrees: this is the caller's canvas");
		assert.equal(read.y, before.y + 60);
		cleanup();
	} catch (error) {
		cleanup();
		throw error;
	}
});

test("the other conversation's canvas is untouched, which is what made the stale read look like a no-op", () => {
	const { app, cleanup } = open();
	try {
		// Restored rows: a chat that exists and starts no runtime, which is all this needs.
		const mover = app.agents.create({ name: "Mover", restored: { id: "mover", context: [], inPlay: [], createdAt: 1 } });
		const elsewhere = app.agents.create({ name: "Elsewhere", restored: { id: "elsewhere", context: [], inPlay: [], createdAt: 1 } });
		for (const agent of [mover, elsewhere]) agent.setInPlay(["boards/risks.html"], { place: true });
		const before = app.stage.boards(mover.id).find((board) => board.path === "boards/risks.html")!;

		app.agents.look(elsewhere.id);
		app.stage.move(mover.id, "boards/risks.html", { x: before.x - 2000, y: before.y });

		const theirs = app.stage.boards(elsewhere.id).find((board) => board.path === "boards/risks.html")!;
		assert.equal(theirs.x, before.x, "a move on one canvas is not a move on another");
		const ours = app.stage.boards(mover.id).find((board) => board.path === "boards/risks.html")!;
		assert.equal(ours.x, before.x - 2000);
		cleanup();
	} catch (error) {
		cleanup();
		throw error;
	}
});
