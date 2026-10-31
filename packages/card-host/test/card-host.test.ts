import { test } from "node:test";
import assert from "node:assert/strict";
import { libFile, libName, passes } from "../src/index.ts";

test("lib serves card.css and card.js, and nothing outside", () => {
	assert.match(libFile("card.css")!.type, /text\/css/);
	assert.ok(libFile("card.js")!.bytes.length > 1000);
	// A page from before cards asks for them by their old names, and gets them.
	assert.deepEqual(libFile("board.css")!.bytes, libFile("card.css")!.bytes);
	assert.deepEqual(libFile("board.js")!.bytes, libFile("card.js")!.bytes);
	assert.equal(libName("~ab12/board.css"), "~ab12/card.css", "at a version too");
	assert.equal(libName("fonts/board.css.woff2"), "fonts/board.css.woff2");
	assert.equal(libFile("../package.json"), undefined);
	assert.equal(libFile("nope.js"), undefined);
});

test("a pass reads back only signed and unexpired", () => {
	const p = passes("k");
	const pass = p.make({ canvas: "c1", user: "u1" }, Date.now() + 1000);
	assert.deepEqual(p.read(pass), { canvas: "c1", user: "u1" });
	assert.equal(p.read(pass, Date.now() + 5000), undefined, "expired");
	assert.equal(passes("other").read(pass), undefined, "another key");
	assert.equal(p.read(pass.replace(/.$/, "x")), undefined, "tampered");
});
