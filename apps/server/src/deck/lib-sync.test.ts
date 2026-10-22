import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { describeSync, syncRuntimeLib } from "./lib-sync.ts";

const scratch: string[] = [];
const dir = (name: string) => {
	const path = mkdtempSync(join(tmpdir(), `decks-lib-${name}-`));
	scratch.push(path);
	return path;
};
after(() => {
	for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const put = (root: string, relative: string, text: string) => {
	const target = join(root, relative);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, text);
	return target;
};

test("a deck with no lib gets the whole of it", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "board.css", ".card{}");
	put(from, "wasm/openjpeg.wasm", "binary");

	const sync = syncRuntimeLib(from, to);

	assert.deepEqual(sync.written.sort(), ["board.css", "wasm/openjpeg.wasm"]);
	assert.equal(sync.same, 0);
	assert.equal(readFileSync(join(to, "wasm/openjpeg.wasm"), "utf8"), "binary");
});

test("an unchanged restart writes nothing at all", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "board.js", "runtime");
	syncRuntimeLib(from, to);

	const before = statSync(join(to, "board.js")).mtimeMs;
	const sync = syncRuntimeLib(from, to);

	// The whole point: the watcher must not wake, so not one byte may be rewritten.
	assert.deepEqual(sync.written, []);
	assert.deepEqual(sync.removed, []);
	assert.equal(sync.same, 1);
	assert.equal(statSync(join(to, "board.js")).mtimeMs, before);
	assert.equal(describeSync(sync), undefined);
});

test("a newer build's file replaces the deck's copy", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "board.css", "old");
	syncRuntimeLib(from, to);
	put(from, "board.css", "new, and longer");

	const sync = syncRuntimeLib(from, to);

	assert.deepEqual(sync.written, ["board.css"]);
	assert.equal(readFileSync(join(to, "board.css"), "utf8"), "new, and longer");
});

test("a mtime that moved without the bytes changing is not a change", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	const source = put(from, "board.css", ".card{}");
	syncRuntimeLib(from, to);

	// What a fresh clone or an `npm ci` does. An mtime comparison would rewrite the
	// whole of lib/ here and reload every board on screen for nothing.
	const later = new Date(Date.now() + 60_000);
	utimesSync(source, later, later);

	assert.deepEqual(syncRuntimeLib(from, to).written, []);
});

test("same size, different bytes is still a change", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "board.js", "aaaa");
	syncRuntimeLib(from, to);
	put(from, "board.js", "bbbb");

	assert.deepEqual(syncRuntimeLib(from, to).written, ["board.js"]);
});

test("a file this build no longer ships is removed", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "pdf.min.mjs", "v5");
	syncRuntimeLib(from, to);
	// The case this exists for: pdf.js renames a file between versions, and the
	// leftover is a version mismatch that fails at the moment a paper is opened.
	put(to, "pdf.worker.min.mjs", "v4, orphaned");

	const sync = syncRuntimeLib(from, to);

	assert.deepEqual(sync.removed, ["pdf.worker.min.mjs"]);
	assert.equal(statExists(join(to, "pdf.worker.min.mjs")), false);
});

test("a directory this build dropped goes, and names what was in it", () => {
	const from = dir("from");
	const to = join(dir("deck"), "lib");
	put(from, "board.js", "runtime");
	put(to, "wasm/openjpeg.wasm", "gone upstream");
	put(to, "wasm/licenses/LICENSE", "gone too");

	const sync = syncRuntimeLib(from, to);

	assert.deepEqual(sync.removed.sort(), ["wasm/licenses/LICENSE", "wasm/openjpeg.wasm"]);
	assert.equal(statExists(join(to, "wasm")), false);
});

test("a missing runtime lib is refused, not treated as an empty one", () => {
	const to = join(dir("deck"), "lib");
	put(to, "board.css", "the deck's working primitives");

	// A broken install must not be able to prune a deck down to nothing.
	const sync = syncRuntimeLib(join(dir("from"), "does-not-exist"), to);

	assert.deepEqual(sync, { written: [], removed: [], same: 0 });
	assert.equal(readFileSync(join(to, "board.css"), "utf8"), "the deck's working primitives");
});

function statExists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}
