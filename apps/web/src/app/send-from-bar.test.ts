import assert from "node:assert/strict";
import { test } from "node:test";
import { destination, destinationLabel, DISPATCHER_NAME, stripMention, type BarContext } from "./send-from-bar.ts";

const agents = [
	{ id: "a1", name: "Ada" },
	{ id: "a2", name: "Ada-D" },
	{ id: "s1", name: "Sable" },
	{ id: "u1", name: "under_score9" },
];

const dispatch: BarContext = { surface: "dispatch", agents };
const stage: BarContext = { surface: "stage", agents, focused: { id: "s1", name: "Sable" } };

test("a note target wins over everything, even a mention", () => {
	const context: BarContext = { ...stage, note: { board: "boards/risk-model.html", component: "c3" } };
	assert.deepEqual(destination("@Ada look", context), { kind: "note", board: "boards/risk-model.html", component: "c3" });
});

test("a mention picks the agent by name, case-insensitively, and marks it named", () => {
	assert.deepEqual(destination("@sable fix the test", dispatch), { kind: "prompt", id: "s1", name: "Sable", named: true });
	assert.deepEqual(destination("please @ADA", stage), { kind: "prompt", id: "a1", name: "Ada", named: true });
	assert.deepEqual(destination("ask @under_score9.", dispatch), {
		kind: "prompt",
		id: "u1",
		name: "under_score9",
		named: true,
	});
});

test("the longest name wins when one is a prefix of another", () => {
	assert.deepEqual(destination("@Ada-D go", dispatch), { kind: "prompt", id: "a2", name: "Ada-D", named: true });
	assert.deepEqual(destination("@Ada-D", dispatch), { kind: "prompt", id: "a2", name: "Ada-D", named: true });
	assert.deepEqual(destination("@Ada, go", dispatch), { kind: "prompt", id: "a1", name: "Ada", named: true });
	// Ada followed by a hyphen and more name characters is neither Ada nor Ada-D.
	assert.deepEqual(destination("@Ada-Dx go", dispatch), { kind: "task" });
	assert.deepEqual(destination("@Adam go", dispatch), { kind: "task" });
});

test("the first mention in the text is the one that counts", () => {
	assert.deepEqual(destination("@Sable then @Ada", dispatch), { kind: "prompt", id: "s1", name: "Sable", named: true });
	assert.deepEqual(destination("@nobody then @Ada", dispatch), { kind: "prompt", id: "a1", name: "Ada", named: true });
});

test("an @ inside a word, as in an email address, is not a mention", () => {
	assert.deepEqual(destination("mail me@Ada.com", dispatch), { kind: "task" });
	assert.deepEqual(destination("(@Ada)", dispatch), { kind: "prompt", id: "a1", name: "Ada", named: true });
});

test("without a mention, the dispatch surface goes to the dispatcher", () => {
	assert.deepEqual(destination("build the board", dispatch), { kind: "task" });
	assert.deepEqual(destination("", dispatch), { kind: "task" });
	assert.deepEqual(destination("@unknown hi", dispatch), { kind: "task" });
});

test("without a mention, a stage goes to the focused agent, unnamed", () => {
	assert.deepEqual(destination("build the board", stage), { kind: "prompt", id: "s1", name: "Sable", named: false });
});

test("@Dispatcher reaches the dispatcher from any bar, and an agent of that name keeps it", () => {
	assert.deepEqual(destination("@Dispatcher find someone for this", stage), { kind: "task", named: true });
	assert.deepEqual(destination("hand this to @dispatcher, please", stage), { kind: "task", named: true });
	assert.deepEqual(destination("@Dispatcher do it", { surface: "stage", agents }), { kind: "task", named: true });
	assert.deepEqual(destination("@Dispatcher do it", dispatch), { kind: "task", named: true });
	assert.deepEqual(destination("@Sable ask @Dispatcher", stage), { kind: "prompt", id: "s1", name: "Sable", named: true });
	assert.deepEqual(destination("@Dispatchers do it", stage), { kind: "prompt", id: "s1", name: "Sable", named: false });
	const taken: BarContext = { ...stage, agents: [...agents, { id: "d1", name: "Dispatcher" }] };
	assert.deepEqual(destination("@Dispatcher hi", taken), { kind: "prompt", id: "d1", name: "Dispatcher", named: true });
	assert.equal(stripMention("@dispatcher find someone", DISPATCHER_NAME), "find someone");
	assert.equal(destinationLabel({ kind: "task", named: true }), "to dispatcher");
});

test("a stage with no focused agent has nowhere to go", () => {
	assert.deepEqual(destination("hello", { surface: "stage", agents }), { kind: "nowhere" });
	assert.deepEqual(destination("@Ada hello", { surface: "stage", agents }), {
		kind: "prompt",
		id: "a1",
		name: "Ada",
		named: true,
	});
});

test("labels", () => {
	assert.equal(destinationLabel({ kind: "note", board: "boards/risk-model.html", component: "c1" }), "note on risk-model");
	assert.equal(destinationLabel({ kind: "note", board: "risk-model", component: "c1" }), "note on risk-model");
	assert.equal(destinationLabel({ kind: "prompt", id: "s1", name: "Sable", named: true }), "to Sable");
	assert.equal(destinationLabel({ kind: "task" }), "to dispatcher");
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
