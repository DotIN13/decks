import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";

/*
 * Canvases are the deck's: a new one is not named after the agent on it, and the first name chosen
 * for it names its folder.
 */

test("a new agent's canvas is not named after it, and the first name chosen names the folder", () => {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-canvas-name-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	try {
		const one = app.agents.create({ name: "Wren", restored: { id: "one", context: [], inPlay: [], createdAt: 1 } });
		const first = one.stageName(true)!;
		assert.equal(first, "untitled-canvas");
		app.handle({ type: "stage.rename", name: first, to: "Launch plan" }, () => {});
		assert.equal(one.stageName(), "launch-plan", "the folder takes the first name");
		assert.ok(existsSync(join(deck, "canvases", "launch-plan", "canvas.json")));
		app.handle({ type: "stage.rename", name: "launch-plan", to: "Launch plan, week two" }, () => {});
		assert.equal(one.stageName(), "launch-plan", "and keeps it after that");
		assert.equal(app.pens.titleOf("launch-plan"), "Launch plan, week two");
	} finally {
		app.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
