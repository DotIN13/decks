import assert from "node:assert/strict";
import { test } from "node:test";
import { pairUserEntries, translatorTimeline } from "./entries.ts";
import { Translator } from "./translator.ts";

function said(...texts: string[]): Translator {
	const translator = new Translator("A", () => {});
	for (const text of texts) translator.user(text);
	return translator;
}

test("user messages are paired from the end, so a capped transcript still lines up with the session", () => {
	const translator = said("second", "third");
	pairUserEntries(translator, [
		{ id: "e1", content: "first" },
		{ id: "e2", content: "second" },
		{ id: "e3", content: [{ type: "text", text: "a reminder\n\nthird" }] },
	]);
	assert.deepEqual(translatorTimeline(translator).map((point) => point.id), ["e2", "e3"]);
});

test("the walk stops at the first message that disagrees and tags nothing before it", () => {
	const translator = said("one", "two", "three");
	pairUserEntries(translator, [
		{ id: "e1", content: "one" },
		{ id: "e2", content: "not what was typed" },
		{ id: "e3", content: "three" },
	]);
	assert.deepEqual(translatorTimeline(translator).map((point) => point.id), ["e3"]);
});
