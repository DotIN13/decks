import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { libVersion, splitLibVersion, versionLibRefs } from "./lib-version.ts";

test("a card's references into lib/ get the version, at any depth, and nothing else does", () => {
	const html = `<link rel="stylesheet" href="../lib/card.css" />
<script src='../../lib/card.js'></script>
<link href="/api/lib/card.css">
<img src="../assets/photo.png">
<pre>&lt;link href=&quot;../lib/card.css&quot;&gt;</pre>
<p>see ../lib/card.js</p>
<script src="../lib/~old/card.js"></script>`;
	const out = versionLibRefs(html, "ab12");
	assert.match(out, /href="\.\.\/lib\/~ab12\/card\.css"/);
	assert.match(out, /src='\.\.\/\.\.\/lib\/~ab12\/card\.js'/);
	assert.match(out, /href="\/api\/lib\/~ab12\/card\.css"/);
	assert.match(out, /src="\.\.\/assets\/photo\.png"/);
	assert.match(out, /&quot;\.\.\/lib\/card\.css&quot;/, "escaped text is left alone");
	assert.match(out, /see \.\.\/lib\/card\.js/, "prose is left alone");
	assert.match(out, /src="\.\.\/lib\/~old\/card\.js"/, "an address that already has a version keeps it");
});

test("a versioned path splits into its version and its file", () => {
	assert.deepEqual(splitLibVersion("~ab12/type/Inter.woff2"), { version: "ab12", file: "type/Inter.woff2" });
	assert.equal(splitLibVersion("card.css"), undefined);
	assert.equal(splitLibVersion("~ab12"), undefined);
});

test("the version follows what lib/ holds", () => {
	const deck = mkdtempSync(join(tmpdir(), "lib-version-"));
	mkdirSync(join(deck, "lib", "type"), { recursive: true });
	writeFileSync(join(deck, "lib", "card.js"), "one");
	writeFileSync(join(deck, "lib", "type", "a.woff2"), "x");
	const first = libVersion(deck, 1_000);
	assert.equal(libVersion(deck, 1_500), first, "trusted for a moment");
	writeFileSync(join(deck, "lib", "card.js"), "two, longer");
	assert.notEqual(libVersion(deck, 10_000), first, "a changed file is a new version");
});
