import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "./app.ts";
import { realPathOf } from "./deck/roots.ts";

/*
 * The measuring loop, end to end through the App rather than through a stub.
 *
 * A board's size is the one number nothing could check: the browser is the only place a
 * board is laid out, so the reading has to travel from a frame to the server and back out
 * as a write to the file. Each half is easy to get right on its own and the join is where
 * it would quietly stop working — a reading kept under the wrong revision, a `fit` that
 * writes a number nobody measured.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-app-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(
		join(deck, "boards", "tall.html"),
		`<!doctype html><html><head><title>Tall</title><meta name="board" content='{"w":900,"h":400,"bg":"grid"}' /></head><body class="board"></body></html>`,
	);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, deck, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

const boardOf = (app: App) => app.stage.boards().find((one) => one.path === "boards/tall.html")!;

test("a frame's measurement reaches the deck, and fit writes it back", async () => {
	const { app, deck, cleanup } = open();
	try {
		const before = boardOf(app);
		assert.equal(before.content, undefined, "nothing has looked at it yet");
		assert.equal(before.clipped, undefined);

		app.handle({ type: "board.extent", path: "boards/tall.html", rev: before.rev, w: 648, h: 690 }, () => {});
		const measured = boardOf(app);
		assert.deepEqual(measured.content, { w: 648, h: 690 });
		assert.equal(measured.clipped, true, "690 of content in 400 of board");

		const { board: fitted } = await app.stage.fit("boards/tall.html");
		assert.equal(fitted.h, 738, "the content plus the margin components start at");
		/*
		 * And the width comes down with it: 648 of content in 900 of board left a column of
		 * empty grid nobody could tell from a deliberate one. The second reading never
		 * arrives here — no browser is looking — so the height falls back to the first,
		 * which is the right answer whenever the content did not reflow.
		 */
		assert.equal(fitted.w, 696, "the content, plus the same margin");

		// The file is the only place a size lives, so that is where to check.
		const html = readFileSync(join(deck, "boards", "tall.html"), "utf8");
		assert.ok(html.includes('"w":696,"h":738'));
		assert.ok(html.includes('"bg":"grid"'), "and the rest of the tag survived");
		assert.equal(boardOf(app).h, 738);
	} finally {
		cleanup();
	}
});

test("a measurement of a version that has been rewritten is not reported", async () => {
	const { app, cleanup } = open();
	try {
		const board = boardOf(app);
		app.handle({ type: "board.extent", path: "boards/tall.html", rev: board.rev + 1, w: 648, h: 690 }, () => {});
		assert.equal(boardOf(app).content, undefined, "a reading of a document we no longer hold says nothing");

		await assert.rejects(app.stage.fit("boards/tall.html"), /put it on the canvas/);
	} finally {
		cleanup();
	}
});
