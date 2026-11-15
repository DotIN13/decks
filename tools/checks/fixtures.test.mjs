// The fixture drawings still lay out as their expected layouts say, by today's pen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { drawings, layoutOf } from "../fixtures/layouts.mjs";

test("there are a few fixture drawings, each with its layout", () => {
	const all = drawings();
	assert.ok(all.length >= 5 && all.length <= 10, `${all.length} drawings`);
	for (const d of all) assert.ok(existsSync(d.expected), `${d.name} has no layout`);
});

for (const d of drawings()) {
	test(`${d.name} lays out as expected, with no warnings`, () => {
		const now = layoutOf(readFileSync(d.pen, "utf8"));
		assert.deepEqual(now, JSON.parse(readFileSync(d.expected, "utf8")));
		assert.deepEqual(now.warnings, []);
	});
}

test("the fixture deck has its canvas and its cards", () => {
	const base = new URL("../fixtures/deck/", import.meta.url).pathname;
	assert.ok(existsSync(`${base}deck.json`));
	assert.ok(existsSync(`${base}canvases/auth-refresh/canvas.pen`));
	assert.ok(existsSync(`${base}canvases/auth-refresh/cards/plan/index.html`));
});
