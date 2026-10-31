import { test } from "node:test";
import assert from "node:assert/strict";
import { libFile, passes } from "../src/index.ts";

test("lib serves board.css and board.js, and nothing outside", () => {
	assert.match(libFile("board.css")!.type, /text\/css/);
	assert.ok(libFile("board.js")!.bytes.length > 1000);
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
