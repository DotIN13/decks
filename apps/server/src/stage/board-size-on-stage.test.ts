import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/*
 * How big a board is drawn is its stage's: the size of its item in the stage file. Only an agent's
 * `fit` or `resize` and a person's drag set it; a browser's reading never does, since two browsers
 * read a board a pixel or two apart and, when both readings sized it, answered each other for ever.
 * A board joining a stage comes at the size its own file states.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-board-size-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "plan.html"), `<!doctype html><html><head><title>Plan</title><meta name="board" content='{"w":900,"h":400}' /></head><body class="board"></body></html>`);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

const PATH = "boards/plan.html";
const settle = () => new Promise((done) => setTimeout(done, 250));

test("a board is drawn at its stage's size, which a browser's reading does not move and a drag does", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.setInPlay([PATH], { place: true });
		const shown = () => app.stage.boards(one.id).find((board) => board.path === PATH)!;
		assert.deepEqual([shown().w, shown().h], [900, 400], "it joins at its file's size");

		app.handle({ type: "board.extent", path: PATH, rev: shown().rev, w: 900, h: 690 }, () => {});
		assert.equal(shown().h, 400, "a reading sizes nothing");

		one.setSize(PATH, { h: 520 });
		assert.equal(shown().h, 520);
		await settle();
		const item = app.pens.boards(one.stageName()!).find((board) => board.path === PATH);
		assert.deepEqual([item?.w, item?.h], [900, 520], "and the stage file holds it");
		assert.equal(app.deck.board(PATH)?.h, 400, "while the board's own file is as its agent wrote it");

		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.newStage("Another canvas");
		assert.notEqual(two.stageName(), one.stageName());
		two.setInPlay([PATH], { place: true });
		assert.equal(app.stage.boards(two.id).find((board) => board.path === PATH)?.h, 400, "another stage takes it at its file's size");
		assert.equal(app.stage.boards(one.id).find((board) => board.path === PATH)?.h, 520, "and the first keeps its own");
	} finally {
		cleanup();
	}
});
