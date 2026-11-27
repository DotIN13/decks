import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { ignored, watchDeck, type DeckChange } from "./watcher.ts";
import { realPathOf } from "./roots.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


function deck(): string {
	const root = realPathOf(mkdtempSync(join(tmpdir(), "decks-watch-")));
	mkdirSync(join(root, "cards"), { recursive: true });
	return root;
}

function card(w: number): string {
	return `<!doctype html><html><head><title>A</title><meta name="card" content='{"w":${w},"h":600}'></head><body class="card-page"></body></html>`;
}

/** Wait for the changes to satisfy `done`, or give up. Real events, so real time. */
/**
 * Wait for what a check expects. The deadline only matters when it never comes: under a full test run a
 * new folder's first file was heard after more than 4 s, and the check failed though the watcher was right.
 */
async function until(changes: DeckChange[], done: (seen: DeckChange[]) => boolean, ms = 15_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (done(changes)) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return done(changes);
}

/**
 * Start watching and wait until the watcher is really listening.
 *
 * On a Mac the watch is live a moment after `watch()` returns, and a write in that moment is
 * never reported at all: under load (other suites running) that window grew past the 4 s the
 * checks wait, so the first write in a test was lost and the test timed out. A probe file is
 * written until it is heard, then forgotten, so each check starts on a watcher that hears.
 */
async function watching(root: string, changes: DeckChange[]): Promise<() => void> {
	const stop = watchDeck(root, (change) => changes.push(change), 20);
	const probe = join(root, "probe.txt");
	const deadline = Date.now() + 10_000;
	for (let n = 0; Date.now() < deadline && changes.length === 0; n++) {
		put(probe, String(n));
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	// Let the probe's last write be reported before forgetting it; the file stays, unwritten.
	await new Promise((resolve) => setTimeout(resolve, 250));
	changes.length = 0;
	return stop;
}

const cards = (changes: DeckChange[]) => changes.filter((c) => c.kind === "card").map((c) => c.path);

test("an in-place write to a card is reported as that card", async () => {
	const root = deck();
	const file = join(root, "canvases", "t", "cards", "a", "index.html");
	put(file, card(800));

	const changes: DeckChange[] = [];
	const stop = await watching(root, changes);
	try {
		put(file, card(860));
		assert.ok(await until(changes, (seen) => cards(seen).includes("canvases/t/cards/a/index.html")));
	} finally {
		stop();
		rmSync(root, { recursive: true, force: true });
	}
});

/**
 * The regression this file exists for.
 *
 * A save that replaces the file — every atomic editor, `sed -i`, `git checkout` — used to
 * be the last event that card ever produced: the recursive watcher stayed armed on the
 * replaced inode, and the rename it did report named the temp file. So the interesting
 * assertion is not that the rename is noticed but that the *next ordinary write* still is.
 */
test("a card is still heard after a rename replaces its file", async () => {
	const root = deck();
	const file = join(root, "canvases", "t", "cards", "a", "index.html");
	put(file, card(800));

	const changes: DeckChange[] = [];
	const stop = await watching(root, changes);
	try {
		const temp = join(root, "cards", ".tmp-a");
		put(temp, card(860));
		renameSync(temp, file);
		assert.ok(await until(changes, (seen) => seen.some((c) => c.kind === "rescan")), "a rename asks for a rescan");

		changes.length = 0;
		put(file, card(920));
		assert.ok(
			await until(changes, (seen) => cards(seen).includes("canvases/t/cards/a/index.html") || seen.some((c) => c.kind === "rescan")),
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
	const stop = await watching(root, changes);
	try {
		put(join(root, ".decks", "revisions", "index.json"), "{}");
		put(join(root, "canvases", "t", "cards", "b", "index.html"), card(800));
		// The card is the thing that proves the watcher was listening at all; under load the watcher may
		// say "look at everything" (a rescan) instead, as in the test above.
		assert.ok(await until(changes, (seen) => cards(seen).includes("canvases/t/cards/b/index.html") || seen.some((c) => c.kind === "rescan")));
		assert.deepEqual(
			// The probe that proved the watcher listening (`watching`) may still be heard late.
			changes.filter((c) => c.kind === "asset").map((c) => c.path).filter((path) => path !== "probe.txt"),
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
	put(join(root, "canvases", "t", "cards", "c", "index.html"), card(800));
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.deepEqual(changes, []);
	rmSync(root, { recursive: true, force: true });
});

test("a .git or node_modules folder is not watched wherever it is, an app's among them", () => {
	for (const path of [".decks/revisions/a", ".git/index", "node_modules/a/index.js", "apps/food/node_modules/a/index.js", "apps/food/.git/HEAD", "canvases/plan/files/site/node_modules/b.js"]) assert.equal(ignored(path), true, path);
	for (const path of ["apps/food/index.html", "assets/a.png", "canvases/plan/cards/first/index.html", ".gitignore", "apps/food/.gitignore", "assets/node_modules.png"]) assert.equal(ignored(path), false, path);
});
