import assert from "node:assert/strict";
import { test } from "node:test";
import { destination, destinationLabel, stripMention, type BarContext } from "./send-from-bar.ts";

const agents = [
	{ id: "a1", name: "Ada" },
	{ id: "a2", name: "Ada-D" },
	{ id: "s1", name: "Sable" },
	{ id: "u1", name: "under_score9" },
];

const stage: BarContext = { agents, focused: { id: "s1", name: "Sable" } };
const nobody: BarContext = { agents };

test("a note target wins over everything, even a mention", () => {
	const context: BarContext = { ...stage, note: { board: "boards/risk-model.html", component: "c3" } };
	assert.deepEqual(destination("@Ada look", context), { kind: "note", board: "boards/risk-model.html", component: "c3" });
});

test("a mention picks the agent by name, case-insensitively, and marks it named", () => {
	assert.deepEqual(destination("@sable fix the test", nobody), { kind: "prompt", id: "s1", name: "Sable", named: true });
	assert.deepEqual(destination("please @ADA", stage), { kind: "prompt", id: "a1", name: "Ada", named: true });
	assert.deepEqual(destination("ask @under_score9.", nobody), {
		kind: "prompt",
		id: "u1",
		name: "under_score9",
		named: true,
	});
});

test("the longest name wins when one is a prefix of another", () => {
	assert.deepEqual(destination("@Ada-D go", nobody), { kind: "prompt", id: "a2", name: "Ada-D", named: true });
	assert.deepEqual(destination("@Ada-D", nobody), { kind: "prompt", id: "a2", name: "Ada-D", named: true });
	assert.deepEqual(destination("@Ada, go", nobody), { kind: "prompt", id: "a1", name: "Ada", named: true });
	// Ada followed by a hyphen and more name characters is neither Ada nor Ada-D.
	assert.deepEqual(destination("@Ada-Dx go", nobody), { kind: "nowhere" });
	assert.deepEqual(destination("@Adam go", nobody), { kind: "nowhere" });
});

test("the first mention in the text is the one that counts", () => {
	assert.deepEqual(destination("@Sable then @Ada", nobody), { kind: "prompt", id: "s1", name: "Sable", named: true });
	assert.deepEqual(destination("@nobody then @Ada", nobody), { kind: "prompt", id: "a1", name: "Ada", named: true });
});

test("an @ inside a word, as in an email address, is not a mention", () => {
	assert.deepEqual(destination("mail me@Ada.com", nobody), { kind: "nowhere" });
	assert.deepEqual(destination("(@Ada)", nobody), { kind: "prompt", id: "a1", name: "Ada", named: true });
});

test("without a mention, the line goes to the focused agent, unnamed", () => {
	assert.deepEqual(destination("build the board", stage), { kind: "prompt", id: "s1", name: "Sable", named: false });
	assert.deepEqual(destination("@unknown hi", stage), { kind: "prompt", id: "s1", name: "Sable", named: false });
});

test("with no focused agent there is nowhere to go, unless the line names one", () => {
	assert.deepEqual(destination("hello", nobody), { kind: "nowhere" });
	assert.deepEqual(destination("@Ada hello", nobody), { kind: "prompt", id: "a1", name: "Ada", named: true });
});

test("labels", () => {
	assert.equal(destinationLabel({ kind: "note", board: "boards/risk-model.html", component: "c1" }), "note on risk-model");
	assert.equal(destinationLabel({ kind: "note", board: "risk-model", component: "c1" }), "note on risk-model");
	assert.equal(destinationLabel({ kind: "prompt", id: "s1", name: "Sable", named: true }), "to Sable");
	assert.equal(destinationLabel({ kind: "nowhere" }), "no agent");
});

test("stripMention removes the token and tidies the whitespace around it", () => {
	assert.equal(stripMention("@Ada fix this", "Ada"), "fix this");
	assert.equal(stripMention("fix @ada this", "Ada"), "fix this");
	assert.equal(stripMention("fix this @Ada", "Ada"), "fix this");
	assert.equal(stripMention("hi @Ada, do it", "Ada"), "hi, do it");
	assert.equal(stripMention("@Ada-D go", "Ada-D"), "go");
	assert.equal(stripMention("@Ada-D go", "Ada"), "@Ada-D go");
	assert.equal(stripMention("no mention here", "Ada"), "no mention here");
	assert.equal(stripMention("@Ada and @Ada again", "Ada"), "and @Ada again");
});
