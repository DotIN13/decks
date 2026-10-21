import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { migrated, migrateIsolation } from "./2026-10-21-isolation-removed.ts";
import { runAtOpen } from "./index.ts";

const write = (deck: string, path: string, text: string) => {
	mkdirSync(dirname(join(deck, path)), { recursive: true });
	writeFileSync(join(deck, path), text);
};
const json = (deck: string, path: string) => JSON.parse(readFileSync(join(deck, path), "utf8"));

/** A deck an isolated agent worked in: its isolated canvas, one copied back, and an ordinary agent beside it. */
function isolatedDeck() {
	const deck = join(mkdtempSync(join(tmpdir(), "decks-isolation-removed-")), "decks");
	const board = (path: string) => ({ type: "browser", id: path, url: path, width: 600, height: 400, x: 0, y: 0, metadata: { type: "decks.board", path } });
	write(deck, "canvases/deploy/canvas.pen", JSON.stringify({ version: "2.14", children: [board("boards/plan.html")] }));
	write(deck, "canvases/deploy/boards/plan.html", "<title>Plan</title>original");
	write(deck, "canvases/deploy-isolated/canvas.pen", JSON.stringify({ version: "2.14", children: [board("boards/plan.html")] }));
	write(deck, "canvases/deploy-isolated/boards/plan.html", "<title>Plan</title>the agent's edit");
	write(deck, "canvases/deploy-isolated/isolated.json", JSON.stringify({ from: "deploy" }));
	write(deck, "canvases/deploy-1/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, "canvases/deploy-1/from-isolation.json", JSON.stringify({ from: "deploy-isolated" }));
	write(deck, ".decks/agents/iso/meta.json", JSON.stringify({ id: "iso", name: "Ada", stage: "deploy-isolated", isolated: true, isolatedStages: ["deploy-isolated"], context: ["canvases/deploy-isolated/boards/plan.html"] }, null, 2));
	write(deck, ".decks/agents/plain/meta.json", JSON.stringify({ id: "plain", name: "Bo", stage: "deploy" }, null, 2));
	write(deck, ".decks/migrations.json", JSON.stringify({ "2026-10-20-standalone-canvases": { at: "then" } }));
	return deck;
}

test("isolated agents become ordinary and their canvases stay where they are, after a backup of what changes", () => {
	const deck = isolatedDeck();
	const plainBefore = readFileSync(join(deck, ".decks/agents/plain/meta.json"), "utf8");
	const { ran, backup, plan } = migrateIsolation(deck, { now: new Date("2026-10-21T00:00:00Z") });
	assert.ok(ran);
	assert.deepEqual(plan.marks, ["canvases/deploy-1/from-isolation.json", "canvases/deploy-isolated/isolated.json"]);
	assert.deepEqual(plan.agents, [".decks/agents/iso/meta.json"]);
	// The markers are gone; the canvases, their drawings and boards are all still there.
	assert.ok(!existsSync(join(deck, "canvases/deploy-isolated/isolated.json")));
	assert.ok(!existsSync(join(deck, "canvases/deploy-1/from-isolation.json")));
	assert.equal(readFileSync(join(deck, "canvases/deploy-isolated/boards/plan.html"), "utf8"), "<title>Plan</title>the agent's edit");
	assert.equal(readFileSync(join(deck, "canvases/deploy/boards/plan.html"), "utf8"), "<title>Plan</title>original");
	assert.ok(existsSync(join(deck, "canvases/deploy-1/canvas.pen")));
	// The agent keeps everything but the two isolation fields, and stays on its canvas.
	assert.deepEqual(json(deck, ".decks/agents/iso/meta.json"), { id: "iso", name: "Ada", stage: "deploy-isolated", context: ["canvases/deploy-isolated/boards/plan.html"] });
	assert.equal(readFileSync(join(deck, ".decks/agents/plain/meta.json"), "utf8"), plainBefore);
	// The backup holds exactly what changed, as it was.
	assert.equal(backup, ".decks/backups/2026-10-21T00-00-00-000Z-before-isolation-removed.zip");
	const listed = execFileSync("unzip", ["-Z1", join(deck, backup!)], { encoding: "utf8" }).trim().split("\n").sort();
	assert.deepEqual(listed, [".decks/agents/iso/meta.json", "canvases/deploy-1/from-isolation.json", "canvases/deploy-isolated/isolated.json"]);
	assert.match(execFileSync("unzip", ["-p", join(deck, backup!), ".decks/agents/iso/meta.json"], { encoding: "utf8" }), /"isolated": true/);
	// Recorded beside the earlier migration, and never run again.
	const record = json(deck, ".decks/migrations.json");
	assert.ok(record["2026-10-20-standalone-canvases"]);
	assert.deepEqual(record["2026-10-21-isolation-removed"], { at: "2026-10-21T00:00:00.000Z", backup, marks: 2, agents: 1 });
	assert.ok(migrated(deck));
	assert.equal(migrateIsolation(deck).ran, false);
});

test("a deck that never used isolated mode is only recorded, with no backup", () => {
	const deck = join(mkdtempSync(join(tmpdir(), "decks-isolation-removed-")), "decks");
	write(deck, "canvases/a/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/agents/x/meta.json", JSON.stringify({ id: "x", stage: "a" }, null, 2));
	write(deck, ".decks/migrations.json", JSON.stringify({ "2026-10-20-standalone-canvases": { at: "then" } }));
	const said = runAtOpen(deck);
	assert.deepEqual(said, []);
	assert.ok(migrated(deck));
	assert.ok(!existsSync(join(deck, ".decks/backups")));
	assert.equal(json(deck, ".decks/migrations.json")["2026-10-21-isolation-removed"].marks, 0);
});

test("a dry run says what it would change and changes nothing", () => {
	const deck = isolatedDeck();
	assert.throws(() => runAtOpen(deck, { dryRun: true }), (error: Error & { lines?: string[] }) => {
		assert.ok(error.lines?.some((line) => line.includes("canvases/deploy-isolated/isolated.json")));
		assert.ok(error.lines?.some((line) => line.includes(".decks/agents/iso/meta.json")));
		return true;
	});
	assert.ok(existsSync(join(deck, "canvases/deploy-isolated/isolated.json")));
	assert.equal(json(deck, ".decks/agents/iso/meta.json").isolated, true);
	assert.ok(!migrated(deck));
});
