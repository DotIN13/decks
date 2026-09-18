import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Identity, Task } from "@decks/protocol";
import {
	daysLabel,
	fileName,
	filterCards,
	galleryGroups,
	holderNames,
	inFlight,
	isNews,
	schedulePaused,
	stateWord,
	wantsYou,
	whyRefused,
} from "./dispatch-view.ts";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function board(path: string, over: Partial<Board> = {}): Board {
	return { path, title: fileName(path), format: "component", x: 0, y: 0, w: 800, h: 600, rev: 1, inContext: [], ...over };
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

test("inFlight drops the finished, puts refused first, then running, assigned, open; newest first within", () => {
	const olderOpen = task("open", { updatedAt: NOW - 5000 });
	const newerOpen = task("open", { updatedAt: NOW - 1000 });
	const running = task("running");
	const failed = task("failed");
	const done = task("done");
	const cancelled = task("cancelled");
	const assigned = task("assigned");
	const blocked = task("blocked", { updatedAt: NOW });
	const order = inFlight([olderOpen, done, newerOpen, running, failed, cancelled, assigned, blocked]).map((one) => one.id);
	assert.deepEqual(order, [blocked.id, failed.id, running.id, assigned.id, newerOpen.id, olderOpen.id]);
});

test("wantsYou counts blocked and failed only", () => {
	assert.equal(wantsYou([task("blocked"), task("failed"), task("running"), task("done")]), 2);
	assert.equal(wantsYou([]), 0);
});

test("galleryGroups shelves by holder, puts unheld boards last and folded, and marks what changed", () => {
	const boards = [
		board("boards/a-old.html", { modifiedAt: NOW - 48 * HOUR, lastWrittenBy: "a1" }),
		board("boards/a-new.html", { modifiedAt: NOW - HOUR, lastWrittenBy: "you" }),
		board("boards/b.html", { modifiedAt: NOW - 2 * HOUR }),
		board("boards/nobody.html", { modifiedAt: NOW - 3 * HOUR }),
	];
	const contexts = { a1: ["boards/a-old.html", "boards/a-new.html"], b1: ["boards/b.html"] };
	const wrote = task("done", { result: { at: NOW - HOUR, report: "drew it", boards: ["boards/a-new.html"] } });
	const groups = galleryGroups(boards, identities, contexts, [wrote], NOW);
	assert.deepEqual(
		groups.map((group) => group.name),
		["alpha", "beta", "No workspace"],
	);
	const alpha = groups[0]!;
	assert.deepEqual(
		alpha.cards.map((card) => card.board.path),
		["boards/a-new.html", "boards/a-old.html"],
	);
	assert.equal(alpha.changed, 1);
	assert.equal(alpha.collapsed, false);
	assert.equal(alpha.cards[0]!.writtenBy, "you");
	assert.equal(alpha.cards[0]!.fromTask?.id, wrote.id);
	assert.equal(alpha.cards[1]!.writtenBy, "Ada");
	assert.equal(alpha.cards[1]!.changed, false);
	assert.equal(alpha.cards[1]!.fromTask, undefined);
	const tail = groups[2]!;
	assert.equal(tail.real, false);
	assert.equal(tail.collapsed, true);
	assert.deepEqual(tail.cards.map((card) => card.board.path), ["boards/nobody.html"]);
	assert.deepEqual(tail.agents, ["Loose"]);
});

test("galleryGroups caps a shelf at nine and counts the rest, but counts changed before the cap", () => {
	const boards = Array.from({ length: 12 }, (_, i) => board(`boards/p${i}.html`, { modifiedAt: NOW - i * HOUR }));
	const contexts = { a1: boards.map((one) => one.path) };
	const [alpha] = galleryGroups(boards, identities, contexts, [], NOW);
	assert.equal(alpha!.cards.length, 9);
	assert.equal(alpha!.more, 3);
	assert.equal(alpha!.changed, 12);
});

test("filterCards narrows by chip, then by path or title", () => {
	const cards = [
		{ board: board("boards/plan.html", { title: "The plan" }), changed: true },
		{ board: board("boards/notes.html", { title: "Notes" }), changed: false, fromTask: task("done") },
	];
	assert.equal(filterCards(cards, "all", "").length, 2);
	assert.equal(filterCards(cards, "changed", "")[0]!.board.path, "boards/plan.html");
	assert.equal(filterCards(cards, "from-tasks", "")[0]!.board.path, "boards/notes.html");
	assert.equal(filterCards(cards, "all", "PLAN").length, 1);
	assert.equal(filterCards(cards, "all", "the plan").length, 1);
	assert.equal(filterCards(cards, "changed", "notes").length, 0);
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

test("a board is news until the person reads it, and again once it is written after that", () => {
	const written = board("boards/plan.html", { modifiedAt: NOW - HOUR });
	assert.equal(isNews(written, NOW), true);
	assert.equal(isNews({ ...written, seenAt: NOW - HOUR }, NOW), false, "read at the moment it was written");
	assert.equal(isNews({ ...written, seenAt: NOW - 10 * 60 * 1000 }, NOW), false, "read since");
	assert.equal(isNews({ ...written, seenAt: NOW - 2 * HOUR }, NOW), true, "written after the last look");
	assert.equal(isNews(board("boards/old.html", { modifiedAt: NOW - 48 * HOUR }), NOW), false, "a day old is not news either way");

	const groups = galleryGroups([{ ...written, seenAt: NOW - 60_000 }], identities, { a1: ["boards/plan.html"] }, [], NOW);
	assert.equal(groups[0]!.changed, 0);
	assert.equal(groups[0]!.cards[0]!.changed, false);
});

test("a card carries the writer's id only when that agent is still on the deck", () => {
	const boards = [
		board("boards/mine.html", { modifiedAt: NOW - HOUR, lastWrittenBy: "a1" }),
		board("boards/yours.html", { modifiedAt: NOW - HOUR, lastWrittenBy: "you" }),
		board("boards/gone.html", { modifiedAt: NOW - HOUR, lastWrittenBy: "deleted-agent" }),
	];
	const cards = galleryGroups(boards, identities, { a1: boards.map((one) => one.path) }, [], NOW)[0]!.cards;
	const by = Object.fromEntries(cards.map((card) => [card.board.path, card.writerId]));
	assert.deepEqual(by, { "boards/mine.html": "a1", "boards/yours.html": undefined, "boards/gone.html": undefined });
});
