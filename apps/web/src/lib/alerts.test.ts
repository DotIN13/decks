import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ALERT_KINDS,
	DEFAULT_PREFS,
	finished,
	inView,
	loadPrefs,
	shouldNotify,
	shouldSound,
	startedAsking,
	tabTitle,
} from "./alerts.ts";

/*
 * The cases here are the ones that would otherwise be found by leaving the app open for a
 * day: a laptop waking up and ringing eight times, a sound that goes quiet exactly when
 * somebody is there to hear it, and a saved setting from a version that had one fewer kind.
 */

const seen = { visible: true, focused: true };
const away = { visible: false, focused: false };

test("finishing is an arrival at idle, not being idle", () => {
	assert.ok(finished("streaming", "idle"));
	assert.ok(finished("tool", "idle"));
	assert.ok(finished("waiting", "idle"), "answering a question and then stopping is still stopping");
	assert.ok(!finished("idle", "idle"), "told twice is once");
	assert.ok(!finished("thinking", "streaming"));
});

test("…and the first thing we ever hear about an agent is never an event", () => {
	// A reconnection replays every agent's state. Treating the value as the event would ring
	// the whole deck at once every time a laptop woke up.
	assert.ok(!finished(undefined, "idle"));
	assert.ok(!startedAsking(undefined, "idle"));
});

test("asking is an arrival too", () => {
	assert.ok(startedAsking("tool", "waiting"));
	assert.ok(startedAsking(undefined, "waiting"), "a question outstanding when we connect is still a question");
	assert.ok(!startedAsking("waiting", "waiting"));
	assert.ok(!startedAsking("waiting", "idle"));
});

test("a sound plays whether or not you are looking; a banner does not", () => {
	for (const kind of ALERT_KINDS) {
		assert.equal(shouldSound(kind, DEFAULT_PREFS), true, kind);
	}
	assert.equal(shouldNotify("done", DEFAULT_PREFS, seen), false, "you can see the page already");
	assert.equal(shouldNotify("done", DEFAULT_PREFS, away), true);
	assert.equal(shouldNotify("ask", DEFAULT_PREFS, away), true);
	assert.equal(shouldNotify("problem", DEFAULT_PREFS, away), false, "a failure is loud enough on its own");
});

test("a tab in the background but focused, and vice versa, are both 'not in view'", () => {
	assert.ok(inView({ visible: true, focused: true }));
	assert.ok(!inView({ visible: true, focused: false }), "another window is on top");
	assert.ok(!inView({ visible: false, focused: true }), "another tab is showing");
});

test("silence is a choice, and so is the volume", () => {
	const muted = { ...DEFAULT_PREFS, volume: 0 };
	assert.equal(shouldSound("done", muted), false);
	const off = { ...DEFAULT_PREFS, sound: { ...DEFAULT_PREFS.sound, done: "none" as const } };
	assert.equal(shouldSound("done", off), false);
	assert.equal(shouldSound("ask", off), true, "one kind at a time");
});

test("saved preferences are merged per field, so an older blob is not a hole", () => {
	// Written before `problem` existed, and with a volume somebody hand-edited out of range.
	const old = JSON.stringify({ volume: 9, sound: { done: "ping" }, notify: { done: false } });
	const prefs = loadPrefs(() => old);
	assert.equal(prefs.sound.done, "ping", "what was saved");
	assert.equal(prefs.sound.problem, DEFAULT_PREFS.sound.problem, "what was not");
	assert.equal(prefs.notify.done, false, "false is a value, not a missing one");
	assert.equal(prefs.notify.ask, DEFAULT_PREFS.notify.ask);
	assert.equal(prefs.volume, DEFAULT_PREFS.volume, "9 is not a volume");
});

test("nothing saved, and nonsense saved, both give the defaults rather than throwing", () => {
	assert.deepEqual(loadPrefs(() => null), DEFAULT_PREFS);
	assert.deepEqual(loadPrefs(() => "{{{"), DEFAULT_PREFS);
	assert.deepEqual(loadPrefs(() => "42"), DEFAULT_PREFS);
	assert.deepEqual(loadPrefs(() => "null"), DEFAULT_PREFS);
});

test("the tab counts up to nine and then stops counting", () => {
	assert.equal(tabTitle(0), "Decks");
	assert.equal(tabTitle(1), "(1) Decks");
	assert.equal(tabTitle(9), "(9) Decks");
	assert.equal(tabTitle(23), "(9+) Decks", "a 120px tab shows about twelve characters");
	assert.equal(tabTitle(-1), "Decks");
});
