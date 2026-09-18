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

test("an agent's byline reaches every browser once, is on disk, and comes back after a reload and a restart", () => {
	const root = mkdtempSync(join(tmpdir(), "decks-wrote-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>Plan</title><body class="board"></body>`);
	const { deck, service, sent } = serviceOn(root);

	service.wrote("boards/plan.html", "agent-1");
	service.wrote("boards/plan.html", "agent-1");
	service.wrote("boards/none.html", "agent-1");
	const changes = sent.filter((message) => message.type === "board.changed");
	assert.equal(changes.length, 1, "a repeat says nothing, and a board that is not there says nothing");
	assert.equal(changes[0]?.type === "board.changed" && changes[0].board?.lastWrittenBy, "agent-1");
	assert.match(readFileSync(join(root, ".decks", "authors.json"), "utf8"), /"boards\/plan\.html": "agent-1"/);

	// The loader re-describes boards from disk and knows no authors.
	deck.reload();
	assert.equal(deck.board("boards/plan.html")?.lastWrittenBy, undefined);
	service.restamp();
	assert.equal(deck.board("boards/plan.html")?.lastWrittenBy, "agent-1");

	// A new process on the same deck.
	assert.equal(serviceOn(root).deck.board("boards/plan.html")?.lastWrittenBy, "agent-1");

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
	rmSync(root, { recursive: true, force: true });
});
