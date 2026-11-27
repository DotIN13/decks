import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


/*
 * Whose arrangement `decks.canvas.read()` answers with.
 *
 * A move is written on the canvas of the agent that made it (`decks.canvas.move` → `host.place`), and
 * the read used to be served from **whichever conversation the browser was last looking at**
 * (`canvasState()` with no argument → `agents.looking()`). An agent working while the person is
 * reading another chat therefore moved a card and then read back the other canvas's number for
 * it — which, for a card neither had moved before, is the place they were both seeded with: the
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
		put(join(deck, "canvases", "t", "cards", name.replace(/\.html$/, ""), "index.html"), `<!doctype html><html><head><title>${name}</title></head><body class="board"></body></html>`);
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
		// Both have the card up, so both have a place for it — as two agents on one project do.
		for (const agent of [mover, elsewhere]) agent.seat.setInPlay(["canvases/t/cards/plan/index.html"], { place: true });
		// Each canvas places its own copy of a library card (`deck/layout.ts`).
		const plan = app.pens.cards.copyOf(mover.seat.stageName()!, "canvases/t/cards/plan/index.html");
		const before = app.canvas.cards(mover.id).find((card) => card.path === plan)!;

		// The person is reading the other conversation while this one works.
		app.agents.look(elsewhere.id);
		const moved = app.canvas.move(mover.id, "canvases/t/cards/plan/index.html", { x: before.x - 1140, y: before.y + 60 });
		assert.equal(moved?.x, before.x - 1140, "the move answers with what was asked for");

		const read = app.canvas.cards(mover.id).find((card) => card.path === plan)!;
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
		for (const agent of [mover, elsewhere]) agent.seat.setInPlay(["canvases/t/cards/risks/index.html"], { place: true });
		const own = (agent: typeof mover) => app.pens.cards.copyOf(agent.seat.stageName()!, "canvases/t/cards/risks/index.html");
		const before = app.canvas.cards(mover.id).find((card) => card.path === own(mover))!;

		app.agents.look(elsewhere.id);
		app.canvas.move(mover.id, "canvases/t/cards/risks/index.html", { x: before.x - 2000, y: before.y });

		const theirs = app.canvas.cards(elsewhere.id).find((card) => card.path === own(elsewhere))!;
		assert.equal(theirs.x, before.x, "a move on one canvas is not a move on another");
		const ours = app.canvas.cards(mover.id).find((card) => card.path === own(mover))!;
		assert.equal(ours.x, before.x - 2000);
		cleanup();
	} catch (error) {
		cleanup();
		throw error;
	}
});
