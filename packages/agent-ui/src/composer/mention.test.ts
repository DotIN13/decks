import assert from "node:assert/strict";
import { test } from "node:test";
import { withMention } from "./mention.ts";

test("into an empty field, with a space after so the next word does not join it", () => {
	assert.deepEqual(withMention("", 0, "@assets/a.png"), { text: "@assets/a.png ", caret: 14 });
});

test("after a word, with a space before it", () => {
	assert.deepEqual(withMention("see", 3, "@a"), { text: "see @a ", caret: 7 });
	assert.deepEqual(withMention("see ", 4, "@a"), { text: "see @a ", caret: 7 });
});

test("between two words, without doubling the space that is already there", () => {
	assert.deepEqual(withMention("see  that", 4, "@a"), { text: "see @a that", caret: 6 });
	assert.deepEqual(withMention("seethat", 3, "@a"), { text: "see @a that", caret: 7 });
});

test("a caret past the end is the end", () => {
	assert.deepEqual(withMention("hi", 99, "@a"), { text: "hi @a ", caret: 6 });
});
