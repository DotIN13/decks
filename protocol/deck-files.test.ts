import { test } from "node:test";
import assert from "node:assert/strict";
import { cardMeta, IMPORT_MAP, importMap } from "./deck-files.ts";

// A card's meta tag and the deck's import map, read one way.

test("a card's meta tag: its name, what it holds and its size", () => {
	const meta = cardMeta(`<title>T</title>\n<meta name="card" content='{"w":800,"h":0,"x":1}' />\n<p>hi</p>`);
	assert.deepEqual(meta, { tag: `<meta name="card" content='{"w":800,"h":0,"x":1}' />`, name: "card", given: { w: 800, h: 0, x: 1 }, w: 800 });
	assert.equal(cardMeta(`<meta name="older" content='{"w":600}'>`)?.name, "older");
	assert.deepEqual(cardMeta(`<meta name="card" content='{nope'>`)?.given, {});
	assert.equal(cardMeta("<p>no tag</p>"), undefined);
});

test("the import map, at assets/importmap.json: https kept, ./x, /x and x under assets/, what climbs or hides dropped", () => {
	const text = JSON.stringify({
		imports: { dot: "./libs/a.js", root: "/libs/b.js", bare: "libs/c.js", up: "libs/../x.js", cdn: "https://cdn.example/a.js", out: "../secret.js", hid: ".git/x", n: 3 },
	});
	assert.deepEqual(importMap(text), { dot: "assets/libs/a.js", root: "assets/libs/b.js", bare: "assets/libs/c.js", up: "assets/x.js", cdn: "https://cdn.example/a.js" });
	assert.equal(IMPORT_MAP, "assets/importmap.json");
	assert.deepEqual(importMap(undefined), {});
	assert.deepEqual(importMap("not json"), {});
	assert.deepEqual(importMap('{"imports":[]}'), {});
});
