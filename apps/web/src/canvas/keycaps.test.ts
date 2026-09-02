import assert from "node:assert/strict";
import { test } from "node:test";
import { isKey, tokens } from "./keycaps.ts";

/**
 * The rule that decides what gets a keycap drawn round it.
 *
 * Every string below is one that is actually in the cheat sheet, which is the point: the
 * tokeniser exists to keep the data readable, so its test is the data.
 */

const caps = (keys: string) => tokens(keys).map((t) => ("cap" in t ? `[${t.cap}]` : "word" in t ? t.word : "·")).join(" ");

test("a key on its own is one cap", () => {
	for (const key of ["0", "1", "V", "S", "/", "⌫", "Escape"]) assert.equal(caps(key), `[${key}]`, key);
});

test("a Mac chord is one cap, not two", () => {
	assert.equal(caps("⌘D"), "[⌘D]");
	assert.equal(caps("⌘Z"), "[⌘Z]");
});

test("` · ` is alternatives, and the dot is the renderer's", () => {
	assert.equal(caps("+ · -"), "[+] · [-]");
	assert.equal(caps("[ · ]"), "[[] · []]");
});

test("a hyphen joins a chord only when both halves are keys", () => {
	assert.equal(caps("arrows · shift-arrows"), "[arrows] · [shift] [arrows]");
	// A key and a word: the key gets a cap and the gesture stays a gesture.
	assert.equal(caps("space-drag"), "[space] drag");
	assert.equal(caps("pinch · ⌘-wheel"), "pinch · [⌘] wheel");
});

/*
 * The one this rule exists for. "double-click" has a hyphen and no key on either side of it,
 * so a per-hyphen split would have made two caps out of a single gesture.
 */
test("a hyphenated gesture stays one phrase", () => {
	assert.equal(caps("double-click"), "double-click");
	assert.equal(caps("two-finger scroll"), "two-finger scroll");
});

test("a sentence is a sentence", () => {
	for (const phrase of ["drop a file on a board", "drag a board's title", "the properties sheet", "click a turn on the right spine"]) {
		assert.equal(caps(phrase), phrase, phrase);
	}
});

test("nothing is a key by accident", () => {
	assert.equal(isKey(""), false);
	assert.equal(isKey("drag"), false);
	assert.equal(isKey("click"), false);
	// A two-character token that is not a chord: the glyph has to be a modifier.
	assert.equal(isKey("ab"), false);
	assert.equal(isKey("⌘D"), true);
	// One code point, not one UTF-16 unit — `⌫` is a single key and two units.
	assert.equal(isKey("⌫"), true);
});
