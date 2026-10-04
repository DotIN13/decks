import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { libVersion, splitLibVersion, versionLibRefs } from "./lib-version.ts";

test("a board's references into lib/ get the version, at any depth, and nothing else does", () => {
	const html = `<link rel="stylesheet" href="../lib/board.css" />
<script src='../../lib/board.js'></script>
<link href="/api/lib/board.css">
<img src="../assets/photo.png">
<pre>&lt;link href=&quot;../lib/board.css&quot;&gt;</pre>
<p>see ../lib/board.js</p>
<script src="../lib/~old/board.js"></script>`;
	const out = versionLibRefs(html, "ab12");
	assert.match(out, /href="\.\.\/lib\/~ab12\/board\.css"/);
	assert.match(out, /src='\.\.\/\.\.\/lib\/~ab12\/board\.js'/);
	assert.match(out, /href="\/api\/lib\/~ab12\/board\.css"/);
	assert.match(out, /src="\.\.\/assets\/photo\.png"/);
	assert.match(out, /&quot;\.\.\/lib\/board\.css&quot;/, "escaped text is left alone");
	assert.match(out, /see \.\.\/lib\/board\.js/, "prose is left alone");
	assert.match(out, /src="\.\.\/lib\/~old\/board\.js"/, "an address that already has a version keeps it");
});

test("a versioned path splits into its version and its file", () => {
	assert.deepEqual(splitLibVersion("~ab12/type/Inter.woff2"), { version: "ab12", file: "type/Inter.woff2" });
	assert.equal(splitLibVersion("board.css"), undefined);
	assert.equal(splitLibVersion("~ab12"), undefined);
});

test("the version follows what lib/ holds", () => {
	const deck = mkdtempSync(join(tmpdir(), "lib-version-"));
	mkdirSync(join(deck, "lib", "type"), { recursive: true });
	writeFileSync(join(deck, "lib", "board.js"), "one");
	writeFileSync(join(deck, "lib", "type", "a.woff2"), "x");
	const first = libVersion(deck, 1_000);
	assert.equal(libVersion(deck, 1_500), first, "trusted for a moment");
	writeFileSync(join(deck, "lib", "board.js"), "two, longer");
	assert.notEqual(libVersion(deck, 10_000), first, "a changed file is a new version");
});
