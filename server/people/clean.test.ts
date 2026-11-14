import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarUrl, cleanName, cleanTags, cleanWorkspace, nextColour, numberedName, PALETTE } from "./clean.ts";

// Rules 2 to 5 of the README, each as a pure function.

test("a name is trimmed, capped at 40 and never empty", () => {
	assert.equal(cleanName("  Sable "), "Sable");
	assert.equal(cleanName("x".repeat(50)).length, 40);
	assert.throws(() => cleanName("   "), /cannot be empty/);
});

test("a left-out name is the first free number", () => {
	const taken = new Set(["agent 1", "agent 3"]);
	assert.equal(numberedName("Agent", (n) => taken.has(n.toLowerCase())), "Agent 2");
});

test("tags are slugged, deduped, emptied and capped at four", () => {
	assert.deepEqual(cleanTags(["Panel CSS", "panel-css", "!!!", "a", "b", "c", "d"]), ["panel-css", "a", "b", "c"]);
	assert.deepEqual(cleanTags(["水墨 花卉"]), ["水墨-花卉"]);
	assert.equal(cleanTags(["reading-panel-css-and-more-words"])[0], "reading-panel-css-and");
});

test("a workspace is one slug, and nothing means none", () => {
	assert.equal(cleanWorkspace("Political LLM"), "political-llm");
	assert.equal(cleanWorkspace("   "), undefined);
	assert.equal(cleanWorkspace(null), undefined);
});

test("an avatar is an emoji or an SVG with xmlns and a viewBox", () => {
	assert.match(avatarUrl({ emoji: "🦊" }), /^data:image\/svg\+xml;base64,/);
	const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';
	assert.match(avatarUrl({ svg: ok }), /^data:/);
	assert.throws(() => avatarUrl({ svg: '<svg viewBox="0 0 8 8"></svg>' }), /xmlns/);
	assert.throws(() => avatarUrl({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }), /viewBox/);
	assert.throws(() => avatarUrl({ svg: ok.replace("<rect", '<rect onload="x()"') }), /scripts/);
});

test("a colour is the palette's least worn", () => {
	assert.equal(nextColour([]), PALETTE[0]);
	assert.equal(nextColour([PALETTE[0]]), PALETTE[1]);
	assert.equal(nextColour([...PALETTE]), PALETTE[0]);
});
