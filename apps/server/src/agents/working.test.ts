import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LOOP_MS, resumeNote, WorkingLog } from "./working.ts";

test("a turn cut by a stop is found at the next start, and a finished one is not", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-working-"));
	const file = join(dir, ".decks", "working.json");
	const first = new WorkingLog(file);
	assert.deepEqual(first.toResume(), []);
	first.set("a", true);
	first.set("b", true);
	first.set("b", false);
	// Written at once: a stop gives no warning.
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["a"]);
	// The server stops: a runtime reporting idle as it dies changes nothing.
	first.close();
	first.set("a", false);

	const second = new WorkingLog(file);
	assert.deepEqual(second.toResume().map((one) => one.id), ["a"]);
	// The new start begins with nobody working.
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
	rmSync(dir, { recursive: true, force: true });
});

test("a turn cut again just after it was resumed is left for the person", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-working-"));
	const file = join(dir, "working.json");
	const first = new WorkingLog(file);
	const resumed = Date.now();
	first.set("a", true, resumed);
	first.set("a", true);
	assert.equal(JSON.parse(readFileSync(file, "utf8")).a.resumed, resumed);

	const soon = new WorkingLog(file);
	assert.deepEqual(soon.toResume(resumed + 1000), []);
	// Long after, it is an ordinary cut turn again.
	assert.deepEqual(soon.toResume(resumed + LOOP_MS + 1).map((one) => one.id), ["a"]);
	rmSync(dir, { recursive: true, force: true });
});

test("the note says who is speaking and is not a slash command", () => {
	const note = resumeNote(Date.now() - 60_000);
	assert.match(note, /^\[From Decks, not the person\]/);
	assert.doesNotMatch(note, /^\//);
});
