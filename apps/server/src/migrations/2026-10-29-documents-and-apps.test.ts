import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boardIsItem, migrated, migrateDocumentsAndApps } from "./2026-10-29-documents-and-apps.ts";

test("a board that is one document or one app becomes that item, keeping its id, place and size; other boards stay", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-docs-apps-"));
	try {
		const canvas = join(deck, "canvases", "plan");
		mkdirSync(join(canvas, "boards", "apps"), { recursive: true });
		writeFileSync(join(canvas, "boards", "paper.html"), `<div class="live" data-id="doc" data-live="doc" data-path="../files/paper.md"></div>`);
		writeFileSync(join(canvas, "boards", "apps", "review.html"), `<div class="live" data-live="app" data-app="review"></div>`);
		writeFileSync(join(canvas, "boards", "plain.html"), `<h1>Plain</h1>`);
		const board = (id: string, path: string, x: number) => ({ type: "browser", id, x, y: 10, width: 500, height: 400, metadata: { type: "decks.board", path } });
		writeFileSync(join(canvas, "canvas.pen"), JSON.stringify({ version: "2.14", children: [board("paper", "boards/paper.html", 0), board("review", "boards/apps/review.html", 600), board("plain", "boards/plain.html", 1200)] }, null, "\t"));
		const { ran, backup } = migrateDocumentsAndApps(deck);
		assert.ok(ran);
		assert.ok(backup && existsSync(join(deck, backup)));
		const kids = (JSON.parse(readFileSync(join(canvas, "canvas.pen"), "utf8")) as { children: Array<Record<string, unknown>> }).children;
		assert.deepEqual(kids[0], { type: "browser", id: "paper", x: 0, y: 10, width: 500, height: 400, metadata: { type: "decks.document", path: "canvases/plan/files/paper.md" } });
		assert.deepEqual(kids[1]!.metadata, { type: "decks.app", name: "review" });
		assert.deepEqual(kids[2]!.metadata, { type: "decks.board", path: "boards/plain.html" });
		assert.ok(migrated(deck));
		assert.equal(migrateDocumentsAndApps(deck).ran, false, "once");
		assert.equal(boardIsItem("<p>no live box</p>"), undefined);
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});
