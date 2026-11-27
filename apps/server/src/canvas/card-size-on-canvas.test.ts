import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { runVerb } from "../calls/run.ts";

/** One of the person's calls, as a page makes it for the canvas on its screen. */
const person = (app: App, canvas: string, verb: string, args: unknown[]) => runVerb(app, { kind: "person" }, { "x-decks-stage": canvas }, verb, [...args, { canvas }]);

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


/*
 * How big a card is drawn is its canvas's: the size of its item in the canvas file. Only an agent's
 * `decks.canvas.fit` or `decks.canvas.update` with a size, and a person's drag, set it; a browser's reading never does, since two browsers
 * read a card a pixel or two apart and, when both readings sized it, answered each other for ever.
 * A card joining a canvas comes at the size its own file states.
 */
function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-board-size-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	put(join(deck, "canvases", "t", "cards", "plan", "index.html"), `<!doctype html><html><head><title>Plan</title><meta name="board" content='{"w":900,"h":400}' /></head><body class="board"></body></html>`);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	return { app, cleanup: () => (app.dispose(), rmSync(dataDir, { recursive: true, force: true })) };
}

/** A library card; each canvas it is put on places its own copy, as a card (`canvas/copy-in.ts`). */
const PATH = "canvases/t/cards/plan/index.html";
const settle = () => new Promise((done) => setTimeout(done, 250));

test("a board is drawn at its stage's size, which a browser's reading does not move and a drag does", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.seat.setInPlay([PATH], { place: true });
		const mine = app.pens.cards.copyOf(one.seat.stageName()!, PATH);
		assert.equal(mine, `canvases/${one.seat.stageName()}/cards/plan/index.html`, "the canvas places its own copy, as a card");
		const shown = () => app.canvas.cards(one.id).find((card) => card.path === mine)!;
		assert.deepEqual([shown().w, shown().h], [900, 400], "it joins at its file's size");

		app.cards.noteExtent(mine, { rev: shown().rev, w: 900, h: 690 });
		assert.equal(shown().h, 400, "a reading sizes nothing");

		one.seat.setSize(PATH, { h: 520 });
		assert.equal(shown().h, 520);
		await settle();
		const item = app.pens.cards.cards(one.seat.stageName()!).find((card) => card.path === mine);
		assert.deepEqual([item?.w, item?.h], [900, 520], "and the stage file holds it");
		assert.equal(app.deck.card(mine)?.h, 400, "while the board's own file is as its agent wrote it");

		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.seat.newStage("Another canvas");
		assert.notEqual(two.seat.stageName(), one.seat.stageName());
		two.seat.setInPlay([PATH], { place: true });
		const theirs = app.pens.cards.copyOf(two.seat.stageName()!, PATH);
		assert.notEqual(theirs, mine, "another canvas places a copy of its own");
		assert.equal(app.canvas.cards(two.id).find((card) => card.path === theirs)?.h, 400, "another stage takes it at its file's size");
		assert.equal(app.canvas.cards(one.id).find((card) => card.path === mine)?.h, 520, "and the first keeps its own");
		one.seat.setInPlay([PATH], { place: true });
		assert.deepEqual(app.pens.cards.cards(one.seat.stageName()!).map((card) => card.path), [mine], "asked for again, the canvas keeps the copy it has");
	} finally {
		cleanup();
	}
});

test("two agents on one stage: a save by one does not put back a size or a place the other set", async () => {
	const { app, cleanup } = open();
	try {
		put(join(app.deck.path, "canvases", "t", "cards", "notes", "index.html"), `<!doctype html><html><head><title>Notes</title><meta name="board" content='{"w":600,"h":300}' /></head><body class="board"></body></html>`);
		app.deck.refresh("canvases/t/cards/notes/index.html");
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.seat.setInPlay([PATH, "canvases/t/cards/notes/index.html"], { place: true });
		await settle();
		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.seat.openStage(one.seat.stageName()!);
		await settle();
		// One sizes and moves the plan, and Two moves the notes a moment later: Two's write is already
		// waiting when One's lands, so Two never reads One's change before it writes its own copy.
		const plan = app.pens.cards.copyOf(one.seat.stageName()!, PATH);
		const notesOwn = app.pens.cards.copyOf(one.seat.stageName()!, "canvases/t/cards/notes/index.html");
		const before = app.canvas.cards(one.id).find((card) => card.path === plan)!;
		const notes = app.canvas.cards(two.id).find((card) => card.path === notesOwn)!;
		one.seat.setSize(PATH, { h: 640 });
		one.seat.setPosition(PATH, before.x + 500, before.y);
		two.seat.setPosition("canvases/t/cards/notes/index.html", notes.x, notes.y + 900);
		await settle();
		await settle();
		const item = app.pens.cards.cards(one.seat.stageName()!).find((card) => card.path === plan);
		assert.equal(item?.h, 640, "the plan keeps the height One gave it");
		assert.equal(item?.x, before.x + 500, "and the place");
		const moved = app.pens.cards.cards(one.seat.stageName()!).find((card) => card.path === notesOwn);
		assert.equal(moved?.y, notes.y + 900, "while Two's own move is written");
	} finally {
		cleanup();
	}
});

test("a person's change goes to the canvas it names, not to the agent last focused", async () => {
	const { app, cleanup } = open();
	try {
		const one = app.agents.create({ name: "One", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		one.seat.setInPlay([PATH], { place: true });
		const first = one.seat.stageName()!;
		const two = app.agents.create({ name: "Two", restored: { id: "two", context: [], inPlay: [], createdAt: 1 } });
		two.seat.newStage("Another canvas");
		two.seat.setInPlay([PATH], { place: true });
		const second = two.seat.stageName()!;
		app.agents.focus(two.id);
		const on = (name: string) => app.pens.cards.cards(name).find((card) => card.path === app.pens.cards.copyOf(name, PATH));
		const before = on(second)!;
		// The person drags the copy that is on the canvas they are looking at.
		const shown = app.pens.cards.copyOf(first, PATH);

		await person(app, first, "card.move", [shown, { x: 4000, y: 3000 }]);
		await person(app, first, "card.resize", [shown, { h: 777 }]);
		await settle();
		assert.deepEqual([on(first)?.x, on(first)?.y, on(first)?.h], [4000, 3000, 777], "the named canvas takes the move and the size");
		assert.deepEqual([on(second)?.x, on(second)?.y, on(second)?.h], [before.x, before.y, before.h], "the focused agent's canvas is untouched");
		assert.equal(app.deck.card(shown)?.h, 777, "the drag writes the board's own file, as a fit does");

		await person(app, first, "card.hide", [shown]);
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
		one.seat.setInPlay([PATH], { place: true });
		app.agents.focus(one.id);
		one.seat.setSize(PATH, { h: 600 });
		await settle();
		const heights: number[] = [];
		const send = app.send.bind(app);
		const shown = app.pens.cards.copyOf(one.seat.stageName()!, PATH);
		app.send = (message) => {
			if (message.type === "card.changed" && message.path === shown && message.card) heights.push(message.card.h);
			send(message);
		};
		await person(app, one.seat.stageName()!, "card.resize", [shown, { h: 450 }]);
		await settle();
		assert.ok(heights.length > 0, "the change is sent");
		assert.deepEqual([...new Set(heights)], [450], "every card.changed carries the new height, none the old 600");
	} finally {
		cleanup();
	}
});
