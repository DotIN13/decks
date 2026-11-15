import assert from "node:assert/strict";
import { test } from "node:test";
import { drawnWidth, rungFor, upgrades } from "./picture-ladder.ts";

const computer = [192, 480, 800];
const ipad = [192, 480];

test("a card's rung is the smallest one stretched at most a quarter, else the top", () => {
	// A 1,100 px card on a 2× screen.
	const at = (zoom: number) => drawnWidth(1100, zoom, 2);
	assert.equal(rungFor(at(0.4), computer), 800);
	assert.equal(rungFor(at(0.3), computer), 800);
	assert.equal(rungFor(at(0.2), computer), 480);
	assert.equal(rungFor(at(0.12), computer), 480);
	assert.equal(rungFor(at(0.1), computer), 192);
	assert.equal(rungFor(at(0.05), computer), 192);
	assert.equal(rungFor(at(0.4), ipad), 480, "the top rung, stretched, when the ladder ends");
	assert.equal(rungFor(at(0.1), ipad), 192);
	// A narrow card wants less than a wide one at the same zoom.
	assert.equal(rungFor(drawnWidth(500, 0.3, 2), computer), 480);
});

test("only cards wanting a higher rung than they hold go up, nearest the middle first", () => {
	const cards = [
		{ key: "far", x: 5000, y: 0, w: 1100, h: 700 },
		{ key: "held", x: 0, y: 0, w: 1100, h: 700 },
		{ key: "near", x: 1200, y: 0, w: 1100, h: 700 },
		{ key: "small", x: 0, y: 800, w: 300, h: 200 },
	];
	const held = (key: string) => (key === "held" ? 800 : key === "small" ? 192 : 0);
	assert.deepEqual(upgrades(cards, held, { x: 500, y: 300, zoom: 0.35 }, 2, computer), [
		{ key: "near", width: 800 },
		{ key: "far", width: 800 },
	]);
	// Zoomed out, nothing held goes down, and what holds nothing gets the bottom rung.
	assert.deepEqual(upgrades(cards, held, { x: 500, y: 300, zoom: 0.05 }, 2, computer), [
		{ key: "near", width: 192 },
		{ key: "far", width: 192 },
	]);
});
