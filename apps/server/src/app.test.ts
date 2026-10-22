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
 * it would quietly stop working — a reading kept under the wrong revision, a `decks.canvas.fit` that
 * writes a number nobody measured.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-app-")));
	const deck = join(dataDir, "decks");
	// A canvas's own board: the library (`boards/`) is read only (`deck/layout.ts`).
	mkdirSync(join(deck, "canvases", "work", "boards"), { recursive: true });
	writeFileSync(
		join(deck, "canvases", "work", "boards", "tall.html"),
		`<!doctype html><html><head><title>Tall</title><meta name="board" content='{"w":900,"h":400,"bg":"grid"}' /></head><body class="board"></body></html>`,
	);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, deck, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

const TALL = "canvases/work/boards/tall.html";
const boardOf = (app: App) => app.stage.boards().find((one) => one.path === TALL)!;

test("a frame's measurement is reported but sizes nothing, and fit writes it back", async () => {
	const { app, deck, cleanup } = open();
	try {
		const before = boardOf(app);
		assert.equal(before.content, undefined, "nothing has looked at it yet");
		assert.equal(before.clipped, undefined);

		// Laid out at the board's own 900: `decks.canvas.fit` takes a height only from a layout at the width it fits at.
		app.handle({ type: "board.extent", path: TALL, rev: before.rev, w: 648, h: 690, at: 900 }, () => {});
		const measured = boardOf(app);
		assert.deepEqual(measured.content, { w: 648, h: 690 });
		/*
		 * A browser's reading never sizes a board: two browsers read a board a pixel or two apart, and
		 * when both sized it they answered each other for ever. The board stays at its file's 400 and
		 * says that its content is cut off, which is what the agent's fit is for.
		 */
		assert.equal(measured.h, 400, "the reading left the board at the number in its file");
		assert.equal(measured.clipped, true, "and says its content runs past it");

		const { board: fitted } = await app.stage.fit(TALL);
		assert.equal(fitted.h, 738, "the content plus a margin: this reading carries no page height (an older frame)");
		// And the width is the file's, untouched: a fit is a height, not a resize.
		assert.equal(fitted.w, 900, "the width the board declares");

		// The file is the only place a size lives, so that is where to check.
		const html = readFileSync(join(deck, TALL), "utf8");
		assert.ok(html.includes('"w":900,"h":738'));
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
		app.handle({ type: "board.extent", path: TALL, rev: board.rev + 1, w: 648, h: 690 }, () => {});
		assert.equal(boardOf(app).content, undefined, "a reading of a document we no longer hold says nothing");

		await assert.rejects(app.stage.fit(TALL), /put it on the canvas/);
	} finally {
		cleanup();
	}
});
