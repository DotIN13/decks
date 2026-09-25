import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DeckAgent } from "../agents/session.ts";
import { Deck } from "../deck/loader.ts";
import { copyStage, originOf } from "./isolated-stages.ts";
import { StagePens } from "./pens.ts";
import { deleteStage, renameStage } from "./stage-admin.ts";

/*
 * Renaming and deleting stages against a real deck. A rename must carry the boards kept in the
 * stage's folder with it without breaking what is joined to them; a delete must take only what
 * the stage owned.
 */

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "decks-stage-admin-"));
	const deckPath = join(root, "decks");
	mkdirSync(join(deckPath, "boards"), { recursive: true });
	writeFileSync(join(deckPath, "boards", "plan.html"), "<title>Plan</title>PLAN");
	const deck = Deck.open(deckPath);
	const pens = new StagePens(deckPath, () => undefined);
	pens.claim("deploy");
	pens.syncBoards("deploy", [{ path: "boards/plan.html", x: 10, y: 20, w: 800, h: 500, title: "Plan" }]);
	copyStage(deck, pens, "deploy", "deploy-isolated", { isolated: true, origin: "deploy" });
	const context = { deck, pens, agents: [] as DeckAgent[] };
	return { deckPath, deck, pens, context, done: () => (pens.close(), rmSync(root, { recursive: true, force: true })) };
}

test("a rename moves the folder and re-points the boards kept in it, keeping their ids", () => {
	const { deckPath, deck, pens, context, done } = fixture();
	try {
		const before = pens.boards("deploy-isolated");
		const to = renameStage(context, "deploy-isolated", "Launch Plan!");
		assert.equal(to, "launch-plan");
		assert.ok(!existsSync(join(deckPath, "stages", "deploy-isolated")));
		const after = pens.boards("launch-plan");
		assert.deepEqual(after.map((one) => one.path), ["stages/launch-plan/boards/plan.html"]);
		assert.deepEqual(after.map((one) => one.id), before.map((one) => one.id));
		assert.ok(existsSync(join(deckPath, "stages", "launch-plan", "boards", "plan.html")));
		assert.ok(deck.board("stages/launch-plan/boards/plan.html"));
		assert.ok(!deck.board("stages/deploy-isolated/boards/plan.html"));
		assert.throws(() => renameStage(context, "launch-plan", "deploy"), /already exists/);
		assert.throws(() => renameStage(context, "launch-plan", "!!!"), /letter or a number/);
	} finally {
		done();
	}
});

test("renaming a stage an isolated one was copied from updates where it says it came from", () => {
	const { pens, context, done } = fixture();
	try {
		renameStage(context, "deploy", "release");
		assert.equal(originOf(pens, "deploy-isolated"), "release");
	} finally {
		done();
	}
});

test("a delete takes the stage and the boards kept in its folder, and never the deck's own boards", () => {
	const { deckPath, deck, pens, context, done } = fixture();
	try {
		deleteStage(context, "deploy-isolated");
		assert.ok(!pens.names().includes("deploy-isolated"));
		assert.ok(!existsSync(join(deckPath, "stages", "deploy-isolated")));
		assert.ok(!deck.board("stages/deploy-isolated/boards/plan.html"));
		deleteStage(context, "deploy");
		assert.equal(readFileSync(join(deckPath, "boards", "plan.html"), "utf8"), "<title>Plan</title>PLAN");
	} finally {
		done();
	}
});

test("neither is allowed while an agent on that stage is in the middle of a turn", () => {
	const { context, done } = fixture();
	try {
		const busy = { name: "Ada", running: true, stageName: () => "deploy" } as unknown as DeckAgent;
		const withBusy = { ...context, agents: [busy] };
		assert.throws(() => renameStage(withBusy, "deploy", "other"), /Ada is working on "deploy"/);
		assert.throws(() => deleteStage(withBusy, "deploy"), /Ada is working on "deploy"/);
	} finally {
		done();
	}
});
