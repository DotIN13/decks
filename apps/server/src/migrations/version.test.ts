import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { deckVersion, DryRun, LATEST, MIGRATIONS, runAtOpen } from "./index.ts";
import { derivedVersion } from "./version.ts";

const write = (deck: string, path: string, text: string) => {
	mkdirSync(dirname(join(deck, path)), { recursive: true });
	writeFileSync(join(deck, path), text);
};
const record = (deck: string) => JSON.parse(readFileSync(join(deck, ".decks/migrations.json"), "utf8"));
const fresh = () => join(mkdtempSync(join(tmpdir(), "decks-version-")), "decks");
const ids = MIGRATIONS.map((one) => one.id);

test("versions run 1, 2, 3… with no gap, so the latest is the count", () => {
	assert.deepEqual(MIGRATIONS.map((one) => one.version), MIGRATIONS.map((_, i) => i + 1));
	assert.equal(LATEST, MIGRATIONS.length);
});

test("a new deck starts at the latest, and nothing runs on it", () => {
	const deck = fresh();
	assert.deepEqual(runAtOpen(deck), []);
	assert.equal(record(deck).version, LATEST);
	assert.equal(deckVersion(deck), LATEST);
});

test("a deck at the latest is not looked at: an old stages/ folder stays where it is", () => {
	const deck = fresh();
	write(deck, "stages/plan/stage.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/migrations.json", JSON.stringify({ version: LATEST }));
	assert.deepEqual(runAtOpen(deck), []);
	assert.ok(existsSync(join(deck, "stages/plan/stage.pen")));
	assert.ok(!existsSync(join(deck, "canvases")));
});

test("a deck behind runs only what comes after its version, and is then at the latest", () => {
	const deck = fresh();
	write(deck, "stages/plan/stage.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/migrations.json", JSON.stringify({ version: 1 }));
	runAtOpen(deck);
	// Version 1 moves stages/ to canvases/; at version 1 it has run, so it is not run again.
	assert.ok(existsSync(join(deck, "stages/plan/stage.pen")));
	assert.equal(record(deck).version, LATEST);
	for (const id of ids.slice(1)) assert.ok(id in record(deck), `${id} recorded itself`);
});

test("a deck from before numbers gets one from what it recorded, stopping at the first gap", () => {
	const deck = fresh();
	write(deck, "canvases/plan/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	const before = { [ids[1]!]: { at: "then" }, [ids[2]!]: { at: "then" }, [ids[4]!]: { at: "then" } };
	// 1 left no record but its old folder is gone; 2 and 3 recorded; 4 did not, so 5's record is not trusted.
	assert.equal(derivedVersion(before, MIGRATIONS, deck), 3);
	write(deck, ".decks/migrations.json", JSON.stringify(before));
	runAtOpen(deck);
	const after = record(deck);
	assert.equal(after.version, LATEST);
	assert.equal(after[ids[1]!].at, "then", "what earlier migrations recorded is kept");
	assert.ok(ids[3]! in after, "the skipped one ran");
});

test("a deck from before numbers that is up to date is given its number and nothing else", () => {
	const deck = fresh();
	write(deck, "canvases/plan/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/migrations.json", JSON.stringify(Object.fromEntries(ids.slice(1).map((id) => [id, { at: "then" }]))));
	assert.deepEqual(runAtOpen(deck), []);
	assert.equal(record(deck).version, LATEST);
});

test("a deck from a newer build is left alone, with a line saying so", () => {
	const deck = fresh();
	write(deck, "canvases/plan/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/migrations.json", JSON.stringify({ version: LATEST + 3 }));
	const said = runAtOpen(deck);
	assert.equal(said.length, 1);
	assert.match(said[0]!, /newer/);
	assert.equal(record(deck).version, LATEST + 3);
});

test("a dry run names the version and writes nothing", () => {
	const deck = fresh();
	write(deck, "canvases/plan/canvas.pen", JSON.stringify({ version: "2.14", children: [] }));
	write(deck, ".decks/migrations.json", JSON.stringify({ version: LATEST }));
	assert.throws(() => runAtOpen(deck, { dryRun: true }), (error: unknown) => error instanceof DryRun && error.lines.some((line) => line.includes(`version ${LATEST}`)));
	const empty = fresh();
	assert.throws(() => runAtOpen(empty, { dryRun: true }), DryRun);
	assert.ok(!existsSync(empty));
});
