import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { processZone } from "./clock.ts";
import { SettingsStore } from "./settings.ts";

function deckDir(): string {
	return mkdtempSync(join(tmpdir(), "decks-settings-"));
}

test("a chosen timezone becomes the process clock, is saved, and comes back in a new process", () => {
	const dir = deckDir();
	const store = new SettingsStore(dir);
	const machine = store.machineZone();
	assert.deepEqual(store.get(), {});
	assert.equal(store.zone(), machine);

	assert.deepEqual(store.setTimezone("Asia/Tokyo"), { timezone: "Asia/Tokyo" });
	assert.equal(processZone(), "Asia/Tokyo");
	assert.equal(new Date(Date.UTC(2026, 0, 1, 0, 0)).getHours(), 9);
	assert.match(readFileSync(join(dir, ".decks", "settings.json"), "utf8"), /"timezone": "Asia\/Tokyo"/);

	// Another process on the same deck reads it, and is on the same clock from its first line.
	store.setTimezone(null);
	writeFileSync(join(dir, ".decks", "settings.json"), JSON.stringify({ timezone: "America/Los_Angeles" }), "utf8");
	const again = new SettingsStore(dir);
	assert.equal(again.zone(), "America/Los_Angeles");
	assert.equal(processZone(), "America/Los_Angeles");

	// And `null` puts the machine's own zone back.
	assert.deepEqual(again.setTimezone(null), {});
	assert.equal(processZone(), machine);
	rmSync(dir, { recursive: true, force: true });
});

test("a timezone that is not one is refused with a sentence, and nothing moves", () => {
	const dir = deckDir();
	const store = new SettingsStore(dir);
	const before = processZone();
	const outcome = store.setTimezone("Pacific Time");
	assert.ok("error" in outcome);
	assert.match(outcome.error, /not a timezone/);
	assert.equal(processZone(), before);
	assert.deepEqual(store.get(), {});
	rmSync(dir, { recursive: true, force: true });
});

test("a settings file with an unknown zone, or not JSON, reads as nothing chosen", () => {
	const dir = deckDir();
	mkdirSync(join(dir, ".decks"), { recursive: true });
	writeFileSync(join(dir, ".decks", "settings.json"), JSON.stringify({ timezone: "Mars/Olympus" }), "utf8");
	assert.deepEqual(new SettingsStore(dir).get(), {});
	const warnings: string[] = [];
	writeFileSync(join(dir, ".decks", "settings.json"), "{oops", "utf8");
	assert.deepEqual(new SettingsStore(dir, (text) => warnings.push(text)).get(), {});
	assert.equal(warnings.length, 1);
	rmSync(dir, { recursive: true, force: true });
});
