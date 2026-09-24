import assert from "node:assert/strict";
import { test } from "node:test";
import { commentLabel, draftComments, draftForAgent, draftIsEmpty, draftLabel, draftText, LABEL_LIMIT, normalize, parseDraft, serializeDraft, shortLabel, textDraft, type Draft } from "./draft.ts";

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

/**
 * A board and a drawn item dragged onto the bar. They are pills for the same reason a comment
 * is — the thing is carried inside, not read back off a label — but unlike a comment they have
 * an address the agent can use, so that is what they read as.
 */
const BOARD = { type: "mention", kind: "board", id: "boards/plan.html", label: "The plan" } as const;
const ITEM = { type: "mention", kind: "item", id: "plan-note", label: "Check the margin" } as const;

test("a board and an item read as their address, where a comment reads as a number", () => {
	assert.equal(draftText([BOARD, ITEM]), "", "no pill puts words into the typed text");
	assert.equal(draftForAgent([{ type: "text", text: "look at " }, BOARD, { type: "text", text: " and " }, ITEM]), "look at @boards/plan.html and @item:plan-note");
	// Alone, they are the whole message; comments alone still send no words, because each is
	// composed into a block of its own.
	assert.equal(draftForAgent([BOARD]), "@boards/plan.html");
	assert.equal(draftForAgent([ITEM]), "@item:plan-note");
});

test("only comment pills are comments, and any pill is a message", () => {
	const mixed: Draft = [BOARD, { type: "mention", kind: "comment", id: "c1", label: "“a”" }, ITEM];
	assert.deepEqual(draftComments(mixed), ["c1"], "a board is not a comment to attach");
	assert.equal(draftIsEmpty([BOARD]), false);
	assert.equal(draftIsEmpty([ITEM]), false);
	assert.equal(draftIsEmpty([{ type: "text", text: "  " }]), true);
});

test("the clipboard round trip keeps all three kinds", () => {
	const draft: Draft = [BOARD, { type: "text", text: " and " }, ITEM];
	assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
	assert.equal(parseDraft(JSON.stringify([{ type: "mention", kind: "agent", id: "a1", label: "Ada" }])), null);
});

test("a label is cut to fit a sentence, whatever it is a label for", () => {
	assert.equal(shortLabel("  a note   with  spaces "), "a note with spaces");
	assert.equal(shortLabel("x".repeat(40)).length, LABEL_LIMIT);
	assert.ok(shortLabel("x".repeat(40)).endsWith("…"));
});
