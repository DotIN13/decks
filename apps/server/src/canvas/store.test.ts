import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CanvasStore } from "./store.ts";

/*
 * The record that holds the boards.
 *
 * What is worth asserting here is what the file *is*, because it is the thing a person can
 * open and edit: one file per canvas, named after the canvas, readable when it is half wrong.
 */

const deck = () => mkdtempSync(join(tmpdir(), "decks-canvas-"));
const files = (path: string) => (existsSync(join(path, ".decks", "canvases")) ? readdirSync(join(path, ".decks", "canvases")).sort() : []);

test("a canvas is one file, named after the canvas", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Political LLM" });
	assert.deepEqual(files(path), ["political-llm.json"]);
	const written = JSON.parse(readFileSync(join(path, ".decks", "canvases", "political-llm.json"), "utf8")) as Record<string, unknown>;
	assert.equal(written.id, canvas.id);
	assert.equal(written.name, "Political LLM");
});

test("renaming moves the file and keeps the id, which is what agents store", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Political LLM" });
	store.rename(canvas.id, "Linear political");
	assert.deepEqual(files(path), ["linear-political.json"]);
	assert.equal(store.get(canvas.id)?.name, "Linear political");
});

test("boards and places are separate, so taking a board off keeps its spot", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Work" });
	store.setBoards(canvas.id, ["boards/a.html", "boards/b.html"]);
	store.place(canvas.id, "boards/a.html", 40, 80);
	store.setBoards(canvas.id, ["boards/b.html"]);
	assert.deepEqual(store.boards(canvas.id), ["boards/b.html"]);
	assert.deepEqual(store.places(canvas.id)["boards/a.html"], { x: 40, y: 80 }, "shown again, it goes back where it was");
});

test("an arrow is one per pair and direction, and a group needs two boards", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Work" });
	store.link(canvas.id, "boards/a.html", "boards/b.html", "ran");
	store.link(canvas.id, "boards/a.html", "boards/b.html", "ran");
	assert.equal(store.get(canvas.id)?.links.length, 1);
	store.link(canvas.id, "boards/b.html", "boards/a.html");
	assert.equal(store.get(canvas.id)?.links.length, 2, "the other direction is a second arrow");
	assert.equal(store.link(canvas.id, "boards/a.html", "boards/a.html"), undefined, "a board does not point at itself");
	assert.equal(store.group(canvas.id, "the pilot", ["boards/a.html"]), undefined);
	store.group(canvas.id, "the pilot", ["boards/a.html", "boards/b.html"]);
	assert.equal(store.get(canvas.id)?.groups.length, 1);
});

test("a board that leaves the deck leaves every canvas, with its arrows", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const one = store.create({ name: "One" });
	const two = store.create({ name: "Two" });
	for (const id of [one.id, two.id]) {
		store.setBoards(id, ["boards/a.html", "boards/b.html", "boards/c.html"]);
		store.link(id, "boards/a.html", "boards/b.html");
		store.group(id, "pair", ["boards/a.html", "boards/b.html"]);
	}
	store.boardRemoved("boards/a.html");
	for (const id of [one.id, two.id]) {
		assert.deepEqual(store.boards(id), ["boards/b.html", "boards/c.html"]);
		assert.equal(store.get(id)?.links.length, 0);
		assert.equal(store.get(id)?.groups.length, 0, "a group of one is not a group");
	}
});

test("the changed mark is two times, and opening it clears it", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Work" });
	store.changed(canvas.id, 2000);
	store.opened(canvas.id, 1000);
	assert.equal((store.get(canvas.id)?.changedAt ?? 0) > (store.get(canvas.id)?.openedAt ?? 0), true, "news");
	store.opened(canvas.id, 3000);
	assert.equal((store.get(canvas.id)?.changedAt ?? 0) > (store.get(canvas.id)?.openedAt ?? 0), false, "read");
});

test("a half-wrong file opens: one bad place costs that board, not the canvas", () => {
	const path = deck();
	mkdirSync(join(path, ".decks", "canvases"), { recursive: true });
	writeFileSync(
		join(path, ".decks", "canvases", "hand-written.json"),
		JSON.stringify({
			id: "cv_1",
			name: "Hand written",
			boards: ["boards/a.html", 7, "boards/b.html"],
			places: { "boards/a.html": { x: 10, y: 20 }, "boards/b.html": { x: "nope", y: 0 } },
			links: [{ from: "boards/a.html" }, { from: "boards/a.html", to: "boards/b.html" }],
			groups: [{ name: "lonely", boards: ["boards/a.html"] }],
		}),
	);
	const store = new CanvasStore(path);
	const canvas = store.get("cv_1");
	assert.deepEqual(canvas?.boards, ["boards/a.html", "boards/b.html"]);
	assert.deepEqual(canvas?.places, { "boards/a.html": { x: 10, y: 20 } });
	assert.equal(canvas?.links.length, 1, "a link with no target is not a link");
	assert.equal(canvas?.groups.length, 0);
});

test("a canvas is found by name however the name is spelled", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const made = store.create({ name: "Political LLM" });
	assert.equal(store.byName("political llm")?.id, made.id);
	assert.equal(store.ensure("Political LLM").id, made.id, "ensure does not make a second one");
	assert.notEqual(store.ensure("Cross-interviewer").id, made.id);
});

test("canvases survive being read back", () => {
	const path = deck();
	const store = new CanvasStore(path);
	const canvas = store.create({ name: "Work" });
	store.setBoards(canvas.id, ["boards/a.html"]);
	store.place(canvas.id, "boards/a.html", 12, 34);
	store.link(canvas.id, "boards/a.html", "boards/b.html", "ran");
	const again = new CanvasStore(path);
	assert.deepEqual(again.boards(canvas.id), ["boards/a.html"]);
	assert.deepEqual(again.places(canvas.id), { "boards/a.html": { x: 12, y: 34 } });
	assert.deepEqual(again.get(canvas.id)?.links, [{ from: "boards/a.html", to: "boards/b.html", label: "ran" }]);
});
