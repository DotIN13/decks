import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatcherBrief } from "./brief.ts";

test("the brief carries the work, where to look, and the one call to make", () => {
	const text = dispatcherBrief({ id: "t1", text: "Remeasure the panel widths", boards: ["boards/plan.html"], workspace: "decks" });
	assert.match(text, /> Remeasure the panel widths/);
	assert.match(text, /\*\*decks\*\* workspace/);
	assert.match(text, /`boards\/plan.html`/);
	assert.match(text, /await stage\.agents\(\)/);
	assert.match(text, /stage\.workspaces\(\)/);
	assert.match(text, /stage\.queue\(agentId\)/);
	assert.match(text, /stage\.d\.ts/);
	assert.match(text, /stage\.send\("<agent name or id>", \{ task: .*reply: false \}\)/);
	assert.match(text, /Task id, for the record: `t1`/);
	// The person wrote to a dispatcher; the agent doing the work is not told to dispatch.
	assert.match(text, /leave all of that out and say what is to be done/);
	// Nobody on the topic: make an agent and send to it, on a cost-effective model.
	assert.match(text, /await stage\.create\(\{ name:/);
	assert.match(text, /DeepSeek V4\.1 or Claude Opus/);
	assert.match(text, /particularly hard/);
	// Something recurring is a schedule, not a send.
	assert.match(text, /await stage\.schedule\(\{ name:/);
	assert.match(text, /0 Sunday to 6 Saturday/);
	// No roster is baked in: the agent looks it up live.
	assert.doesNotMatch(text, /Who is on the deck/);
});

test("a task with no workspace or boards has no scope line", () => {
	const text = dispatcherBrief({ id: "t2", text: "Anything", boards: [] });
	assert.doesNotMatch(text, /workspace \*\*/);
	assert.doesNotMatch(text, /names these boards/);
});

test("a short message is quoted, and its file named beside it", () => {
	const text = dispatcherBrief({ id: "t3", text: "Fix the typo on the plan board", boards: [], promptPath: "/deck/.decks/tasks/t3.md" });
	assert.match(text, /> Fix the typo on the plan board/);
	assert.match(text, /It is also saved at `\/deck\/\.decks\/tasks\/t3\.md`/);
	assert.match(text, /in the person's own words but addressed to the agent doing it/);
	assert.match(text, /every word about dispatching or choosing an agent left out/);
});

test("a long message is pointed at, not quoted, and the hand-over names the file", () => {
	const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a pasted page of notes about the survey.`).join("\n");
	const text = dispatcherBrief({ id: "t4", text: long, boards: [], promptPath: "/deck/.decks/tasks/t4.md" });
	assert.match(text, /message is long, so it is saved as a file: `\/deck\/\.decks\/tasks\/t4\.md`/);
	assert.match(text, /> Line 1 of a pasted page of notes/);
	assert.doesNotMatch(text, /Line 30 of a pasted/);
	assert.match(text, /task: "Read \/deck\/\.decks\/tasks\/t4\.md\. It is the person's message, and the work in it is:/);
	assert.match(text, /you are the agent it went to/);
});

test("a long message with no file falls back to quoting it", () => {
	const long = "x".repeat(700);
	const text = dispatcherBrief({ id: "t5", text: long, boards: [] });
	assert.match(text, new RegExp(`> ${"x".repeat(700)}`));
});
