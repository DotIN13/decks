import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTags, MAX_TAG_LENGTH, MAX_TAGS, sameTags, slugTag } from "./tags.ts";

/*
 * Every case here is something an agent will actually send. A model told "tag yourself" sends
 * a sentence, or Title Case, or the same tag twice under two spellings, or six of them — and
 * each of those has to become something a 264px row can draw without the row measuring
 * anything or the server refusing the call.
 */

test("a tag is lowercased and hyphenated", () => {
	assert.equal(slugTag("Panel CSS"), "panel-css");
	assert.equal(slugTag("panel-css"), "panel-css");
	assert.equal(slugTag("  Measuring   the  rows "), "measuring-the-rows");
	assert.equal(slugTag("e2e"), "e2e");
});

test("…so two spellings of one thing are one tag", () => {
	// This is the whole reason slugging exists: "who else is on this" needs the two to match.
	assert.equal(slugTag("Panel CSS"), slugTag("panel css"));
	assert.equal(slugTag("flaky_editing"), slugTag("Flaky Editing"));
});

test("punctuation collapses; letters and digits survive, in any script", () => {
	assert.equal(slugTag("re: the panel (again!)"), "re-the-panel-again");
	assert.equal(slugTag("v2.1"), "v2-1");
	assert.equal(slugTag("水墨花卉"), "水墨花卉", "an agent working on this should be able to say so");
	assert.equal(slugTag("--- ---"), "", "nothing but punctuation is not a tag");
});

test("a long tag is cut and does not keep a trailing hyphen", () => {
	const long = slugTag("a very long description of what this agent is currently doing");
	assert.equal(long.length <= MAX_TAG_LENGTH, true, long);
	assert.ok(!long.endsWith("-"), long);
	// The cut lands inside a word here, which is fine; what matters is it is not a dangling
	// hyphen where a space used to be.
	assert.equal(slugTag("measuring the rows and the"), "measuring-the-rows-and");
});

test("a sentence becomes a tag rather than being refused", () => {
	// A model told to tag itself will do this. Silently refusing would leave the row empty.
	assert.deepEqual(cleanTags(["Reading panel.css and measuring the rows"]), ["reading-panel-css-and"]);
});

test("four at most, extras dropped rather than the call failing", () => {
	assert.deepEqual(cleanTags(["a", "b", "c", "d", "e", "f"]), ["a", "b", "c", "d"]);
	assert.equal(MAX_TAGS, 4);
});

test("…and the ones kept are the first, which is the agent's own priority", () => {
	assert.deepEqual(cleanTags(["panel-css", "measuring", "e2e", "notes", "later"]).at(0), "panel-css");
});

test("duplicates go, keeping the first position", () => {
	assert.deepEqual(cleanTags(["panel-css", "Panel CSS", "measuring", "panel css"]), ["panel-css", "measuring"]);
});

test("empties and non-strings are dropped, not drawn", () => {
	assert.deepEqual(cleanTags(["", "  ", "!!!", "real"]), ["real"]);
	assert.deepEqual(cleanTags(["ok", 7, null, undefined, {}, ["nested"]]), ["ok"]);
});

test("clearing is a real operation, and nonsense is the same as clearing", () => {
	assert.deepEqual(cleanTags([]), []);
	assert.deepEqual(cleanTags(undefined), []);
	assert.deepEqual(cleanTags("panel-css"), [], "a bare string is not a list");
	assert.deepEqual(cleanTags(null), []);
});

test("the same list twice is not a change, so nothing goes on the wire", () => {
	// An agent that re-sets its tags every turn would otherwise broadcast an identity per
	// turn and every browser would re-render its panel for a fact that did not move.
	assert.ok(sameTags(["a", "b"], ["a", "b"]));
	assert.ok(sameTags(undefined, []));
	assert.ok(!sameTags(["a", "b"], ["b", "a"]), "order is part of the value");
	assert.ok(!sameTags(["a"], ["a", "b"]));
	assert.ok(!sameTags(["a"], undefined));
});
