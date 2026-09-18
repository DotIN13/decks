import assert from "node:assert/strict";
import { test } from "node:test";
import { commentLabel, draftComments, draftForAgent, draftIsEmpty, draftLabel, draftText, normalize, parseDraft, serializeDraft, textDraft, type Draft } from "./draft.ts";

const pill = (id: string, label = "“Keep it short.”") => ({ type: "mention" as const, kind: "comment" as const, id, label });

test("equal drafts compare equal: text merged, empties dropped", () => {
	assert.deepEqual(normalize([{ type: "text", text: "a" }, { type: "text", text: "" }, { type: "text", text: "b" }, pill("c1")]), [{ type: "text", text: "ab" }, pill("c1")]);
	assert.deepEqual(textDraft(""), []);
});

test("a comment pill shows the words with no @, and reads as nothing in the text", () => {
	const draft: Draft = [{ type: "text", text: "See " }, pill("c1"), { type: "text", text: " and fit." }];
	assert.equal(draftLabel(pill("c1")), "“Keep it short.”");
	assert.equal(draftText(draft), "See  and fit.");
	assert.deepEqual(draftComments(draft), ["c1"]);
});

test("a comment alone is a message; spaces alone are not", () => {
	assert.equal(draftIsEmpty([{ type: "text", text: "  \n" }]), true);
	assert.equal(draftIsEmpty([pill("c1")]), false);
});

test("a label is the start of the quotation, short enough for a sentence", () => {
	assert.equal(commentLabel("Keep  it\nshort."), "“Keep it short.”");
	const long = commentLabel("Deeper than the scale you are picturing, by a long way");
	assert.ok(long.length <= 30 && long.endsWith("…”"), long);
});

test("the clipboard round trip keeps pills, and refuses what it does not know", () => {
	const draft: Draft = [{ type: "text", text: "a" }, pill("c1")];
	assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
	assert.equal(parseDraft("{}"), null);
	assert.equal(parseDraft(JSON.stringify([{ type: "mention", kind: "file", id: "x", label: "y" }])), null);
	assert.equal(parseDraft("not json"), null);
});

test("in the sent words a pill stands as [comment n], and pills alone send no words", () => {
	const draft: Draft = [{ type: "text", text: "Look at " }, pill("c1"), { type: "text", text: " and then " }, pill("c2"), { type: "text", text: " " }];
	assert.equal(draftForAgent(draft), "Look at [comment 1] and then [comment 2]");
	assert.equal(draftForAgent([pill("c1"), { type: "text", text: " " }]), "");
	assert.equal(draftForAgent([{ type: "text", text: " plain " }]), "plain");
});
