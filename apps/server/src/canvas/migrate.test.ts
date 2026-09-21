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

test("a chat that only has places for hidden boards gets no canvas", () => {
	// On the live deck those places are the old deck-wide auto-layout's, 600 to 900 per chat.
	assert.deepEqual(planCanvases([chat({ id: "s2", name: "Rune", positions: { "boards/one.html": { x: 10, y: 20 } } })]), []);
});

test("only the places of boards on the canvas are carried", () => {
	const plans = planCanvases([
		chat({ id: "s3", name: "Wren", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 1, y: 2 }, "boards/old.html": { x: 9000, y: 9000 } } }),
	]);
	assert.deepEqual(plans[0]?.places, { "boards/one.html": { x: 1, y: 2 } });
});

test("a workspace canvas is shared; a chat's own is not, so two chats with one name stay apart", () => {
	const plans = planCanvases([
		chat({ id: "a", name: "Agent", inPlay: ["boards/one.html"] }),
		chat({ id: "b", name: "Agent", inPlay: ["boards/two.html"] }),
		chat({ id: "c", name: "Rune", workspace: "decks", inPlay: ["boards/three.html"] }),
	]);
	assert.equal(plans.length, 3, "two Agents are two canvases");
	assert.deepEqual(plans.map((plan) => plan.shared).sort(), [false, false, true]);
});

test("two chats of the same size break the tie on the one used most recently", () => {
	const plans = planCanvases([
		chat({ id: "old", workspace: "w", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 1, y: 1 } }, lastAt: 1 }),
		chat({ id: "new", workspace: "w", inPlay: ["boards/one.html"], positions: { "boards/one.html": { x: 2, y: 2 } }, lastAt: 2 }),
	]);
	assert.deepEqual(plans[0]?.places["boards/one.html"], { x: 2, y: 2 });
});

/*
 * The old deck-wide auto-layout, as it actually sat on the live deck.
 *
 * `cross-interviewer` held three boards and had places for them 280,000 px apart, because
 * those places were three rows out of a column containing every board in the deck. Kept,
 * the canvas opens at one percent with its boards in the corner; there is nothing in it
 * worth keeping, because nobody chose it.
 */
test("places that are the auto-layout's leavings are dropped, and an arrangement is not", () => {
	const size = () => ({ w: 1000, h: 700 });
	const spread = planCanvases(
		[{ id: "a", name: "Wren", inPlay: ["one.html", "two.html", "three.html"], positions: { "one.html": { x: 0, y: 0 }, "two.html": { x: 0, y: 281_000 }, "three.html": { x: 0, y: 563_000 } } }],
		size,
	);
	assert.deepEqual(spread[0]?.places, {}, "three boards down half a million pixels is not an arrangement");
	assert.deepEqual(spread[0]?.boards, ["one.html", "two.html", "three.html"], "and the boards stay on the canvas");

	const laid = planCanvases(
		[{ id: "b", name: "Iris", inPlay: ["one.html", "two.html", "three.html"], positions: { "one.html": { x: 0, y: 0 }, "two.html": { x: 1_160, y: 0 }, "three.html": { x: 2_320, y: 0 } } }],
		size,
	);
	assert.deepEqual(Object.keys(laid[0]?.places ?? {}).sort(), ["one.html", "three.html", "two.html"], "three boards in a row is");
});

test("one remembered place is kept, because there is no spread to judge", () => {
	const plans = planCanvases([{ id: "a", name: "Wren", inPlay: ["one.html"], positions: { "one.html": { x: 9_000, y: 400_000 } } }], () => ({ w: 1000, h: 700 }));
	assert.deepEqual(plans[0]?.places, { "one.html": { x: 9_000, y: 400_000 } });
});
