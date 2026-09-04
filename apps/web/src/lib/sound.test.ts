import assert from "node:assert/strict";
import { test } from "node:test";
import { CUE_IDS, CUES, cue, cueLength, hz } from "./sound.ts";

/*
 * The audible half cannot be asserted here — a test that claims the browser made a noise is
 * a test of the browser. What *can* be asserted is everything the cues are made of, and it
 * is the part that goes wrong silently: a pitch that resolves to the wrong octave is a cue
 * that still plays, just badly, and nobody files that as a bug.
 */

test("pitches are equal temperament with A4 at 440", () => {
	assert.equal(hz("A4"), 440);
	assert.equal(Math.round(hz("A5")), 880);
	assert.equal(Math.round(hz("A3")), 220);
	assert.equal(Math.round(hz("C4")), 262, "middle C");
	assert.equal(Math.round(hz("G5")), 784);
	assert.equal(Math.round(hz("D6")), 1175);
});

test("sharps and flats are the same key", () => {
	assert.equal(hz("A#4"), hz("Bb4"));
	assert.ok(hz("C#5") > hz("C5"));
	assert.throws(() => hz("H4"), /not a pitch/);
	assert.throws(() => hz("440"), /not a pitch/);
});

test("every id in the list is a cue, and every cue is in the list", () => {
	assert.deepEqual(
		CUES.map((item) => item.id),
		[...CUE_IDS],
	);
	for (const id of CUE_IDS) assert.ok(cue(id), id);
	assert.equal(cue("none"), undefined);
	assert.equal(cue(undefined), undefined);
});

test("silence is zero length, so a preview has nothing to wait for", () => {
	assert.equal(cueLength("none"), 0);
	assert.equal(cueLength(undefined), 0);
});

test("no cue outstays its welcome", () => {
	// Heard several hundred times a day by somebody who leaves this open. 400ms is the line.
	for (const item of CUES) assert.ok(cueLength(item.id) <= 400, `${item.id} is ${cueLength(item.id)}ms`);
});

test("the three shapes say three different things", () => {
	const shape = (id: (typeof CUE_IDS)[number]) => {
		const notes = cue(id)?.notes ?? [];
		if (notes.length < 2) return "single";
		const first = hz(notes[0]!.pitch);
		const last = hz(notes.at(-1)!.pitch);
		if (last > first) return "rising";
		if (last < first) return "falling";
		return "level";
	};
	assert.equal(shape("chime"), "rising", "finished: the phrase resolves and stops asking");
	assert.equal(shape("bloop"), "rising");
	assert.equal(shape("knock"), "level", "a question has nowhere to go");
	assert.equal(shape("drop"), "falling", "wrong");
	assert.equal(shape("alarm"), "falling");
});

test("notes are ordered and none of them is silent", () => {
	for (const item of CUES) {
		let last = -1;
		for (const note of item.notes) {
			assert.ok(note.at >= last, `${item.id} notes out of order`);
			last = note.at;
			assert.ok(note.ms > 0 && note.gain > 0 && note.gain <= 1, `${item.id} has a note that cannot be heard`);
			assert.doesNotThrow(() => hz(note.pitch), `${item.id}: ${note.pitch}`);
		}
	}
});
