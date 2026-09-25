import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deck } from "../deck/loader.ts";
import { copyStage, fromIsolation, isIsolatedStage, markIsolated, numberedName, originOf } from "./isolated-stages.ts";
import { StagePens } from "./pens.ts";

/*
 * Isolated stages, against a real deck: an isolated copy must leave the stage it came from and its
 * boards exactly as they were, and copying back must never land on a stage that exists.
 */

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "decks-isolated-stages-"));
	const deckPath = join(root, "decks");
	mkdirSync(join(deckPath, "boards"), { recursive: true });
	writeFileSync(join(deckPath, "boards", "plan.html"), '<title>Plan</title><link href="../lib/board.css">PLAN');
	const deck = Deck.open(deckPath);
	const pens = new StagePens(deckPath, () => undefined);
	pens.claim("deploy");
	pens.syncBoards("deploy", [{ path: "boards/plan.html", x: 40, y: 60, w: 800, h: 500, title: "Plan" }]);
	const before = readFileSync(pens.fileOf("deploy"), "utf8");
	return { deckPath, deck, pens, before, done: () => (pens.close(), rmSync(root, { recursive: true, force: true })) };
}

test("an isolated copy holds its own copies of the boards, in place, and leaves the original stage alone", () => {
	const { deckPath, deck, pens, before, done } = fixture();
	try {
		const paths = copyStage(deck, pens, "deploy", "deploy-isolated", { isolated: true, origin: "deploy" });
		assert.deepEqual(paths, ["stages/deploy-isolated/boards/plan.html"]);
		assert.match(readFileSync(join(deckPath, paths[0]!), "utf8"), /href="\.\.\/\.\.\/\.\.\/lib\/board\.css"/);
		assert.deepEqual(pens.boards("deploy-isolated").map((one) => [one.path, one.x, one.y]), [["stages/deploy-isolated/boards/plan.html", 40, 60]]);
		assert.ok(isIsolatedStage(pens, "deploy-isolated") && !isIsolatedStage(pens, "deploy"));
		assert.equal(originOf(pens, "deploy-isolated"), "deploy");
		assert.equal(readFileSync(pens.fileOf("deploy"), "utf8"), before);
		assert.equal(readFileSync(join(deckPath, "boards", "plan.html"), "utf8"), '<title>Plan</title><link href="../lib/board.css">PLAN');
	} finally {
		done();
	}
});

test("copying back makes an ordinary stage named <origin>-1, then -2, never over one that exists", () => {
	const { deckPath, deck, pens, done } = fixture();
	try {
		copyStage(deck, pens, "deploy", "deploy-isolated", { isolated: true, origin: "deploy" });
		writeFileSync(join(deckPath, "stages", "deploy-isolated", "boards", "plan.html"), "EDITED WHILE ISOLATED");
		const first = numberedName(pens, "deploy");
		copyStage(deck, pens, "deploy-isolated", first, { isolated: false });
		assert.equal(first, "deploy-1");
		assert.ok(!isIsolatedStage(pens, "deploy-1"));
		assert.equal(readFileSync(join(deckPath, "stages", "deploy-1", "boards", "plan.html"), "utf8"), "EDITED WHILE ISOLATED");
		assert.equal(numberedName(pens, "deploy"), "deploy-2");
		assert.throws(() => copyStage(deck, pens, "deploy", "deploy-1", { isolated: false }));
		assert.ok(existsSync(join(deckPath, "stages", "deploy-isolated", "boards", "plan.html")), "the isolated stage stays");
	} finally {
		done();
	}
});

test("a stage made while isolated is marked isolated, with no origin", () => {
	const { pens, done } = fixture();
	try {
		pens.claim("scratch");
		markIsolated(pens, "scratch");
		assert.ok(isIsolatedStage(pens, "scratch"));
		assert.equal(originOf(pens, "scratch"), undefined);
	} finally {
		done();
	}
});

test("a stage copied back is marked as such, and a copy of it is not", () => {
	const { deck, pens, done } = fixture();
	try {
		copyStage(deck, pens, "deploy", "deploy-isolated", { isolated: true, origin: "deploy" });
		copyStage(deck, pens, "deploy-isolated", "deploy-1", { isolated: false, back: true });
		assert.ok(fromIsolation(pens, "deploy-1"));
		assert.ok(!fromIsolation(pens, "deploy") && !fromIsolation(pens, "deploy-isolated"));
		copyStage(deck, pens, "deploy-1", "deploy-copy", { isolated: false });
		assert.ok(!fromIsolation(pens, "deploy-copy"));
	} finally {
		done();
	}
});
