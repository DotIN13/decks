import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Identity } from "@decks/protocol";
import { basename, contextSections, contextTally, filterBoards } from "./panel-groups.ts";

/*
 * The panel is a picture of these three sections, so every case here is one a reader of the
 * screen would notice: a board in the wrong group, a count that disagrees with the rows
 * under it, or another agent's board turning up in your own list.
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

const identities: Record<string, Identity> = {
	ada: { name: "Ada", color: "#d97757" },
	pi: { name: "Pi", color: "#3b5cf6" },
};

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

const ada = () => contextSections({ boards: deck, focused: "ada", holdings, inPlay, identities });

test("three sections, in drawing order, labelled in sentence case", () => {
	assert.deepEqual(
		ada().map((section) => section.label),
		["On the canvas", "Held, not shown", "Pi is holding"],
	);
	assert.deepEqual(
		ada().map((section) => section.kind),
		["canvas", "held", "other"],
	);
	for (const section of ada()) assert.notEqual(section.label, section.label.toUpperCase(), "no caps anywhere");
});

test("the counts are the rows, and the canvas keeps the agent's attach order", () => {
	const [canvas, quiet, other] = ada();
	assert.deepEqual(canvas?.rows.map((row) => row.board.path), inPlay);
	assert.equal(canvas?.rows.length, 3);
	assert.deepEqual(quiet?.rows.map((row) => row.board.title), ["The left panel", "The inspector"]);
	assert.equal(other?.rows.length, 2);
	assert.deepEqual(contextTally(ada()), { held: 5, onCanvas: 3 }, "the foot counts mine, not Pi's");
});

test("only the canvas rows get the dot, and only they are undimmed", () => {
	const [canvas, quiet] = ada();
	assert.ok(canvas?.rows.every((row) => row.onCanvas && !row.dim));
	assert.ok(quiet?.rows.every((row) => !row.onCanvas && row.dim));
});

test("another agent's boards appear only in the third section, in its colour", () => {
	const sections = ada();
	const mine = sections.filter((section) => section.kind !== "other").flatMap((section) => section.rows.map((row) => row.board.path));
	assert.ok(!mine.includes("boards/the-conversation.html"));
	const other = sections[2];
	assert.equal(other?.agent, "pi");
	assert.equal(other?.tint, "#3b5cf6");
	assert.ok(other?.rows.every((row) => row.tint === "#3b5cf6"), "the thumbnail border takes the identity colour");
});

test("a board two agents hold is listed once, as mine", () => {
	const shared = { ada: ["boards/the-shell.html"], pi: ["boards/the-shell.html", "boards/the-conversation.html"] };
	const sections = contextSections({ boards: deck, focused: "ada", holdings: shared, inPlay: ["boards/the-shell.html"], identities });
	assert.deepEqual(
		sections.map((section) => section.rows.map((row) => row.board.path)),
		[["boards/the-shell.html"], ["boards/the-conversation.html"]],
	);
	assert.deepEqual(sections.map((section) => section.kind), ["canvas", "other"], "no empty 'held, not shown'");
});

test("an agent holding nothing gets no sections at all, not three empty ones", () => {
	assert.deepEqual(contextSections({ boards: deck, focused: "zoe", holdings: { zoe: [] } }), []);
	assert.deepEqual(contextSections({ boards: deck, holdings }).length, 2, "no focus: everyone is somebody else");
});

test("a held path the deck no longer has is not a row", () => {
	const sections = contextSections({
		boards: deck,
		focused: "ada",
		holdings: { ada: ["boards/the-shell.html", "boards/deleted.html"] },
		inPlay: ["boards/the-shell.html", "boards/deleted.html"],
	});
	assert.deepEqual(sections.flatMap((section) => section.rows.map((row) => row.board.path)), ["boards/the-shell.html"]);
});

test("a board in play but somehow not held is still on the canvas", () => {
	const sections = contextSections({ boards: deck, focused: "ada", holdings: { ada: [] }, inPlay: ["boards/the-shell.html"] });
	assert.deepEqual(sections.map((section) => section.kind), ["canvas"]);
	assert.deepEqual(sections[0]?.rows.map((row) => row.board.path), ["boards/the-shell.html"]);
});

test("search filters the rows, drops the sections it empties, and moves the counts with them", () => {
	const sections = contextSections({ boards: deck, focused: "ada", holdings, inPlay, identities, query: "  SHELL " });
	assert.deepEqual(sections.map((section) => section.label), ["On the canvas"]);
	assert.equal(sections[0]?.rows.length, 1, "the count is what is under it, not what would be");
	assert.deepEqual(contextTally(sections), { held: 1, onCanvas: 1 });
});

test("search reaches another agent's section too", () => {
	const sections = contextSections({ boards: deck, focused: "ada", holdings, inPlay, identities, query: "conversation" });
	assert.deepEqual(sections.map((section) => section.label), ["Pi is holding"]);
});

test("search matches the file's basename as well as its title", () => {
	assert.deepEqual(filterBoards(deck, "left-panel").map((found) => found.title), ["The left panel"]);
	assert.deepEqual(filterBoards(deck, "The Shell").map((found) => found.path), ["boards/the-shell.html"]);
	assert.deepEqual(filterBoards(deck, ".html").length, deck.length, "the extension is part of the name it shows");
});

test("the directory is not searchable, because every board is in it", () => {
	assert.deepEqual(filterBoards(deck, "boards/"), [], "otherwise two letters select the whole deck");
	assert.equal(filterBoards(deck, "   ").length, deck.length, "an empty needle is not a filter");
});

test("basename is the name the row shows", () => {
	assert.equal(basename("boards/nested/one-agent-at-a-time.html"), "one-agent-at-a-time.html");
	assert.equal(basename("loose.html"), "loose.html");
});
