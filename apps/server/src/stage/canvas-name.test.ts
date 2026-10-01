import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canvasNameReminder } from "./canvas-name.ts";
import { StagePens } from "./pens.ts";

/* When an agent is asked to name its canvas: no name of its own, or a name the canvas has outgrown. */

const board = (path: string, x: number) => ({ type: "browser", id: path.replace(/\W+/g, "-"), url: `../../${path}`, x, y: 0, width: 400, height: 300, metadata: { type: "decks.board", path } });

function setup() {
	const root = mkdtempSync(join(tmpdir(), "decks-canvas-name-"));
	const pens = new StagePens(root, () => {});
	const put = (stage: string, paths: string[]) => {
		writeFileSync(pens.fileOf(stage), JSON.stringify({ version: "2.14", children: paths.map((path, i) => board(path, i * 500)) }));
		// The cache holds what it read; a fresh read is what the next call should see.
		(pens as unknown as { cache: Map<string, unknown> }).cache.delete(stage);
	};
	return { root, pens, put };
}

test("an empty canvas is not asked about, whatever it is called", () => {
	const { root, pens } = setup();
	try {
		const stage = pens.claim("Agent 3", { provisional: true });
		assert.equal(canvasNameReminder(pens, stage), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a canvas with boards and only its agent's name is asked to be named, until it is", () => {
	const { root, pens, put } = setup();
	try {
		const stage = pens.claim("Agent 3", { provisional: true });
		put(stage, ["boards/a.html"]);
		assert.match(canvasNameReminder(pens, stage) ?? "", /says nothing about what is on it/);
		pens.setTitle(stage, "Pricing study");
		assert.equal(canvasNameReminder(pens, stage), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a named canvas that now holds mostly other boards is asked whether the name still fits, and saying it again ends that", () => {
	const { root, pens, put } = setup();
	try {
		const stage = pens.claim("Pricing study");
		put(stage, ["boards/a.html", "boards/b.html"]);
		pens.setTitle(stage, "Pricing study");
		put(stage, ["boards/a.html", "boards/b.html", "boards/c.html", "boards/d.html"]);
		assert.equal(canvasNameReminder(pens, stage), undefined, "two new of four is not mostly new");
		put(stage, ["boards/a.html", "boards/b.html", "boards/c.html", "boards/d.html", "boards/e.html"]);
		assert.match(canvasNameReminder(pens, stage) ?? "", /3 of 5/);
		pens.setTitle(stage, "Pricing study");
		assert.equal(canvasNameReminder(pens, stage), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a canvas named before anything was on it keeps its name without asking", () => {
	const { root, pens, put } = setup();
	try {
		const stage = pens.claim("Launch plan");
		put(stage, ["boards/a.html", "boards/b.html", "boards/c.html", "boards/d.html"]);
		assert.equal(canvasNameReminder(pens, stage), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
