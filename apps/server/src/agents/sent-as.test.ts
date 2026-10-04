import assert from "node:assert/strict";
import test from "node:test";
import { sentAs } from "./sent-as.ts";

test("a message sent as typed is paired", () => {
	assert.equal(sentAs("Add a sticky", "Add a sticky"), true);
});
test("a message with something appended is paired", () => {
	assert.equal(sentAs([{ type: "text", text: "Add a sticky\n\n[context]" }], "Add a sticky"), true);
});
test("a message sent after a reminder is paired", () => {
	assert.equal(sentAs("[Decks] Say who you are.\n\nAdd a sticky", "Add a sticky"), true);
});
test("a different message is not", () => {
	assert.equal(sentAs("[Decks] Say who you are.\n\nRemove the sticky", "Add a sticky"), false);
});
