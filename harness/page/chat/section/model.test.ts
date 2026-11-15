import assert from "node:assert/strict";
import { test } from "node:test";
import { clampHeight, dragSpeed, foldWords, keyStep, revealInset, sheetFling, sheetGoes, stateWords } from "./model.ts";

// The section's rules: its words, its height, then the phone's sheet.

test("an agent's state is said after its name only while it works or waits", () => {
	assert.equal(stateWords("waiting", "Sable"), "waiting for you");
	assert.equal(stateWords("idle", "Sable"), undefined);
	assert.ok(stateWords("tool", "Sable"));
});

test("a dragged height stays between 120 px and 160 px short of the panel", () => {
	assert.equal(clampHeight(50, 800), 120);
	assert.equal(clampHeight(700, 800), 640);
	assert.equal(clampHeight(1000, undefined), 900);
});

test("the arrows step 16 px and Home resets", () => {
	assert.equal(keyStep("ArrowUp"), 16);
	assert.equal(keyStep("ArrowDown"), -16);
	assert.equal(keyStep("Home"), "reset");
	assert.equal(keyStep("a"), undefined);
});

test("the sheet opens from the pill's shape", () => {
	assert.equal(revealInset({ top: 500, right: 300, bottom: 540, left: 100 }, { top: 100, right: 400, bottom: 800, left: 0 }), "inset(400px 100px 260px 100px round 17px)");
});

test("a sheet goes past a quarter of its height or on a flick down, never on a cancel", () => {
	assert.equal(sheetGoes(150, 400, 0, false), true);
	assert.equal(sheetGoes(50, 400, 0.5, false), true);
	assert.equal(sheetGoes(50, 400, 0.2, false), false);
	assert.equal(sheetGoes(300, 400, 1, true), false);
	assert.equal(dragSpeed([{ y: 0, t: 0 }, { y: 40, t: 80 }]), 0.5);
});

test("a fling leaves within 180 to 420 ms, off the bottom of the screen", () => {
	const { off, ms } = sheetFling(100, 400, 2);
	assert.equal(off, 520);
	assert.ok(ms >= 180 && ms <= 420);
});

test("the fold control's words", () => {
	assert.deepEqual(foldWords({ folded: true }), { tip: "Show the conversation", label: "Show the conversation" });
	assert.equal(foldWords({ sheet: true, folded: false }).tip, "Back into the pill");
});
