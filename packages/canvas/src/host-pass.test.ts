import assert from "node:assert/strict";
import { test } from "node:test";
import { passless, passOf, withPass } from "./host.ts";

const old = "dk_cp_eyJjIjoib25lIn0.AAAA";
const now = "dk_cp_eyJjIjoib25lIiwieCI6MX0.BBBB";

test("an address on a canvas pass is kept by the address without it, so a renewed pass is the same file", () => {
	const a = `http://h/api/t/${old}/board/canvases/one/cards/a/index.m0.js`;
	const b = `http://h/api/t/${now}/board/canvases/one/cards/a/index.m0.js`;
	assert.notEqual(a, b);
	assert.equal(passless(a), passless(b));
	assert.equal(passless("http://h/api/board/x.html"), "http://h/api/board/x.html", "an address with no pass stays");
});

test("a card loaded on an older pass reads on the current one", () => {
	const a = `http://h/api/t/${old}/board/canvases/one/cards/a/data.json`;
	assert.equal(passOf(a), old);
	assert.equal(withPass(a, now), `http://h/api/t/${now}/board/canvases/one/cards/a/data.json`);
	assert.equal(withPass("http://elsewhere/x.json", now), "http://elsewhere/x.json");
});
