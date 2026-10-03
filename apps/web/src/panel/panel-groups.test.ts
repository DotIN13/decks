import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { basename, keepRows, matches, panelSections } from "./panel-groups.ts";

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
});

test("…including the part of it the canvas is not holding", () => {
	const sections = panelSections({ boards: deck, kept, inPlay, query: "conversation" });
	assert.deepEqual(sections.map((section) => section.label), ["In the deck"]);
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.title), ["The conversation"]);
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

test("pen files stand among the boards in the deck section, in path order, and the search finds them by name", () => {
	const pens = [
		{ path: "frames/ui/agent-card.pen", ref: "frames/ui/agent-card", title: "Agent card", modifiedAt: 0 },
		{ path: "boards/kit.pen", ref: "boards/kit", title: "Shape kit", modifiedAt: 0 },
	];
	const boards = [{ path: "boards/b.html", title: "B" }, { path: "frames/ui/note.html", title: "Note" }] as never[];
	const [deck] = panelSections({ boards, pens });
	assert.equal(deck!.kind, "deck");
	assert.deepEqual(deck!.rows.map((row) => [row.board.path, !!row.pen]), [
		["boards/b.html", false],
		["boards/kit.pen", true],
		["frames/ui/agent-card.pen", true],
		["frames/ui/note.html", false],
	]);
	assert.deepEqual(panelSections({ boards, pens, query: "agent" })[0]!.rows.map((row) => row.board.path), ["frames/ui/agent-card.pen"]);
});

test("a deck that changed one board keeps every other row, and the sections they are in", () => {
	const boards = [board("boards/a.html"), board("boards/b.html"), board("boards/c.html")];
	const first = keepRows([], panelSections({ boards, inPlay: ["boards/a.html"], query: "" }));
	const changed = [boards[0]!, { ...boards[1]!, rev: 2 }, boards[2]!];
	const second = keepRows(first, panelSections({ boards: changed, inPlay: ["boards/a.html"], query: "" }));
	assert.equal(second[0], first[0], "the canvas section did not change, so it is the same object");
	const [was, now] = [first[1]!, second[1]!];
	assert.notEqual(now, was, "the deck section has a changed row");
	assert.equal(now.rows[1], was.rows[1], "the untouched row is the same object");
	assert.notEqual(now.rows[0], was.rows[0], "the changed board's row is new");
	const third = keepRows(second, panelSections({ boards: changed, inPlay: [], query: "" }));
	assert.notEqual(third.find((section) => section.kind === "deck")!.rows[0], second[0]!.rows[0], "a board that left the canvas gets a row in its new section");
});
