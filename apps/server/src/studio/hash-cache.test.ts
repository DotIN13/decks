import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HashCache, sha256 } from "./hash-cache.ts";

test("a file is hashed again only when its size or time changes, or when asked to check afresh, and the cache outlives the process", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-hash-cache-"));
	try {
		const file = join(dir, "a.txt");
		writeFileSync(file, "one");
		const cache = new HashCache(join(dir, "hashes.json"));
		assert.equal(cache.hash(file)!.hash, sha256(Buffer.from("one")));
		assert.equal(cache.cost.files, 1);
		assert.equal(cache.hash(file)!.bytes, undefined, "unchanged: not read");
		assert.equal(cache.cost.files, 1);

		writeFileSync(file, "two!");
		assert.equal(cache.hash(file)!.hash, sha256(Buffer.from("two!")), "a new size");
		// Same size, time put back: only a fresh check sees it.
		const t = new Date(Date.now() - 60_000);
		utimesSync(file, t, t);
		cache.hash(file);
		writeFileSync(file, "six!");
		utimesSync(file, t, t);
		assert.equal(cache.hash(file)!.hash, sha256(Buffer.from("two!")));
		assert.equal(cache.hash(file, true)!.hash, sha256(Buffer.from("six!")));
		cache.save();

		const again = new HashCache(join(dir, "hashes.json"));
		assert.equal(again.hash(file)!.bytes, undefined, "kept between runs");
		assert.equal(again.hash(join(dir, "gone.txt")), undefined);
		again.prune();
		assert.equal(again.size, 1);
		again.prune();
		assert.equal(again.size, 0, "a file no pass looked at is forgotten");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
