import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/*
 * How big a board is drawn is its stage's: the size of its item in the stage file. Only an agent's
 * `decks.canvas.fit` or `decks.canvas.update` with a size, and a person's drag, set it; a browser's reading never does, since two browsers
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

/** A library board; each canvas it is put on places its own copy (`deck/layout.ts`). */
const PATH = "boards/plan.html";
const settle = () => new Promise((done) => setTimeout(done, 250));

test("a board is drawn at its stage's size, which a browser's reading does not move and a drag does", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.setInPlay([PATH], { place: true });
		const mine = app.pens.copyOf(one.stageName()!, PATH);
		assert.equal(mine, `canvases/${one.stageName()}/boards/plan.html`, "the canvas places its own copy");
		const shown = () => app.stage.boards(one.id).find((board) => board.path === mine)!;
		assert.deepEqual([shown().w, shown().h], [900, 400], "it joins at its file's size");

		app.handle({ type: "board.extent", path: mine, rev: shown().rev, w: 900, h: 690 }, () => {});
		assert.equal(shown().h, 400, "a reading sizes nothing");

		one.setSize(PATH, { h: 520 });
		assert.equal(shown().h, 520);
		await settle();
		const item = app.pens.boards(one.stageName()!).find((board) => board.path === mine);
		assert.deepEqual([item?.w, item?.h], [900, 520], "and the stage file holds it");
		assert.equal(app.deck.board(mine)?.h, 400, "while the board's own file is as its agent wrote it");

		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.newStage("Another canvas");
		assert.notEqual(two.stageName(), one.stageName());
		two.setInPlay([PATH], { place: true });
		const theirs = app.pens.copyOf(two.stageName()!, PATH);
		assert.notEqual(theirs, mine, "another canvas places a copy of its own");
		assert.equal(app.stage.boards(two.id).find((board) => board.path === theirs)?.h, 400, "another stage takes it at its file's size");
		assert.equal(app.stage.boards(one.id).find((board) => board.path === mine)?.h, 520, "and the first keeps its own");
		one.setInPlay([PATH], { place: true });
		assert.deepEqual(app.pens.boards(one.stageName()!).map((board) => board.path), [mine], "asked for again, the canvas keeps the copy it has");
	} finally {
		cleanup();
	}
});

test("two agents on one stage: a save by one does not put back a size or a place the other set", async () => {
	const { app, cleanup } = open();
	try {
		writeFileSync(join(app.deck.path, "boards", "notes.html"), `<!doctype html><html><head><title>Notes</title><meta name="board" content='{"w":600,"h":300}' /></head><body class="board"></body></html>`);
		app.deck.refresh("boards/notes.html");
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.setInPlay([PATH, "boards/notes.html"], { place: true });
		await settle();
		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.openStage(one.stageName()!);
		await settle();
		// One sizes and moves the plan, and Two moves the notes a moment later: Two's write is already
		// waiting when One's lands, so Two never reads One's change before it writes its own copy.
		const plan = app.pens.copyOf(one.stageName()!, PATH);
		const notesOwn = app.pens.copyOf(one.stageName()!, "boards/notes.html");
		const before = app.stage.boards(one.id).find((board) => board.path === plan)!;
		const notes = app.stage.boards(two.id).find((board) => board.path === notesOwn)!;
		one.setSize(PATH, { h: 640 });
		one.setPosition(PATH, before.x + 500, before.y);
		two.setPosition("boards/notes.html", notes.x, notes.y + 900);
		await settle();
		await settle();
		const item = app.pens.boards(one.stageName()!).find((board) => board.path === plan);
		assert.equal(item?.h, 640, "the plan keeps the height One gave it");
		assert.equal(item?.x, before.x + 500, "and the place");
		const moved = app.pens.boards(one.stageName()!).find((board) => board.path === notesOwn);
		assert.equal(moved?.y, notes.y + 900, "while Two's own move is written");
	} finally {
		cleanup();
	}
});

test("a person's change goes to the canvas it names, not to the agent last focused", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.setInPlay([PATH], { place: true });
		const first = one.stageName()!;
		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.newStage("Another canvas");
		two.setInPlay([PATH], { place: true });
		const second = two.stageName()!;
		app.agents.focus(two.id);
		const on = (name: string) => app.pens.boards(name).find((board) => board.path === app.pens.copyOf(name, PATH));
		const before = on(second)!;
		// The person drags the copy that is on the canvas they are looking at.
		const shown = app.pens.copyOf(first, PATH);

		app.handle({ type: "board.move", path: shown, x: 4000, y: 3000, stage: first }, () => {});
		app.handle({ type: "board.resize", path: shown, h: 777, stage: first }, () => {});
		await settle();
		assert.deepEqual([on(first)?.x, on(first)?.y, on(first)?.h], [4000, 3000, 777], "the named canvas takes the move and the size");
		assert.deepEqual([on(second)?.x, on(second)?.y, on(second)?.h], [before.x, before.y, before.h], "the focused agent's canvas is untouched");
		assert.equal(app.deck.board(shown)?.h, 777, "the drag writes the board's own file, as a fit does");

		app.handle({ type: "board.hide", path: shown, stage: first }, () => {});
		await settle();
		assert.equal(on(first), undefined, "a hide takes it off the named canvas");
		assert.ok(on(second), "and leaves it on the other");
	} finally {
		cleanup();
	}
});

test("a person's drag to a shorter board sends only the new height, so the canvas never draws it at the old one", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.setInPlay([PATH], { place: true });
		app.agents.focus(one.id);
		one.setSize(PATH, { h: 600 });
		await settle();
		const heights: number[] = [];
		const send = app.send.bind(app);
		const shown = app.pens.copyOf(one.stageName()!, PATH);
		app.send = (message) => {
			if (message.type === "board.changed" && message.path === shown && message.board) heights.push(message.board.h);
			send(message);
		};
		app.handle({ type: "board.resize", path: shown, h: 450, stage: one.stageName()! }, () => {});
		await settle();
		assert.ok(heights.length > 0, "the change is sent");
		assert.deepEqual([...new Set(heights)], [450], "every board.changed carries the new height, none the old 600");
	} finally {
		cleanup();
	}
});
