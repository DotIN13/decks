import assert from "node:assert/strict";
import { test } from "node:test";
import { accountsOf, withPlacements, cardsOn, chatOf, identityOf, modelOf, pageOf, stageRowOf, stateOf } from "./rows.ts";

// The rows the page draws, from what the server and the harness answer.

const ada = { id: "a1", name: "Ada", color: "#f00", tags: ["css"], workspace: "decks", canvas: "plan", state: "tool", model: "anthropic/opus", thinking: "high" };

test("an unknown state reads as idle, a known one as itself", () => {
	assert.equal(stateOf("error"), "idle");
	assert.equal(stateOf(undefined), "idle");
	assert.equal(stateOf("tool"), "tool");
});

test("an identity carries the name, colour, tags and workspace, and leaves out what is empty", () => {
	assert.deepEqual(identityOf(ada), { name: "Ada", color: "#f00", tags: ["css"], workspace: "decks" });
	assert.deepEqual(identityOf({ id: "b", name: "Bo", tags: [] }), { name: "Bo", color: "#888888" });
});

test("a model in words splits into provider and model; the harness's whole model wins", () => {
	assert.deepEqual(modelOf(ada), { provider: "anthropic", model: "opus", thinking: "high" });
	const whole = { provider: "p", model: "m", thinking: "low" as const };
	assert.deepEqual(modelOf(ada, { model: whole }), whole);
	assert.equal(modelOf({ id: "x", name: "X", tags: [] }), undefined);
});

test("a row has its boards in play, the harness's lines and usage, and starts with nothing unread", () => {
	const row = chatOf(ada, { lastLine: "done", dormant: true }, ["canvases/plan/cards/a/index.html"]);
	assert.equal(row.state, "tool");
	assert.equal(row.unread, 0);
	assert.equal(row.lastLine, "done");
	assert.equal(row.dormant, true);
	assert.deepEqual(row.inPlay, ["canvases/plan/cards/a/index.html"]);
});

test("a canvas row lists the agents whose home it is", () => {
	const row = stageRowOf({ name: "plan", title: "Plan", open: [], cards: 3, rev: 7 }, [ada, { id: "b", name: "Bo", tags: [], canvas: "other" }]);
	assert.deepEqual(row.agents, [{ id: "a1", name: "Ada", color: "#f00" }]);
	assert.equal(row.boards, 3);
});

test("a card's page takes its box on its canvas; cardsOn lists a canvas's cards", () => {
	const card = { path: "canvases/plan/cards/a/index.html", title: "A", placements: [{ card: "x", canvas: "plan", box: { x1: 10, y1: 20, x2: 110, y2: 70 } }] };
	assert.deepEqual([pageOf(card).x, pageOf(card).y, pageOf(card).w, pageOf(card).h], [10, 20, 100, 50]);
	assert.deepEqual(cardsOn([card], "plan"), [card.path]);
	assert.deepEqual(cardsOn([card], undefined), []);
});

test("the active account is the one a new agent starts on", () => {
	assert.equal(accountsOf([{ id: "default", label: "me", active: false }, { id: "w", label: "work", active: true }]).active, "w");
	assert.equal(accountsOf([]).active, "default");
});

test("a card the list placed nowhere takes its places from the canvases' items", () => {
	const placed = [{ card: "canvases/a/cards/x/index.html", canvas: "a", box: { x1: 0, y1: 0, x2: 10, y2: 10 } }];
	const [card] = withPlacements([{ path: "canvases/a/cards/x/index.html", title: "X" }], placed);
	assert.deepEqual(cardsOn([card!], "a"), ["canvases/a/cards/x/index.html"]);
});
