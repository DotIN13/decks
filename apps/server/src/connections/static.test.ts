import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheControlFor, pickEncoding } from "./static.ts";

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
