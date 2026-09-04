import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { isSound, SILENT, SOUND_FAMILIES, SOUND_IDS, soundLabel, soundName, soundUrl } from "./sound.ts";

/*
 * The cues are files now, so the assertion worth having is that the list and the directory
 * agree. Everything else in this module is naming, and naming is only interesting where a
 * saved preference could name something that is not there — which is exactly the state a
 * browser is in after this build, since the ids changed under it.
 */

const sounds = join(dirname(fileURLToPath(import.meta.url)), "../../public/sounds");
const onDisk = readdirSync(sounds)
	.filter((name) => name.endsWith(".mp3"))
	.map((name) => name.replace(/\.mp3$/, ""))
	.sort();

test("every id has a file and every file has an id", () => {
	// The one that catches a half-finished vendoring, in either direction: a picker row that
	// 404s, or forty-five files of which the app can only reach forty.
	assert.deepEqual([...SOUND_IDS].sort(), onDisk);
	assert.equal(SOUND_IDS.length, 45, "opencode's whole set");
});

test("the families add up to the list", () => {
	assert.equal(
		SOUND_FAMILIES.reduce((total, family) => total + family.count, 0),
		SOUND_IDS.length,
	);
	for (const family of SOUND_FAMILIES) {
		const mine = SOUND_IDS.filter((id) => id.startsWith(`${family.id}-`));
		assert.equal(mine.length, family.count, family.id);
	}
});

test("ids are numbered from 01 with a leading zero, which is how the files are named", () => {
	assert.ok(SOUND_IDS.includes("staplebops-01"));
	assert.ok(SOUND_IDS.includes("nope-12"));
	assert.ok(!SOUND_IDS.includes("nope-1"));
	assert.ok(!SOUND_IDS.includes("staplebops-08"), "there are seven of those, not eight");
});

test("a url is the id, so a saved preference stays legible", () => {
	assert.equal(soundUrl("staplebops-01"), "/sounds/staplebops-01.mp3");
	assert.equal(soundUrl(SILENT), undefined);
	assert.equal(soundUrl("chime"), undefined, "a cue from the synthesised set that no longer exists");
});

test("an unknown name is not a sound, which is what stops a 404 being a silent setting", () => {
	assert.ok(isSound("bip-bop-07"));
	assert.ok(isSound(SILENT));
	assert.ok(!isSound("chime"), "the old synthesised ids");
	assert.ok(!isSound("../../etc/passwd"));
	assert.ok(!isSound(undefined));
	assert.ok(!isSound(7));
});

test("the picker splits a name; the chip joins it", () => {
	assert.deepEqual(soundLabel("staplebops-01"), { family: "Staplebops", number: "01" });
	assert.deepEqual(soundLabel("bip-bop-10"), { family: "Bip bop", number: "10" }, "the family name has its own hyphen in it");
	assert.equal(soundName("bip-bop-10"), "Bip bop 10");
	assert.equal(soundName(SILENT), "Silent");
	assert.equal(soundName(undefined), "Silent");
});
