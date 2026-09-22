import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DeckState, ServerMessage } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import { BoardService } from "./service.ts";

function serviceOn(root: string): { deck: Deck; service: BoardService; sent: ServerMessage[] } {
	const deck = Deck.open(root);
	const sent: ServerMessage[] = [];
	const service = new BoardService(deck, {
		send: (message) => void sent.push(message),
		state: () => ({ boards: deck.boards }) as unknown as DeckState,
		edited: () => {},
		removed: () => {},
	});
	return { deck, service, sent };
}

test("an agent's byline and act time reach every browser, are on disk, and come back after a reload and a restart", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-wrote-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>Plan</title><body class="board"></body>`);
	const { deck, service, sent } = serviceOn(root);

	service.wrote("boards/plan.html", "agent-1", 1000);
	service.wrote("boards/plan.html", "agent-1", 1000);
	service.wrote("boards/plan.html", "agent-1", 2000);
	service.wrote("boards/none.html", "agent-1", 3000);
	const changes = sent.filter((message) => message.type === "board.changed");
	assert.equal(changes.length, 2, "the same act twice says nothing, a later act does, and a board that is not there says nothing");
	assert.equal(changes[0]?.type === "board.changed" && changes[0].board?.lastWrittenBy, "agent-1");
	assert.equal(changes[0]?.type === "board.changed" && changes[0].board?.namedAt, 1000);
	assert.equal(changes[1]?.type === "board.changed" && changes[1].board?.namedAt, 2000);
	assert.match(readFileSync(join(root, ".decks", "authors.json"), "utf8"), /"boards\/plan\.html": \{\s*"who": "agent-1",\s*"at": 2000\s*\}/);

	// The loader re-describes boards from disk and knows no authors.
	deck.reload();
	assert.equal(deck.board("boards/plan.html")?.lastWrittenBy, undefined);
	service.restamp();
	assert.equal(deck.board("boards/plan.html")?.lastWrittenBy, "agent-1");
	assert.equal(deck.board("boards/plan.html")?.namedAt, 2000, "the act time comes back with the byline");

	// A new process on the same deck.
	assert.equal(serviceOn(root).deck.board("boards/plan.html")?.lastWrittenBy, "agent-1");
	assert.equal(serviceOn(root).deck.board("boards/plan.html")?.namedAt, 2000);

	// Gone from the disk, gone from the file.
	service.forgetBoard("boards/plan.html");
	assert.doesNotMatch(readFileSync(join(root, ".decks", "authors.json"), "utf8"), /plan\.html/);
	rmSync(root, { recursive: true, force: true });
});

test("a board the person has read is stamped once, and a later write makes it news again", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-seen-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>Plan</title><body class="board"></body>`);
	const { deck, service, sent } = serviceOn(root);
	const modified = deck.board("boards/plan.html")?.modifiedAt ?? 0;

	// A clock behind the disk still clears the mark.
	service.seen("boards/plan.html", modified - 5000);
	service.seen("boards/plan.html");
	const changes = sent.filter((message) => message.type === "board.changed");
	assert.equal(changes.length, 1, "the second look says nothing");
	assert.equal(deck.board("boards/plan.html")?.seenAt, modified);
	assert.equal(serviceOn(root).deck.board("boards/plan.html")?.seenAt, modified, "kept across a restart");

	// Written again: the reading is carried forward, and is now older than the file.
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>Plan, again</title><body class="board"></body>`);
	const later = deck.refresh("boards/plan.html");
	assert.equal(later?.seenAt, modified);

	// Read, then named by an agent after the file moved (a fit after a write): news again, and a
	// read stamps it even though the file itself is older than the last look.
	service.seen("boards/plan.html", (later?.modifiedAt ?? 0) + 10);
	const read = deck.board("boards/plan.html")?.seenAt ?? 0;
	service.wrote("boards/plan.html", "agent-1", read + 500);
	assert.equal(deck.board("boards/plan.html")?.namedAt, read + 500);
	service.seen("boards/plan.html", read + 900);
	assert.equal(deck.board("boards/plan.html")?.seenAt, read + 900, "the read is stamped against the naming act, not the file");
	rmSync(root, { recursive: true, force: true });
});
