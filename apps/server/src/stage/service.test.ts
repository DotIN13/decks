import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Board, ServerMessage } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import { StageService, type StageArrangement, type StageHost } from "./service.ts";

/**
 * Where a board goes, and who decides.
 *
 * **Per conversation.** The camera, what is in play, the cursors, the annotations — and, since
 * this file exists, where each board sits. `deck.json` keeps the deck's own arrangement, which
 * is what a stage starts from and where a board nobody has moved still is; a stage records only
 * the boards it moved itself (`AgentRecord.positions`).
 *
 * So the tests below are mostly about what does *not* happen: the deck's arrangement is not
 * touched, another conversation's board does not move, and a board already placed on this stage
 * is left exactly where it is — which is what makes the placement free to run on every `show`.
 */

/** A stage with nothing moved yet: the deck's arrangement, and nowhere of its own. */
function stageOf(places: Record<string, { x: number; y: number }> = {}): StageArrangement {
	const mine = new Map(Object.entries(places));
	return {
		stageBoard: (board) => {
			const at = mine.get(board.path);
			return at ? { ...board, x: at.x, y: at.y } : board;
		},
		positionOf: (path) => mine.get(path),
		place: (path, at) => {
			mine.set(path, at);
			return at;
		},
	};
}

function stageOn(boards: Array<{ name: string; w: number; h: number; at?: { x: number; y: number } }>) {
	const root = mkdtempSync(join(tmpdir(), "decks-place-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	const arrangement: Record<string, { x: number; y: number }> = {};
	for (const board of boards) {
		const path = `boards/${board.name}.html`;
		writeFileSync(
			join(root, path),
			`<!doctype html><html><head><title>${board.name}</title><meta name="board" content='{"w":${board.w},"h":${board.h}}'></head><body class="board"></body></html>`,
		);
		if (board.at) arrangement[path] = board.at;
	}
	writeFileSync(join(root, "deck.json"), JSON.stringify({ version: 1, name: "T", boards: arrangement }));

	const sent: ServerMessage[] = [];
	const host = {
		broadcast: (message: ServerMessage) => sent.push(message),
		newBoard: () => "",
		newMirror: () => "",
		writeBoard: () => ({}) as Board,
		extent: () => undefined,
		awaitExtent: async () => undefined,
		call: async () => undefined,
		connected: () => true,
		camera: () => ({ x: 0, y: 0, zoom: 1 }),
		agents: () => [],
	} as unknown as StageHost;

	const deck = Deck.open(root);
	return { deck, sent, service: new StageService(deck, host), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const place = (board: Board) => ({ x: board.x, y: board.y });

test("moving a board moves it on that stage and leaves the deck's arrangement alone", () => {
	const { deck, service, sent, cleanup } = stageOn([{ name: "plan", w: 400, h: 300, at: { x: 100, y: 50 } }]);
	const ada = stageOf();

	const moved = service.move(ada, "boards/plan.html", { x: 900, y: 700 });
	assert.deepEqual(place(moved), { x: 900, y: 700 });
	assert.deepEqual({ x: deck.board("boards/plan.html")?.x, y: deck.board("boards/plan.html")?.y }, { x: 100, y: 50 }, "the deck is where it was");
	assert.deepEqual(place(service.board("boards/plan.html", ada)!), { x: 900, y: 700 }, "the stage is where it was put");
	assert.deepEqual(sent.map((message) => message.type), ["board.changed"], "and the browser is told, as this stage sees it");
	cleanup();
});

test("a board moved on one stage does not move on another", () => {
	const { deck, service, cleanup } = stageOn([{ name: "plan", w: 400, h: 300, at: { x: 100, y: 50 } }]);
	const ada = stageOf();
	const rune = stageOf();

	service.move(ada, "boards/plan.html", { x: 900, y: 700 });
	assert.deepEqual(place(service.board("boards/plan.html", ada)!), { x: 900, y: 700 });
	assert.deepEqual(place(service.board("boards/plan.html", rune)!), { x: 100, y: 50 }, "the other conversation keeps its own answer");
	// And the deck's own arrangement is nobody's answer but the fallback's.
	assert.deepEqual({ x: deck.board("boards/plan.html")?.x, y: deck.board("boards/plan.html")?.y }, { x: 100, y: 50 });
	cleanup();
});

test("a board nobody has placed goes beside the ones on the canvas", () => {
	const { deck, service, sent, cleanup } = stageOn([
		{ name: "plan", w: 400, h: 300, at: { x: 100, y: 50 } },
		{ name: "notes", w: 300, h: 200 },
	]);
	const ada = stageOf();

	const moved = service.place(ada, ["boards/notes.html"], ["boards/plan.html"]);
	assert.deepEqual(
		moved.map((board) => ({ path: board.path, x: board.x, y: board.y })),
		[{ path: "boards/notes.html", x: 100 + 400 + 160, y: 50 }],
		"to the right of the board on the canvas, level with its top",
	);
	assert.deepEqual(sent.map((message) => message.type), ["board.changed"]);
	// Written down on the *stage*, which is what makes the next call a no-op.
	assert.deepEqual(ada.positionOf("boards/notes.html"), { x: 660, y: 50 });
	assert.equal(deck.board("boards/notes.html")?.x, 660, "and the deck's own copy is untouched");
	const written = JSON.parse(readFileSync(join(deck.path, "deck.json"), "utf8"));
	assert.equal(written.boards["boards/notes.html"], undefined, "nothing was written to deck.json");
	cleanup();
});

test("a board this stage has already placed is left exactly where it is", () => {
	const { service, sent, cleanup } = stageOn([{ name: "plan", w: 400, h: 300, at: { x: 100, y: 50 } }]);
	const ada = stageOf({ "boards/plan.html": { x: 5, y: 6 } });

	assert.deepEqual(service.place(ada, ["boards/plan.html"], []), [], "nothing to move");
	assert.deepEqual(ada.positionOf("boards/plan.html"), { x: 5, y: 6 });
	assert.deepEqual(sent, [], "and nothing said about it");
	cleanup();
});

test("with nothing on the canvas it sits beside the deck rather than at the origin", () => {
	const { service, cleanup } = stageOn([
		{ name: "plan", w: 400, h: 300, at: { x: 5_000, y: 9_000 } },
		{ name: "notes", w: 300, h: 200 },
	]);
	const ada = stageOf();

	// An empty stage: no reference at all. The origin would be a corner of a region nobody is in,
	// so the deck's own arrangement answers instead.
	const moved = service.place(ada, ["boards/notes.html"], []);
	assert.deepEqual(moved.map(place), [{ x: 5_000 + 400 + 160, y: 9_000 }]);
	cleanup();
});

test("a batch is placed as a batch, and none of it lands on the others", () => {
	const { service, cleanup } = stageOn([
		{ name: "plan", w: 400, h: 300, at: { x: 0, y: 0 } },
		{ name: "one", w: 300, h: 200 },
		{ name: "two", w: 300, h: 200 },
	]);
	const ada = stageOf();

	const moved = service.place(ada, ["boards/one.html", "boards/two.html"], ["boards/plan.html"]);
	assert.deepEqual(moved.map(place), [
		{ x: 560, y: 0 },
		{ x: 1_020, y: 0 },
	]);
	cleanup();
});
