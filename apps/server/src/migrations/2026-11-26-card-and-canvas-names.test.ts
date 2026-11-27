import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { agentRecord, cardPage, deckFile, drawing, migrated, migrateNames } from "./2026-11-26-card-and-canvas-names.ts";

const write = (root: string, path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};
const json = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;

test("a card's page: the meta tag, the body's class, its styles, the library's files and the runtime", () => {
	const page = `<!doctype html><html><head><meta name="board" content='{"w":800}' /><link rel="stylesheet" href="../../lib/board.css" /><style>.board .doc h1 { color: red } .boards { x: 1 } .board-x { y: 2 }</style><script src="../../lib/board.js"></script></head><body class="board doc"><script>window.__board.redraw(); const pick = (event) => send({ path: event.board });</script></body></html>`;
	const next = cardPage(page)!;
	assert.match(next, /<meta name="card" content/);
	assert.match(next, /lib\/card\.css/);
	assert.match(next, /lib\/card\.js/);
	assert.match(next, /<body class="card-page doc">/);
	assert.match(next, /\.card-page \.doc h1/);
	assert.match(next, /\.boards \{ x: 1 \} \.board-x \{ y: 2 \}/, "other classes keep their names");
	assert.match(next, /window\.__card\.redraw/);
	assert.match(next, /path: event\.path/);
	assert.equal(cardPage(next), undefined, "a page already in the new names is left alone");
});

test("an agent's record: stage is canvas, and an older record's canvas is fromCanvas", () => {
	assert.deepEqual(JSON.parse(agentRecord(JSON.stringify({ id: "a", stage: "plan" }))!), { id: "a", canvas: "plan" });
	assert.deepEqual(JSON.parse(agentRecord(JSON.stringify({ id: "a", canvas: "shared-1" }))!), { id: "a", fromCanvas: "shared-1" });
	assert.deepEqual(JSON.parse(agentRecord(JSON.stringify({ id: "a", stage: "plan", canvas: "shared-1" }))!), { id: "a", fromCanvas: "shared-1", canvas: "plan" });
	assert.equal(agentRecord(JSON.stringify({ id: "a" })), undefined);
});

test("deck.json's old map of places, and a drawing's leftover items from before cards", () => {
	assert.deepEqual(JSON.parse(deckFile(JSON.stringify({ version: 1, name: "d", boards: { "x.html": { x: 1, y: 2 } } }))!), { version: 1, name: "d", places: { "x.html": { x: 1, y: 2 } } });
	assert.equal(deckFile(JSON.stringify({ version: 1 })), undefined);
	const doc = { children: [{ id: "a", type: "browser", url: "boards/a.html", metadata: { type: "decks.board", path: "boards/a.html" } }, { id: "c", type: "browser", metadata: { type: "decks.card", path: "cards/c/index.html" } }] };
	const next = JSON.parse(drawing(JSON.stringify(doc))!) as typeof doc;
	assert.equal(next.children[0]!.metadata, undefined);
	assert.deepEqual(next.children[1]!.metadata, { type: "decks.card", path: "cards/c/index.html" });
});

test("a deck and its data folder, migrated once, backed up and recorded", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-names-"));
	const data = mkdtempSync(join(tmpdir(), "decks-names-data-"));
	try {
		write(deck, "deck.json", JSON.stringify({ version: 1, boards: { "a.html": { x: 1, y: 2 } } }, null, 2));
		write(deck, "canvases/plan/canvas.json", JSON.stringify({ title: "Plan", boards: [] }, null, "\t"));
		write(deck, "canvases/plan/canvas.pen", JSON.stringify({ version: "2.6", children: [] }));
		write(deck, "canvases/plan/cards/a/index.html", `<meta name="board" content='{"w":600}' /><style>.board .doc{}</style>`);
		write(deck, "shared/canvases/ada/notes/canvas.json", JSON.stringify({ title: "Notes", boards: [] }));
		write(deck, ".decks/agents/a1/meta.json", JSON.stringify({ id: "a1", stage: "plan" }, null, 2));
		write(deck, ".decks/agents/a1/chat.json", JSON.stringify({ entries: [{ parts: [{ type: "mention", kind: "board", id: "x" }] }] }));
		write(deck, ".decks/canvases/old.json", JSON.stringify({ id: "old", boards: ["a.html"] }));
		write(deck, ".decks/thumbs/stages/plan.png", "png");
		write(data, "board-eval.json", JSON.stringify({ allowed: ["apps/x"] }));

		const { ran, backup } = migrateNames(deck, { dataDir: data, now: new Date("2026-11-26T00:00:00Z") });
		assert.ok(ran);
		assert.ok(backup && existsSync(join(deck, backup)), "backed up first");
		assert.deepEqual(json(deck, "deck.json").places, { "a.html": { x: 1, y: 2 } });
		assert.equal(json(deck, "deck.json").boards, undefined);
		assert.deepEqual(json(deck, "canvases/plan/canvas.json"), { title: "Plan", cards: [] });
		assert.deepEqual(json(deck, "shared/canvases/ada/notes/canvas.json"), { title: "Notes", boards: [] }, "a friend's canvas is theirs");
		assert.match(readFileSync(join(deck, "canvases/plan/cards/a/index.html"), "utf8"), /<meta name="card".*\.card-page \.doc/s);
		assert.deepEqual(json(deck, ".decks/agents/a1/meta.json"), { id: "a1", canvas: "plan" });
		assert.match(readFileSync(join(deck, ".decks/agents/a1/chat.json"), "utf8"), /"kind":"card"/);
		assert.deepEqual(json(deck, ".decks/canvases/old.json"), { id: "old", cards: ["a.html"] });
		assert.ok(!existsSync(join(deck, ".decks/thumbs/stages")));
		assert.ok(!existsSync(join(data, "board-eval.json")) && existsSync(join(data, "app-trust.json")));
		assert.ok(migrated(deck));
		assert.equal(migrateNames(deck, { dataDir: data }).ran, false, "once");
	} finally {
		rmSync(deck, { recursive: true, force: true });
		rmSync(data, { recursive: true, force: true });
	}
});
