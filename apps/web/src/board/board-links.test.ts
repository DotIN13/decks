import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOpenOf, deckBoardLink, deckPath } from "./board-links.ts";

/**
 * A board asking for another board.
 *
 * Two questions, and one rule each: is this message *from this frame*, and is what it carries
 * one path inside the deck. Both are guards on a string that came out of a board's own file —
 * a board's content is a file, and a file can carry a script — so what is worth pinning is
 * that neither guard can be talked out of its answer, and that the ordinary case still passes.
 */

/** A frame with a window and nothing else: the guard compares identity, not shape. */
const frame = () => ({ contentWindow: {} }) as unknown as HTMLIFrameElement;
const ask = (path: unknown, source?: unknown) => ({ source, data: { decks: "board.open", path } });

test("a board asking from its own frame is a deck path", () => {
	const one = frame();
	assert.equal(boardOpenOf(ask("boards/notes.html", one.contentWindow), one), "boards/notes.html");
});

test("a path in a subdirectory is still one path", () => {
	const one = frame();
	assert.equal(boardOpenOf(ask("boards/talks/a.html", one.contentWindow), one), "boards/talks/a.html");
});

test("a message from another window is not this board's", () => {
	assert.equal(boardOpenOf(ask("boards/notes.html", {}), frame()), undefined);
	assert.equal(boardOpenOf(ask("boards/notes.html", undefined), frame()), undefined);
});

test("a message that is not a request to open is ignored", () => {
	const one = frame();
	assert.equal(boardOpenOf({ source: one.contentWindow, data: { decks: "live.chat", agent: "x" } }, one), undefined);
	assert.equal(boardOpenOf({ source: one.contentWindow, data: null }, one), undefined);
	assert.equal(boardOpenOf({ source: one.contentWindow, data: "boards/notes.html" }, one), undefined);
});

test("a path that is not a string is refused", () => {
	const one = frame();
	assert.equal(boardOpenOf(ask(7, one.contentWindow), one), undefined);
	assert.equal(boardOpenOf(ask({ path: "boards/notes.html" }, one.contentWindow), one), undefined);
	assert.equal(boardOpenOf(ask(undefined, one.contentWindow), one), undefined);
});

/*
 * The traversal cases, which are the whole reason the path is checked rather than used. The
 * deck lookup is the authority on what exists; this is what stops the lookup being *asked*.
 */
test("a path out of the deck is refused", () => {
	assert.equal(deckPath(""), undefined);
	assert.equal(deckPath("../../etc/passwd"), undefined);
	assert.equal(deckPath("boards/../secrets.html"), undefined);
	assert.equal(deckPath("/etc/passwd"), undefined);
	assert.equal(deckPath("boards//notes.html"), undefined);
	assert.equal(deckPath("."), undefined);
	assert.equal(deckPath("boards/.."), undefined);
	assert.equal(deckPath("~/notes.html"), undefined);
	assert.equal(deckPath("boards\\notes.html"), undefined);
});

test("an ordinary deck path is passed through unchanged", () => {
	assert.equal(deckPath("boards/notes.html"), "boards/notes.html");
	assert.equal(deckPath("boards/talks/a.html"), "boards/talks/a.html");
	assert.equal(deckPath("boards/a b.html"), "boards/a b.html");
});

/**
 * A link in a **card on the stage**, which is read against the stage's folder rather than
 * against a board. The question is the same one — is this a board of this deck — and the
 * answer has to come out of a URL rather than out of a message.
 */
const BASE = "/api/f/home/decks/data/decks/stages/plan/";

test("a card's link into the deck's boards is that board", () => {
	assert.equal(deckBoardLink("../../boards/risks.html", BASE), "boards/risks.html");
	assert.equal(deckBoardLink("../../boards/notes.md", BASE), "boards/notes.md");
	assert.equal(deckBoardLink("/api/f/home/decks/data/decks/boards/risks.html", BASE), "boards/risks.html");
	// Written as it is on disk, so a space arrives as a space and not as `%20`.
	assert.equal(deckBoardLink("../../boards/a%20b.html", BASE), "boards/a b.html");
});

test("a card's link to anything else is not a board", () => {
	// Another site, and a deck file that is not a board: both are tabs.
	assert.equal(deckBoardLink("https://example.com/risks.html", BASE), undefined);
	assert.equal(deckBoardLink("../../assets/sketch.svg", BASE), undefined);
	// Out of the deck altogether, by climbing above it.
	assert.equal(deckBoardLink("../../../../elsewhere/boards/x.html", BASE), undefined);
	// A stage with no file yet has no folder to read against.
	assert.equal(deckBoardLink("../../boards/risks.html", ""), undefined);
});
