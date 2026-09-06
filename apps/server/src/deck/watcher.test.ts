import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { watchDeck, type DeckChange } from "./watcher.ts";
import { realPathOf } from "./roots.ts";

function deck(): string {
	const root = realPathOf(mkdtempSync(join(tmpdir(), "decks-watch-")));
	mkdirSync(join(root, "boards"), { recursive: true });
	return root;
}

function board(w: number): string {
	return `<!doctype html><html><head><title>A</title><meta name="board" content='{"w":${w},"h":600}'></head><body class="board"></body></html>`;
}

/** Wait for the changes to satisfy `done`, or give up. Real events, so real time. */
async function until(changes: DeckChange[], done: (seen: DeckChange[]) => boolean, ms = 4000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (done(changes)) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return done(changes);
}

const boards = (changes: DeckChange[]) => changes.filter((c) => c.kind === "board").map((c) => c.path);

test("an in-place write to a board is reported as that board", async () => {
	const root = deck();
	const file = join(root, "boards", "a.html");
	writeFileSync(file, board(800));

	const changes: DeckChange[] = [];
	const stop = watchDeck(root, (change) => changes.push(change), 20);
	try {
		writeFileSync(file, board(860));
		assert.ok(await until(changes, (seen) => boards(seen).includes("boards/a.html")));
	} finally {
		stop();
		rmSync(root, { recursive: true, force: true });
	}
});

/**
 * The regression this file exists for.
 *
 * A save that replaces the file — every atomic editor, `sed -i`, `git checkout` — used to
 * be the last event that board ever produced: the recursive watcher stayed armed on the
 * replaced inode, and the rename it did report named the temp file. So the interesting
 * assertion is not that the rename is noticed but that the *next ordinary write* still is.
 */
test("a board is still heard after a rename replaces its file", async () => {
	const root = deck();
	const file = join(root, "boards", "a.html");
	writeFileSync(file, board(800));

	const changes: DeckChange[] = [];
	const stop = watchDeck(root, (change) => changes.push(change), 20);
	try {
		const temp = join(root, "boards", ".tmp-a");
		writeFileSync(temp, board(860));
		renameSync(temp, file);
		assert.ok(await until(changes, (seen) => seen.some((c) => c.kind === "rescan")), "a rename asks for a rescan");

		changes.length = 0;
		writeFileSync(file, board(920));
		assert.ok(
			await until(changes, (seen) => boards(seen).includes("boards/a.html") || seen.some((c) => c.kind === "rescan")),
			"the write after the rename is still heard",
		);
	} finally {
		stop();
		rmSync(root, { recursive: true, force: true });
	}
});

test("the revision store is not watched, or every save would loop", async () => {
	const root = deck();
	mkdirSync(join(root, ".decks", "revisions"), { recursive: true });

	const changes: DeckChange[] = [];
	const stop = watchDeck(root, (change) => changes.push(change), 20);
	try {
		writeFileSync(join(root, ".decks", "revisions", "index.json"), "{}");
		writeFileSync(join(root, "boards", "b.html"), board(800));
		// The board is the thing that proves the watcher was listening at all.
		assert.ok(await until(changes, (seen) => boards(seen).includes("boards/b.html")));
		assert.deepEqual(
			changes.filter((c) => c.kind === "asset").map((c) => c.path),
			[],
		);
	} finally {
		stop();
		rmSync(root, { recursive: true, force: true });
	}
});

test("nothing is reported after the watch is stopped", async () => {
	const root = deck();
	const changes: DeckChange[] = [];
	const stop = watchDeck(root, (change) => changes.push(change), 20);
	stop();
	writeFileSync(join(root, "boards", "c.html"), board(800));
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.deepEqual(changes, []);
	rmSync(root, { recursive: true, force: true });
});
