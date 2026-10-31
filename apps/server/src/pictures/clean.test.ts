import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanPictures, pictureHash } from "./clean.ts";
import { CARD_LOOK, PICTURE_LOOK } from "./ladder.ts";

const card = "canvases/a/cards/one/index.html";
const page = "shared/canvases/ada/notes/boards/old.html";
const gone = "canvases/a/boards/converted.html";

function folder(files: Record<string, number>): string {
	const dir = mkdtempSync(join(tmpdir(), "decks-clean-"));
	const old = Date.now() / 1000 - 3600;
	for (const [name, bytes] of Object.entries(files)) {
		writeFileSync(join(dir, name), Buffer.alloc(bytes));
		utimesSync(join(dir, name), old, old);
	}
	return dir;
}

test("the daily clean removes pictures of pages gone, of an old look, and plain copies beside their brotli ones", () => {
	const c = pictureHash(card), p = pictureHash(page), g = pictureHash(gone);
	const keep = [
		`${c}-7-light-720-whole-w480-l${CARD_LOOK}.webp`,
		`${c}-7-light-720-whole-w480-l${CARD_LOOK}.astc.br`,
		`${c}-7-dark-720-whole-w192-l${CARD_LOOK}.astc`, // no brotli copy yet: kept
		`${p}-3-light-720-whole-w480-l${PICTURE_LOOK}.webp`,
		"stages",
	];
	const drop = [
		`${c}-7-light-720-whole-w480-l${CARD_LOOK}.astc`, // its .br is beside it
		`${c}-6-light-720-whole-w480-l${PICTURE_LOOK}.webp`, // a card in the pages' look
		`${g}-2-light-720-whole-w480-l${PICTURE_LOOK}.webp`, // a page the deck no longer has
		`${g}-2-dark-720-whole-l${PICTURE_LOOK}.webp`,
	];
	const dir = folder(Object.fromEntries([...keep.filter((n) => n !== "stages"), ...drop].map((n) => [n, 100])));
	mkdirSync(join(dir, "stages"));
	const done = cleanPictures(dir, [card, page]);
	assert.deepEqual(readdirSync(dir).sort(), keep.sort());
	assert.deepEqual(done, { removed: 4, bytes: 400, orphans: 2, oldLooks: 1, plainPacked: 1 });
});

test("a picture written in the last ten minutes is left alone, whatever it is", () => {
	const name = `${pictureHash(gone)}-2-light-720-whole-w480-l${PICTURE_LOOK}.webp`;
	const dir = mkdtempSync(join(tmpdir(), "decks-clean-"));
	writeFileSync(join(dir, name), "x");
	assert.equal(cleanPictures(dir, [card]).removed, 0);
	assert.ok(existsSync(join(dir, name)));
});

test("a missing folder cleans nothing", () => {
	assert.equal(cleanPictures(join(tmpdir(), "no-such-decks-folder"), [card]).removed, 0);
});
