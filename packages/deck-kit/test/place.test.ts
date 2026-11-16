import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerOf, GAP, placeBy } from "../src/place.ts";
import { cardShell, slug } from "../src/cards.ts";

test("beside and below sit 160 px clear, tops or lefts aligned", () => {
	assert.equal(GAP, 160);
	assert.deepEqual(placeBy({ x: 100, y: 50, w: 900, h: 400 }, "beside"), { x1: 1160, y1: 50 });
	assert.deepEqual(placeBy({ x: 100, y: 50, w: 900, h: 400 }, "below"), { x1: 100, y1: 610 });
});

test("a corner is { x1, y1 } or { x, y }, rounded; nothing given is nothing, and words are refused", () => {
	assert.deepEqual(cornerOf({ x1: 10.4, y1: 20.6 }), { x1: 10, y1: 21 });
	assert.deepEqual(cornerOf({ x: 1, y: 2 }), { x1: 1, y1: 2 });
	assert.equal(cornerOf(undefined), undefined);
	assert.throws(() => cornerOf({ x1: "10", y1: 0 }), /top-left corner/);
});

test("a card's folder is its title as one word, cut at a word; a new card starts with its title and size", () => {
	assert.equal(slug("Sales are up 12% this quarter", 48), "sales-are-up-12-this-quarter");
	assert.equal(slug("reading panel css and measuring", 24), "reading-panel-css-and");
	assert.equal(slug("水墨 花卉", 20), "水墨-花卉");
	const shell = cardShell("Sales <up>", { w: 900 });
	assert.match(shell, /^<title>Sales &lt;up><\/title>\n<meta name="card" content='\{"w":900\}' \/>/);
	assert.match(shell, /<div class="doc" data-id="doc">\n\t<h1>Sales &lt;up><\/h1>/);
	assert.match(shell, /export default function \(card\)/);
});
