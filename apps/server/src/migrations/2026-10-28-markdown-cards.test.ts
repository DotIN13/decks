import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrated, migrateMarkdownCards } from "./2026-10-28-markdown-cards.ts";

const pen = (children: unknown[]) => JSON.stringify({ version: "2.14", children }, null, 2);

test("markdown card frames become decks.markdown-card, once; HTML cards and a friend's canvas stay as they are", () => {
	const deck = mkdtempSync(join(tmpdir(), "md-cards-"));
	mkdirSync(join(deck, "canvases", "plan"), { recursive: true });
	mkdirSync(join(deck, "shared", "canvases", "ana", "trip"), { recursive: true });
	writeFileSync(
		join(deck, "canvases", "plan", "canvas.pen"),
		pen([
			{ type: "frame", id: "md", metadata: { type: "decks.card" }, children: [{ type: "frame", id: "inner", metadata: { type: "decks.card" } }] },
			{ type: "browser", id: "html", url: "cards/a.html", metadata: { type: "decks.card", path: "cards/a.html" } },
		]),
	);
	const friend = pen([{ type: "frame", id: "theirs", metadata: { type: "decks.card" } }]);
	writeFileSync(join(deck, "shared", "canvases", "ana", "trip", "canvas.pen"), friend);

	const first = migrateMarkdownCards(deck);
	assert.equal(first.ran, true);
	assert.deepEqual(first.plan.files, [{ path: "canvases/plan/canvas.pen", frames: 2 }]);
	const doc = JSON.parse(readFileSync(join(deck, "canvases", "plan", "canvas.pen"), "utf8"));
	assert.equal(doc.children[0].metadata.type, "decks.markdown-card");
	assert.equal(doc.children[0].children[0].metadata.type, "decks.markdown-card");
	assert.equal(doc.children[1].metadata.type, "decks.card", "an HTML card keeps its tag");
	assert.equal(readFileSync(join(deck, "shared", "canvases", "ana", "trip", "canvas.pen"), "utf8"), friend, "a friend's canvas is theirs");
	assert.equal(migrated(deck), true);
	assert.equal(migrateMarkdownCards(deck).ran, false, "once");
});
