import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Identity, Task } from "@decks/protocol";
import {
	agoLabel,
	daysLabel,
	fileName,
	holderNames,
	isNews,
	schedulePaused,
	stateWord,
	wantsYou,
	whyRefused,
} from "./dispatch-view.ts";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function board(path: string, over: Partial<Board> = {}): Board {
	return { path, title: fileName(path), format: "board", x: 0, y: 0, w: 800, h: 600, rev: 1, inContext: [], ...over };
}

let n = 0;
function task(state: Task["state"], over: Partial<Task> = {}): Task {
	n += 1;
	return {
		id: `t${n}`,
		text: `task ${n}`,
		boards: [],
		dispatch: { at: NOW - n * 1000, outcome: "agent", agentId: "a1", agentName: "Ada", why: "the only agent in the workspace" },
		state,
		createdAt: NOW - n * 1000,
		updatedAt: NOW - n * 1000,
		agentId: "a1",
		agentName: "Ada",
		...over,
	};
}

const identities: Record<string, Identity> = {
	a1: { name: "Ada", color: "#000", workspace: "alpha" },
	b1: { name: "Bo", color: "#000", workspace: "beta" },
	loose: { name: "Loose", color: "#000" },
};

test("stateWord folds seven states into five words", () => {
	assert.equal(stateWord({ state: "open" }), "queued");
	assert.equal(stateWord({ state: "assigned" }), "queued");
	assert.equal(stateWord({ state: "running" }), "running");
	assert.equal(stateWord({ state: "done" }), "done");
	assert.equal(stateWord({ state: "blocked" }), "refused");
	assert.equal(stateWord({ state: "failed" }), "refused");
	assert.equal(stateWord({ state: "cancelled" }), "cancelled");
});

test("whyRefused prefers the rule's reason, falls back to the dispatch, and is silent otherwise", () => {
	assert.equal(whyRefused(task("blocked", { reason: "nobody in beta" })), "nobody in beta");
	assert.equal(whyRefused(task("failed")), "the only agent in the workspace");
	assert.equal(whyRefused(task("running", { reason: "stale" })), undefined);
});

test("wantsYou counts blocked and failed only", () => {
	assert.equal(wantsYou([task("blocked"), task("failed"), task("running"), task("done")]), 2);
	assert.equal(wantsYou([]), 0);
});

test("fileName drops the folder and the extension", () => {
	assert.equal(fileName("boards/plan.html"), "plan");
	assert.equal(fileName("boards/deep/plan.slides.html"), "deep/plan.slides");
	assert.equal(fileName("notes.md"), "notes.md");
});

test("daysLabel says every day, weekdays, the names, or paused — without sorting the caller's array", () => {
	const days = [3, 1];
	assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), "every day");
	assert.equal(daysLabel([5, 4, 3, 2, 1]), "weekdays");
	assert.equal(daysLabel(days), "Mon Wed");
	assert.deepEqual(days, [3, 1]);
	assert.equal(daysLabel([]), "paused");
});

test("schedulePaused is off or dayless", () => {
	assert.equal(schedulePaused({ enabled: true, days: [1] }), false);
	assert.equal(schedulePaused({ enabled: false, days: [1] }), true);
	assert.equal(schedulePaused({ enabled: true, days: [] }), true);
});

test("holderNames names the agents holding a path", () => {
	assert.deepEqual(holderNames("boards/x.html", identities, { a1: ["boards/x.html"], b1: [], ghost: ["boards/x.html"] }), ["Ada", "ghost"]);
});

test("a board is news until the person reads it, and again once it is named after that", () => {
	const written = board("boards/plan.html", { modifiedAt: NOW - HOUR });
	assert.equal(isNews(written, NOW), true);
	assert.equal(isNews({ ...written, seenAt: NOW - HOUR }, NOW), false, "read at the moment it was written");
	assert.equal(isNews({ ...written, seenAt: NOW - 10 * 60 * 1000 }, NOW), false, "read since");
	assert.equal(isNews({ ...written, seenAt: NOW - 2 * HOUR }, NOW), true, "written after the last look");
	assert.equal(isNews(board("boards/old.html", { modifiedAt: NOW - 48 * HOUR }), NOW), false, "a day old is not news either way");
});

/*
 * The mark is about the act, not the file. `report` and `show` name a board and write nothing, so
 * before `namedAt` the most common thing an agent does left no trace at all, while a person's own
 * drag was marked as news.
 */
test("an act names a board as news even though no file moved", () => {
	const reported = board("boards/plan.html", { modifiedAt: NOW - 3 * HOUR, lastWrittenBy: "a1", namedAt: NOW - 60_000 });
	assert.equal(isNews(reported, NOW), true);
	assert.equal(isNews({ ...reported, seenAt: NOW - 30_000 }, NOW), false, "read after the act: no longer news");
	// The act decides even when the file is older than the last read, which is every `report`.
	assert.equal(isNews({ ...reported, seenAt: NOW - 2 * HOUR }, NOW), true, "named after the last look");
});

test("the person's own act is not news to them", () => {
	const mine = board("boards/plan.html", { modifiedAt: NOW - 60_000, lastWrittenBy: "you", namedAt: NOW - 59_000 });
	assert.equal(isNews(mine, NOW), false);
	// Unless an agent named it afterwards.
	assert.equal(isNews({ ...mine, lastWrittenBy: "a1", namedAt: NOW - 30_000 }, NOW), true);
	// A file that moved after the person's own act is somebody else's write, whatever the byline says.
	assert.equal(isNews({ ...mine, modifiedAt: NOW - 10_000 }, NOW), true);
	/*
	 * A byline kept from before acts were timed. Every record already on a deck is in this shape,
	 * and the person's own edit is the likeliest reason that file moved, so it is not news either.
	 */
	assert.equal(isNews(board("boards/legacy.html", { modifiedAt: NOW - 60_000, lastWrittenBy: "you" }), NOW), false);
	// An agent's byline with no time is the other way round: an old record is still news.
	assert.equal(isNews(board("boards/legacy-agent.html", { modifiedAt: NOW - 60_000, lastWrittenBy: "a1" }), NOW), true);
});

test("a file written with no byline at all is still news", () => {
	assert.equal(isNews(board("boards/script.html", { modifiedAt: NOW - 60_000 }), NOW), true);
});

test("the age is a phrase a chip can hold", () => {
	assert.equal(agoLabel(NOW - 30_000, NOW), "now");
	assert.equal(agoLabel(NOW - 45 * 60 * 1000, NOW), "45m");
	assert.equal(agoLabel(NOW - 5 * HOUR, NOW), "5h");
	assert.equal(agoLabel(NOW - 26 * HOUR, NOW), "1d");
	assert.equal(agoLabel(NOW + HOUR, NOW), "now", "a clock ahead of the person's is not a negative age");
});
