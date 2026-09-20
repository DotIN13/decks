import assert from "node:assert/strict";
import { test } from "node:test";
import { planCanvases, type ChatToMigrate } from "./migrate.ts";

/*
 * The one-way move from "a word an agent typed" to "a thing with a name".
 *
 * Every case here is a shape the live deck actually has: 33 chats, ten with a workspace word,
 * nineteen with an arrangement of their own.
 */

const chat = (over: Partial<ChatToMigrate> & { id: string }): ChatToMigrate => ({ name: over.id, inPlay: [], ...over });

test("agents sharing a word land on one canvas named after it", () => {
	const plans = planCanvases([
		chat({ id: "a", workspace: "political-llm", inPlay: ["boards/one.html"] }),
		chat({ id: "b", workspace: "political-llm", inPlay: ["boards/two.html"] }),
	]);
	assert.equal(plans.length, 1);
	assert.equal(plans[0]?.name, "political-llm");
	assert.deepEqual(plans[0]?.members, ["a", "b"]);
	assert.deepEqual(plans[0]?.boards, ["boards/one.html", "boards/two.html"]);
});

test("the arrangement comes from the chat holding the most of the canvas's boards", () => {
	const plans = planCanvases([
		chat({ id: "thin", workspace: "decks", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 999, y: 999 } } }),
		chat({
			id: "full",
			workspace: "decks",
			inPlay: ["boards/one.html", "boards/two.html"],
			positions: { "boards/one.html": { x: 0, y: 0 }, "boards/two.html": { x: 1120, y: 0 } },
		}),
	]);
	assert.deepEqual(plans[0]?.places["boards/one.html"], { x: 0, y: 0 }, "the fuller canvas wins the board they both had");
	assert.deepEqual(plans[0]?.boards, ["boards/one.html", "boards/two.html"], "and its order leads");
});

test("a board only the other chat had keeps that chat's place for it", () => {
	const plans = planCanvases([
		chat({ id: "full", workspace: "decks", inPlay: ["boards/one.html", "boards/two.html"] }),
		chat({ id: "other", workspace: "decks", inPlay: ["boards/three.html"], positions: { "boards/three.html": { x: 40, y: 80 } } }),
	]);
	assert.deepEqual(plans[0]?.places["boards/three.html"], { x: 40, y: 80 });
	assert.deepEqual(plans[0]?.boards, ["boards/one.html", "boards/two.html", "boards/three.html"]);
});

test("a chat with boards and no word gets a canvas of its own, named after the chat", () => {
	const plans = planCanvases([chat({ id: "s1", name: "Sable", inPlay: ["boards/one.html"] })]);
	assert.equal(plans.length, 1);
	assert.equal(plans[0]?.name, "Sable");
	assert.deepEqual(plans[0]?.members, ["s1"]);
});

test("a chat with nothing arranged and no word is on no canvas", () => {
	assert.deepEqual(planCanvases([chat({ id: "idle", name: "Ada" })]), []);
});

test("a chat that arranged boards it has since hidden still gets its canvas", () => {
	// `positions` outlives `inPlay`: the arrangement is real even with nothing up.
	const plans = planCanvases([chat({ id: "s2", name: "Rune", positions: { "boards/one.html": { x: 10, y: 20 } } })]);
	assert.equal(plans.length, 1);
	assert.deepEqual(plans[0]?.boards, []);
	assert.deepEqual(plans[0]?.places, { "boards/one.html": { x: 10, y: 20 } });
});

test("two chats of the same size break the tie on the one used most recently", () => {
	const plans = planCanvases([
		chat({ id: "old", workspace: "w", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 1, y: 1 } }, lastAt: 1 }),
		chat({ id: "new", workspace: "w", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 2, y: 2 } }, lastAt: 2 }),
	]);
	assert.deepEqual(plans[0]?.places["boards/one.html"], { x: 2, y: 2 });
});
