import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { isNews } from "./board-news.ts";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function board(path: string, over: Partial<Board> = {}): Board {
	return { path, title: path, format: "board", x: 0, y: 0, w: 800, h: 600, rev: 1, inContext: [], ...over };
}

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

