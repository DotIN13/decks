import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import type { DeckAgent } from "../agents/session.ts";
import { Deck } from "../deck/loader.ts";
import { StagePens } from "./pens.ts";
import { deleteStage, renameStage } from "./admin.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


/*
 * Renaming and deleting stages against a real deck. A rename must carry the boards kept in the
 * stage's folder with it without breaking what is joined to them; a delete must take only what
 * the stage owned.
 */

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "decks-stage-admin-"));
	const deckPath = join(root, "decks");
	mkdirSync(join(deckPath, "boards"), { recursive: true });
	put(join(deckPath, "canvases", "t", "cards", "plan", "index.html"), "<title>Plan</title>PLAN");
	const deck = Deck.open(deckPath);
	const pens = new StagePens(deckPath, () => undefined);
	pens.claim("deploy");
	pens.syncBoards("deploy", [{ path: "canvases/t/cards/plan/index.html", x: 10, y: 20, w: 800, h: 500, title: "Plan" }]);
	// A second canvas that keeps its own copy of the board in its folder.
	pens.claim("deploy-copy");
	mkdirSync(join(deckPath, "canvases", "deploy-copy", "boards"), { recursive: true });
	put(join(deckPath, "canvases", "deploy-copy", "cards", "plan", "index.html"), "<title>Plan</title>PLAN");
	deck.refresh("canvases/deploy-copy/cards/plan/index.html");
	pens.syncBoards("deploy-copy", [{ path: "canvases/deploy-copy/cards/plan/index.html", x: 10, y: 20, w: 800, h: 500, title: "Plan" }]);
	const context = { deck, pens, agents: [] as DeckAgent[] };
	return { deckPath, deck, pens, context, done: () => (pens.close(), rmSync(root, { recursive: true, force: true })) };
}

test("a rename moves the folder and re-points the boards kept in it, keeping their ids", () => {
	const { deckPath, deck, pens, context, done } = fixture();
	try {
		const before = pens.boards("deploy-copy");
		const to = renameStage(context, "deploy-copy", "Launch Plan!");
		assert.equal(to, "launch-plan");
		assert.ok(!existsSync(join(deckPath, "canvases", "deploy-copy")));
		const after = pens.boards("launch-plan");
		assert.deepEqual(after.map((one) => one.path), ["canvases/launch-plan/cards/plan/index.html"]);
		assert.deepEqual(after.map((one) => one.id), before.map((one) => one.id));
		assert.ok(existsSync(join(deckPath, "canvases", "launch-plan", "cards", "plan", "index.html")));
		assert.ok(deck.board("canvases/launch-plan/cards/plan/index.html"));
		assert.ok(!deck.board("canvases/deploy-copy/cards/plan/index.html"));
		assert.throws(() => renameStage(context, "launch-plan", "deploy"), /already exists/);
		assert.throws(() => renameStage(context, "launch-plan", "!!!"), /letter or a number/);
	} finally {
		done();
	}
});

test("a delete takes the stage and the boards kept in its folder, and never the deck's own boards", () => {
	const { deckPath, deck, pens, context, done } = fixture();
	try {
		deleteStage(context, "deploy-copy");
		assert.ok(!pens.names().includes("deploy-copy"));
		assert.ok(!existsSync(join(deckPath, "canvases", "deploy-copy")));
		assert.ok(!deck.board("canvases/deploy-copy/cards/plan/index.html"));
		deleteStage(context, "deploy");
		assert.equal(readFileSync(join(deckPath, "canvases", "t", "cards", "plan", "index.html"), "utf8"), "<title>Plan</title>PLAN");
	} finally {
		done();
	}
});

test("neither is allowed while an agent on that stage is in the middle of a turn", () => {
	const { context, done } = fixture();
	try {
		const busy = { name: "Ada", conversation: { running: true }, seat: { stageName: () => "deploy" } } as unknown as DeckAgent;
		const withBusy = { ...context, agents: [busy] };
		assert.throws(() => renameStage(withBusy, "deploy", "other"), /Ada is working on "deploy"/);
		assert.throws(() => deleteStage(withBusy, "deploy"), /Ada is working on "deploy"/);
	} finally {
		done();
	}
});
