import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { basename, matches, panelSections, panelTally } from "./panel-groups.ts";

/*
 * The panel is a picture of these three sections, so every case here is one a reader of the
 * screen would notice: a board in the wrong group, a board in *two* groups, a count that
 * disagrees with the rows under it, or another agent's holdings turning up as your own.
 */

const board = (path: string, title = path): Board => ({
	path,
	title,
	x: 0,
	y: 0,
	w: 1400,
	h: 900,
	rev: 1,
	inContext: [],
});

const deck = [
	board("boards/the-brief.html", "The brief"),
	board("boards/the-shell.html", "The shell"),
	board("boards/the-system.html", "The system"),
	board("boards/the-left-panel.html", "The left panel"),
	board("boards/the-inspector.html", "The inspector"),
	board("boards/the-conversation.html", "The conversation"),
	board("boards/the-working-sign.html", "The working sign"),
];

const holdings = {
	ada: [
		"boards/the-brief.html",
		"boards/the-shell.html",
		"boards/the-system.html",
		"boards/the-left-panel.html",
		"boards/the-inspector.html",
	],
	pi: ["boards/the-conversation.html", "boards/the-working-sign.html"],
};

const inPlay = ["boards/the-brief.html", "boards/the-shell.html", "boards/the-system.html"];

const ada = () => panelSections({ boards: deck, focused: "ada", holdings, inPlay });

test("three sections, in drawing order, labelled in sentence case", () => {
	assert.deepEqual(
		ada().map((section) => section.label),
		["On the canvas", "Held, not shown", "In the deck"],
	);
	assert.deepEqual(
		ada().map((section) => section.kind),
		["canvas", "held", "deck"],
	);
	for (const section of ada()) assert.notEqual(section.label, section.label.toUpperCase(), "no caps anywhere");
});

test("the canvas keeps the agent's attach order; the deck keeps the deck's", () => {
	const [canvas, quiet, rest] = ada();
	assert.deepEqual(canvas?.rows.map((row) => row.board.path), inPlay);
	assert.deepEqual(quiet?.rows.map((row) => row.board.title), ["The left panel", "The inspector"]);
	assert.deepEqual(
		rest?.rows.map((row) => row.board.title),
		["The conversation", "The working sign"],
		"in the order `boards` arrived in, which is by path",
	);
});

test("every board is listed exactly once", () => {
	const paths = ada().flatMap((section) => section.rows.map((row) => row.board.path));
	assert.equal(paths.length, deck.length, "the whole deck");
	assert.equal(new Set(paths).size, paths.length, "and none of it twice");
});

test("the deck section is what nobody claimed, whoever else is holding it", () => {
	const [, , rest] = ada();
	// Pi holds both of these; that is not this list's business, and they are simply the rest.
	assert.deepEqual(rest?.rows.map((row) => row.board.path), ["boards/the-conversation.html", "boards/the-working-sign.html"]);
	assert.ok(rest?.rows.every((row) => !row.dim && !row.onCanvas), "not dimmed, not dotted");
});

test("only the canvas rows get the dot, and only the held ones are dimmed", () => {
	const [canvas, quiet] = ada();
	assert.ok(canvas?.rows.every((row) => row.onCanvas && !row.dim));
	assert.ok(quiet?.rows.every((row) => !row.onCanvas && row.dim));
});

test("a board two agents hold is the focused agent's, and not also in the deck", () => {
	const shared = { ada: ["boards/the-shell.html"], pi: ["boards/the-shell.html", "boards/the-conversation.html"] };
	const sections = panelSections({ boards: deck, focused: "ada", holdings: shared, inPlay: ["boards/the-shell.html"] });
	assert.deepEqual(sections.map((section) => section.kind), ["canvas", "deck"], "no empty 'held, not shown'");
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.path), ["boards/the-shell.html"]);
	assert.ok(
		!sections[1]?.rows.some((row) => row.board.path === "boards/the-shell.html"),
		"the deck section is the rest, and the shell is not the rest",
	);
});

test("an agent holding nothing gets the deck, not an empty panel", () => {
	const sections = panelSections({ boards: deck, focused: "zoe", holdings: { zoe: [] } });
	assert.deepEqual(sections.map((section) => section.kind), ["deck"]);
	assert.equal(sections[0]?.rows.length, deck.length);
	// And with no agent at all, which is a fresh session before anything has the focus.
	assert.deepEqual(panelSections({ boards: deck, holdings }).map((section) => section.kind), ["deck"]);
});

test("an empty deck is no sections at all, which is the panel's one empty state", () => {
	assert.deepEqual(panelSections({ boards: [], focused: "ada", holdings }), []);
});

test("a held path the deck no longer has is not a row", () => {
	const sections = panelSections({
		boards: [board("boards/the-shell.html")],
		focused: "ada",
		holdings: { ada: ["boards/the-shell.html", "boards/deleted.html"] },
		inPlay: ["boards/the-shell.html", "boards/deleted.html"],
	});
	assert.deepEqual(sections.flatMap((section) => section.rows.map((row) => row.board.path)), ["boards/the-shell.html"]);
});

test("a board in play but somehow not held is still on the canvas", () => {
	const sections = panelSections({ boards: deck, focused: "ada", holdings: { ada: [] }, inPlay: ["boards/the-shell.html"] });
	assert.deepEqual(sections.map((section) => section.kind), ["canvas", "deck"]);
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.path), ["boards/the-shell.html"]);
});

test("search runs over the whole list, and drops the sections it empties", () => {
	const sections = panelSections({ boards: deck, focused: "ada", holdings, inPlay, query: "  SHELL " });
	assert.deepEqual(sections.map((section) => section.label), ["On the canvas"]);
	assert.equal(sections[0]?.rows.length, 1, "the count is what is under it, not what would be");
	assert.deepEqual(panelTally(sections), { onCanvas: 1, held: 1, deck: 0, shown: 1 });
});

test("…including the part of it the agent is not holding", () => {
	// The Deck tab used to be where you went for this. There is nowhere to go now.
	const sections = panelSections({ boards: deck, focused: "ada", holdings, inPlay, query: "conversation" });
	assert.deepEqual(sections.map((section) => section.label), ["In the deck"]);
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.title), ["The conversation"]);
});

test("the tally is the sections, so the foot cannot disagree with the list", () => {
	assert.deepEqual(panelTally(ada()), { onCanvas: 3, held: 5, deck: 2, shown: 7 });
	assert.deepEqual(panelTally([]), { onCanvas: 0, held: 0, deck: 0, shown: 0 });
});

test("search matches the file's basename as well as its title", () => {
	assert.ok(matches(deck[3]!, "left-panel"), "the basename");
	assert.ok(matches(deck[3]!, "the left"), "the title");
	assert.ok(!matches(deck[3]!, "boards/"), "the directory is not searchable: every board is in it");
});

test("basename is the name the row shows", () => {
	assert.equal(basename("boards/nested/one-agent-at-a-time.html"), "one-agent-at-a-time.html");
	assert.equal(basename("loose.html"), "loose.html");
});
