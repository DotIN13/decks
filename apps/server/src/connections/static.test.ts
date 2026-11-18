import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { cacheControlFor, pickEncoding, squeeze, squeezedFile } from "./static.ts";

test("a file named by its hash is kept for a year; everything else is checked", () => {
	assert.equal(cacheControlFor("/assets/index-DKZ3X5tN.js"), "public, max-age=31536000, immutable");
	assert.equal(cacheControlFor("/index.html"), "no-cache");
	assert.equal(cacheControlFor("/favicon.svg"), "no-cache");
});

test("brotli when it is offered, then gzip, and nothing when neither is", () => {
	assert.equal(pickEncoding("gzip, deflate, br, zstd"), "br");
	assert.equal(pickEncoding("gzip, deflate"), "gzip");
	assert.equal(pickEncoding("br;q=0, gzip"), "gzip");
	assert.equal(pickEncoding("identity"), undefined);
	assert.equal(pickEncoding(undefined), undefined);
	assert.equal(pickEncoding("*"), "br");
});

test("a deck's text file is squeezed for a browser that takes it, kept until the file changes, and anything else goes as it is", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-squeeze-"));
	try {
		const page = join(dir, "index.html");
		const words = "<p>The same words, many times over, as a card's page has them.</p>\n".repeat(200);
		writeFileSync(page, words);
		const br = squeezedFile(page, "gzip, deflate, br", undefined);
		assert.ok(br && br.encoding === "br" && br.type.startsWith("text/html"));
		assert.ok(br.body.length < words.length / 10, `${br.body.length} of ${words.length}`);
		assert.equal(brotliDecompressSync(br.body).toString(), words);
		// The same file again is the same squeezed copy, not squeezed twice.
		assert.equal(squeezedFile(page, "br", undefined)?.body, br.body);
		const gz = squeezedFile(page, "gzip", undefined);
		assert.equal(gz?.encoding, "gzip");
		assert.equal(gunzipSync(gz!.body).toString(), words);
		assert.notEqual(gz!.etag, br.etag, "each encoding is its own version to a cache");
		// Changed on disk: squeezed again.
		writeFileSync(page, `${words}<p>and one more line</p>`);
		assert.match(brotliDecompressSync(squeezedFile(page, "br", undefined)!.body).toString(), /one more line/);
		// Not squeezed: no encoding taken, a part of the file asked for, a small file, a picture, a file that is not there.
		assert.equal(squeezedFile(page, "identity", undefined), undefined);
		assert.equal(squeezedFile(page, "br", "bytes=0-99"), undefined);
		writeFileSync(join(dir, "small.css"), "a { color: red }");
		assert.equal(squeezedFile(join(dir, "small.css"), "br", undefined), undefined);
		writeFileSync(join(dir, "picture.png"), Buffer.alloc(5000, 7));
		assert.equal(squeezedFile(join(dir, "picture.png"), "br", undefined), undefined);
		assert.equal(squeezedFile(join(dir, "gone.js"), "br", undefined), undefined);
		// The drawing engine's module is among what is squeezed, under the type streaming compilation asks for.
		writeFileSync(join(dir, "engine.wasm"), Buffer.alloc(40_000, 3));
		assert.equal(squeezedFile(join(dir, "engine.wasm"), "br", undefined)?.type, "application/wasm");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a large body is squeezed with less effort than a small one, and comes back whole either way", () => {
	const small = Buffer.from("x".repeat(5000));
	const large = Buffer.from("abcdefghij".repeat(150_000));
	for (const raw of [small, large]) {
		assert.deepEqual(brotliDecompressSync(squeeze(raw, "br")), raw);
		assert.deepEqual(brotliDecompressSync(squeeze(raw, "br", true)), raw);
		assert.deepEqual(gunzipSync(squeeze(raw, "gzip")), raw);
	}
});
