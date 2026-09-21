import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { basename, matches, panelSections, panelTally } from "./panel-groups.ts";

/*
 * The panel is a picture of these three sections, so every case here is one a reader of the
 * screen would notice: a board in the wrong group, a board in *two* groups, a count that
 * disagrees with the rows under it, or or a board the canvas holds turning up twice.
 */

const board = (path: string, title = path): Board => ({
	path,
	format: "board",
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

/* The canvas: three boards up, and two it took off and keeps a place for. */
const inPlay = ["boards/the-brief.html", "boards/the-shell.html", "boards/the-system.html"];
const kept = ["boards/the-left-panel.html", "boards/the-inspector.html"];

const room = () => panelSections({ boards: deck, kept, inPlay });

test("three sections, in drawing order, labelled in sentence case", () => {
	assert.deepEqual(
		room().map((section) => section.label),
		["On the canvas", "Held, not shown", "In the deck"],
	);
	assert.deepEqual(
		room().map((section) => section.kind),
		["canvas", "held", "deck"],
	);
	for (const section of room()) assert.notEqual(section.label, section.label.toUpperCase(), "no caps anywhere");
});

test("held, not shown is what the canvas took off; the deck keeps the deck's order", () => {
	const [canvas, quiet, rest] = room();
	assert.deepEqual(canvas?.rows.map((row) => row.board.path), inPlay);
	assert.deepEqual(quiet?.rows.map((row) => row.board.title), ["The left panel", "The inspector"], "the canvas's own order, newest first");
	assert.deepEqual(
		rest?.rows.map((row) => row.board.title),
		["The conversation", "The working sign"],
		"in the order `boards` arrived in, which is by path",
	);
});

test("every board is listed exactly once", () => {
	const paths = room().flatMap((section) => section.rows.map((row) => row.board.path));
	assert.equal(paths.length, deck.length, "the whole deck");
	assert.equal(new Set(paths).size, paths.length, "and none of it twice");
});

test("only the canvas rows get the dot, and only the held ones are dimmed", () => {
	const [canvas, quiet, rest] = room();
	assert.ok(canvas?.rows.every((row) => row.onCanvas && !row.dim));
	assert.ok(quiet?.rows.every((row) => !row.onCanvas && row.dim));
	assert.ok(rest?.rows.every((row) => !row.dim && !row.onCanvas), "the deck is neither");
});

test("a board both up and in the kept list is on the canvas, once", () => {
	const sections = panelSections({ boards: deck, kept: ["boards/the-shell.html"], inPlay: ["boards/the-shell.html"] });
	assert.deepEqual(sections.map((section) => section.kind), ["canvas", "deck"], "no empty 'held, not shown'");
});

test("a canvas holding nothing gets the deck, not an empty panel", () => {
	const sections = panelSections({ boards: deck });
	assert.deepEqual(sections.map((section) => section.kind), ["deck"]);
	assert.equal(sections[0]?.rows.length, deck.length);
});

test("an empty deck is no sections at all, which is the panel's one empty state", () => {
	assert.deepEqual(panelSections({ boards: [], kept, inPlay }), []);
});

test("a path the deck no longer has is not a row", () => {
	const sections = panelSections({
		boards: [board("boards/the-shell.html")],
		kept: ["boards/deleted.html"],
		inPlay: ["boards/the-shell.html", "boards/deleted.html"],
	});
	assert.deepEqual(sections.flatMap((section) => section.rows.map((row) => row.board.path)), ["boards/the-shell.html"]);
});

test("search runs over the whole list, and drops the sections it empties", () => {
	const sections = panelSections({ boards: deck, kept, inPlay, query: "  SHELL " });
	assert.deepEqual(sections.map((section) => section.label), ["On the canvas"]);
	assert.equal(sections[0]?.rows.length, 1, "the count is what is under it, not what would be");
	assert.deepEqual(panelTally(sections), { onCanvas: 1, held: 1, deck: 0, shown: 1 });
});

test("…including the part of it the canvas is not holding", () => {
	const sections = panelSections({ boards: deck, kept, inPlay, query: "conversation" });
	assert.deepEqual(sections.map((section) => section.label), ["In the deck"]);
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.title), ["The conversation"]);
});

test("the tally is the sections, so the foot cannot disagree with the list", () => {
	assert.deepEqual(panelTally(room()), { onCanvas: 3, held: 5, deck: 2, shown: 7 });
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
