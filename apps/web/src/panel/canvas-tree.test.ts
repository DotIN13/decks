import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, StageRow } from "@decks/protocol";
import { canvasTree, folderOf } from "./canvas-tree.ts";

const stage = (name: string, title: string, changedAt = 0): StageRow => ({ name, title, boards: 0, rev: 0, words: "", agents: [], changedAt });
const board = (path: string, title: string): Board => ({ path, title }) as Board;

test("canvases are one flat list: the one you are on first, then the latest changed", () => {
	const { canvases, library } = canvasTree({
		stages: [stage("a", "Alpha", 1), stage("b", "Beta", 3), stage("c", "Gamma", 2)],
		boards: [board("canvases/a/boards/one.html", "One"), board("canvases/c/boards/two.html", "Two"), board("boards/old.html", "Old")],
		here: "a",
		query: "",
	});
	assert.deepEqual(canvases.map((c) => c.stage.title), ["Alpha", "Beta", "Gamma"]);
	assert.equal(canvases[0]!.here, true);
	assert.deepEqual(canvases[0]!.boards.map((b) => b.title), ["One"]);
	assert.deepEqual(library.map((b) => b.title), ["Old"]);
});

test("a query keeps a canvas for a matching board, with only that board", () => {
	const { canvases } = canvasTree({
		stages: [stage("a", "Alpha"), stage("b", "Beta")],
		boards: [board("canvases/a/boards/one.html", "Sidebar plan"), board("canvases/a/boards/two.html", "Other"), board("canvases/b/boards/x.html", "X")],
		query: "sidebar",
	});
	assert.equal(canvases.length, 1);
	assert.equal(canvases[0]!.hit, false);
	assert.deepEqual(canvases[0]!.boards.map((b) => b.title), ["Sidebar plan"]);
});

test("a friend's canvas lives in shared/canvases", () => {
	assert.equal(folderOf({ name: "shared/ann/plan" }), "shared/canvases/ann/plan/");
	assert.equal(folderOf({ name: "plan" }), "canvases/plan/");
});
