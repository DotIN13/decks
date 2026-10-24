import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, StageRow } from "@decks/protocol";
import { canvasTree, folderOf, OTHER } from "./canvas-tree.ts";

const stage = (name: string, title: string, agents: string[] = []): StageRow => ({ name, title, boards: 0, rev: 0, words: "", agents: agents.map((id) => ({ id, name: id, color: "#000" })) });
const board = (path: string, title: string): Board => ({ path, title }) as Board;

test("a canvas is filed under its agents' workspace, the one you are on first", () => {
	const { folders, library } = canvasTree({
		stages: [stage("a", "Alpha", ["x"]), stage("b", "Beta"), stage("c", "Gamma", ["y"])],
		boards: [board("canvases/a/boards/one.html", "One"), board("canvases/c/boards/two.html", "Two"), board("boards/old.html", "Old")],
		identities: { x: { workspace: "zeta" }, y: { workspace: "alpha" } } as never,
		here: "a",
		query: "",
	});
	assert.deepEqual(folders.map((f) => f.label), ["zeta", "alpha", OTHER]);
	assert.equal(folders[0]!.canvases[0]!.here, true);
	assert.deepEqual(folders[0]!.canvases[0]!.boards.map((b) => b.title), ["One"]);
	assert.deepEqual(library.map((b) => b.title), ["Old"]);
});

test("a query keeps a canvas for a matching board, with only that board", () => {
	const { folders } = canvasTree({
		stages: [stage("a", "Alpha"), stage("b", "Beta")],
		boards: [board("canvases/a/boards/one.html", "Sidebar plan"), board("canvases/a/boards/two.html", "Other"), board("canvases/b/boards/x.html", "X")],
		identities: {},
		query: "sidebar",
	});
	assert.equal(folders.length, 1);
	assert.equal(folders[0]!.canvases.length, 1);
	assert.equal(folders[0]!.canvases[0]!.hit, false);
	assert.deepEqual(folders[0]!.canvases[0]!.boards.map((b) => b.title), ["Sidebar plan"]);
});

test("a friend's canvas lives in shared/canvases", () => {
	assert.equal(folderOf({ name: "shared/ann/plan" }), "shared/canvases/ann/plan/");
	assert.equal(folderOf({ name: "plan" }), "canvases/plan/");
});
