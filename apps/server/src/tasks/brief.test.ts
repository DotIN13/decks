import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatcherBrief } from "./brief.ts";

test("the brief carries the work, where to look, and the one call to make", () => {
	const text = dispatcherBrief({ id: "t1", text: "Remeasure the panel widths", boards: ["boards/plan.html"], workspace: "decks" });
	assert.match(text, /> Remeasure the panel widths/);
	assert.match(text, /\*\*decks\*\* workspace/);
	assert.match(text, /`boards\/plan.html`/);
	assert.match(text, /await stage\.agents\(\)/);
	assert.match(text, /stage\.canvases\(\)/);
	assert.match(text, /stage\.queue\(agentId\)/);
	assert.match(text, /stage\.d\.ts/);
	assert.match(text, /stage\.send\("<agent name or id>", \{ task: .*reply: false \}\)/);
	assert.match(text, /Task id, for the record: `t1`/);
	// The person wrote to a dispatcher; the agent doing the work is not told to dispatch.
	assert.match(text, /remove all of that from the message or the prompt file when you hand off/);
	// And the stop rule agrees: the prompt file is the one thing a dispatcher may write.
	assert.match(text, /The one thing you may write is the prompt file/);
	assert.doesNotMatch(text, /do not write anything/);
	// Nobody on the topic: make an agent and send to it, on a cost-effective model.
	assert.match(text, /make one by sending to a shape, `await stage\.send\(\{ name, kind \}, \{ task \}\)`/);
	// No model is named in the text: the dashboard's own choice is the default.
	assert.match(text, /Leave `model` out, so it opens on the model chosen in the dashboard's bar/);
	assert.doesNotMatch(text, /DeepSeek|Opus/);
	assert.match(text, /particularly hard/);
	// Something recurring is a schedule, not a send.
	assert.match(text, /make a schedule with `await stage\.schedule\(\)` and send it to nobody/);
	// The call's shape is in `stage.d.ts`, not repeated here, and there is no digest kind.
	assert.doesNotMatch(text, /kind:/);
	// The fork comes before the numbered steps, so "stop" after a schedule is not followed by a step 3.
	assert.ok(text.indexOf("**A. Something recurring**") < text.indexOf("**B. Anything else:**"));
	assert.ok(text.indexOf("**B. Anything else:**") < text.indexOf("1. Use `await stage.agents()`"));
	// And the brief says, once, that it overrides the deck's board rules for this turn.
	assert.match(text, /you write no board, set no name, tags or workspace/);
	// No roster is baked in: the agent looks it up live.
	assert.doesNotMatch(text, /Who is on the deck/);
});

test("a task a cron job started says so, by the job's name", () => {
	const text = dispatcherBrief({ id: "t5", text: "Write the morning digest.", boards: [], workspace: "decks", schedule: "Morning digest" });
	assert.match(text, /The cron job `Morning digest` started this task in the \*\*decks\*\* workspace\./);
	assert.doesNotMatch(text, /The person asked for it/);
});

test("a task a cron job started is never offered a schedule: its recurring words are the cron's own text", () => {
	// The schedule's task text usually says "each morning" — that is the cron talking,
	// not a request for a new cron. Offering branch A here is how a cron re-enlists
	// itself through the dispatcher, every firing.
	const text = dispatcherBrief({ id: "t8", text: "Each morning, find the notable new AI papers and write one board per paper.", boards: [], workspace: "decks", schedule: "Morning AI papers" });
	assert.doesNotMatch(text, /\*\*A\. Something recurring\*\*/);
	assert.doesNotMatch(text, /\*\*B\. Anything else:\*\*/);
	assert.doesNotMatch(text, /make a schedule with `await stage\.schedule\(\)`/);
	assert.match(text, /one firing of the cron job `Morning AI papers`/);
	assert.match(text, /do not call `stage\.schedule`/);
	// The hand-over steps are still all there.
	assert.match(text, /1\. Use `await stage\.agents\(\)`/);
	assert.match(text, /3\. Hand over the work using `reply: false`/);
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

test("the brief says what time it is where the person is, when it is told", () => {
	const text = dispatcherBrief({ id: "t6", text: "Every weekday at nine, check the inbox.", boards: [], now: "Friday 18 September 2026, 12:19 (America/Los_Angeles, UTC−7)" });
	assert.match(text, /It is now Friday 18 September 2026, 12:19 \(America\/Los_Angeles, UTC−7\)\./);
	assert.match(text, /unless you pass `timezone`/);
	assert.doesNotMatch(dispatcherBrief({ id: "t7", text: "x", boards: [] }), /It is now/);
});

test("a task asked for on a canvas says which, and that whoever takes it works there", () => {
	const text = dispatcherBrief({ id: "t2", text: "Redraw the cost chart", boards: [], canvasName: "Political LLM" });
	assert.match(text, /on the \*\*Political LLM\*\* canvas/);
	assert.match(text, /Prefer an agent already working there/);
	assert.match(text, /will work on that canvas/);
	const plain = dispatcherBrief({ id: "t3", text: "Redraw the cost chart", boards: [] });
	assert.doesNotMatch(plain, /canvas\*\*/, "no canvas, no sentence about one");
});
