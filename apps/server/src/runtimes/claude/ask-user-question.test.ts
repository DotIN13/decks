import assert from "node:assert/strict";
import { test } from "node:test";
import { answerQuestions, type ChooseRequest } from "./ask-user-question.ts";

/**
 * The rules about a question, which is the part with no CLI in it.
 *
 * The behaviour these pin is the difference between a tool that works and the one Decks
 * shipped: a permission prompt in front of a question, answered yes, followed by nothing at
 * all — because allowing the call is not answering it, and the answers have to go back on
 * `updatedInput` for the CLI's own implementation to return them.
 */

/** A `choose` that records what it was shown and answers by a script. */
function picker(script: (string | undefined)[]) {
	const shown: ChooseRequest[] = [];
	let next = 0;
	return {
		shown,
		choose: async (request: ChooseRequest) => {
			shown.push(request);
			return script[next++];
		},
	};
}

const one = {
	questions: [
		{
			question: "Which library should we use?",
			header: "Library",
			options: [
				{ label: "date-fns", description: "Small, tree-shakeable." },
				{ label: "Luxon", description: "Bigger, with time zones." },
			],
		},
	],
};

test("the answer goes back on the input, keyed by the question", async () => {
	const { shown, choose } = picker(["Luxon"]);
	const decision = await answerQuestions(one, choose);

	assert.equal(shown.length, 1);
	assert.deepEqual(shown[0], {
		title: "Which library should we use?",
		message: "Library",
		options: [
			{ label: "date-fns", description: "Small, tree-shakeable." },
			{ label: "Luxon", description: "Bigger, with time zones." },
		],
		other: true,
	});
	assert.equal(decision.behavior, "allow");
	assert.deepEqual(decision.behavior === "allow" && decision.updatedInput.answers, { "Which library should we use?": "Luxon" });
});

test("the rest of the input is carried through untouched", async () => {
	const { choose } = picker(["date-fns"]);
	const decision = await answerQuestions({ ...one, metadata: { source: "remember" } }, choose);
	assert.equal(decision.behavior === "allow" && (decision.updatedInput.metadata as { source: string }).source, "remember");
});

/*
 * Four questions are four dialogs, in order, because the deck has one place to put one —
 * above the input bar, where the hands are — and four at once there is a form.
 */
test("several questions are asked one at a time, and answered together", async () => {
	const { shown, choose } = picker(["Yes", "Later"]);
	const decision = await answerQuestions(
		{
			questions: [
				{ question: "Ship it?", options: [{ label: "Yes", description: "Now." }, { label: "No", description: "Not now." }] },
				{ question: "When?", options: [{ label: "Now", description: "Immediately." }, { label: "Later", description: "After review." }] },
			],
		},
		choose,
	);
	assert.deepEqual(
		shown.map((request) => request.title),
		["Ship it?", "When?"],
	);
	assert.deepEqual(decision.behavior === "allow" && decision.updatedInput.answers, { "Ship it?": "Yes", "When?": "Later" });
});

/*
 * Closing the card denies the whole call.
 *
 * Allowing it with the answers collected so far would tell the model the unanswered
 * questions had no answer, which is a different statement from "the user did not want to
 * answer" — and the model acts on the difference.
 */
test("abandoning a question denies the call rather than half-answering it", async () => {
	const { choose } = picker(["Yes", undefined]);
	const decision = await answerQuestions(
		{
			questions: [
				{ question: "Ship it?", options: [{ label: "Yes", description: "Now." }, { label: "No", description: "Not now." }] },
				{ question: "When?", options: [{ label: "Now", description: "a" }, { label: "Later", description: "b" }] },
			],
		},
		choose,
	);
	assert.equal(decision.behavior, "deny");
});

test("a multi-select says so, so the dialog can wait for more than one", async () => {
	const { shown, choose } = picker(["a, b"]);
	await answerQuestions(
		{ questions: [{ question: "Which features?", multiSelect: true, options: [{ label: "a" }, { label: "b" }] }] },
		choose,
	);
	assert.equal(shown[0]?.multiple, true);
	assert.equal(shown[1], undefined);
});

test("every question offers a way out, because the tool promises one and does not carry it", async () => {
	const { shown, choose } = picker(["date-fns"]);
	await answerQuestions(one, choose);
	assert.equal(shown[0]?.other, true);
});

/*
 * A malformed call is allowed with no answers, not denied.
 *
 * Bad arguments are the model's mistake and the tool's result is where it should learn
 * about them. Denying would tell it the *user* refused, which is the one conclusion it must
 * not draw from a missing field.
 */
test("a call with nothing askable in it is allowed, unanswered", async () => {
	for (const input of [
		{},
		{ questions: [] },
		{ questions: "not a list" },
		{ questions: [{ header: "no question text", options: [{ label: "a" }, { label: "b" }] }] },
		{ questions: [{ question: "one option is not a choice", options: [{ label: "only" }] }] },
		{ questions: [{ question: "options with no labels", options: [{ description: "x" }, { description: "y" }] }] },
	]) {
		const { shown, choose } = picker([]);
		const decision = await answerQuestions(input as Record<string, unknown>, choose);
		assert.equal(decision.behavior, "allow", JSON.stringify(input));
		assert.equal(shown.length, 0, `nothing should be shown for ${JSON.stringify(input)}`);
		assert.equal(decision.behavior === "allow" && decision.updatedInput.answers, undefined);
	}
});

test("one bad question among good ones is dropped, not fatal", async () => {
	const { shown, choose } = picker(["Yes"]);
	const decision = await answerQuestions(
		{
			questions: [
				{ question: "", options: [{ label: "a" }, { label: "b" }] },
				{ question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] },
			],
		},
		choose,
	);
	assert.deepEqual(
		shown.map((request) => request.title),
		["Ship it?"],
	);
	assert.deepEqual(decision.behavior === "allow" && decision.updatedInput.answers, { "Ship it?": "Yes" });
});
