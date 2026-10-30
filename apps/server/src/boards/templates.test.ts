import assert from "node:assert/strict";
import { test } from "node:test";
import { boardWidth, IMPORT_MAP, WIDE_BOARD_W } from "./templates.ts";

/*
 * What a new card is made from: the width it starts at, and the libraries its head can import.
 */

test("a card's head names the libraries it may import, pinned over https", () => {
	const { imports } = JSON.parse(IMPORT_MAP) as { imports: Record<string, string> };
	for (const name of ["d3", "three", "three/addons/", "gsap", "chart.js"]) {
		assert.ok(imports[name], `can import ${name}`);
		assert.match(imports[name]!, /^https:\/\//, `${name} is a URL a browser can fetch`);
		assert.equal(imports[name]!.includes("@latest"), false, `${name} is pinned to a version`);
	}
});

test("three and its addons resolve to the same build", () => {
	const { imports } = JSON.parse(IMPORT_MAP) as { imports: Record<string, string> };
	const version = (url: string) => /three@([\d.]+)/.exec(url)?.[1];
	assert.ok(version(imports.three!), "three names a version");
	// Two builds of three in one page is a scene where an object from one is not an object from
	// the other, and the failure reads as "my code does nothing".
	assert.equal(version(imports["three/addons/"]!), version(imports.three!));
});

/*
 * The widths a card may actually be.
 *
 * 1000 is about as wide as a card is read at.
 */
test("a default width is the card's own, or the screen when the screen is smaller", () => {
	// A wide screen has no ceiling of ours: the card's own width is the answer.
	assert.equal(boardWidth(undefined, 1920), 1000);
	assert.equal(boardWidth(undefined, 3840), 1000, "and a very wide screen changes nothing");
	// A screen narrower than the default wins, which is the whole point of asking.
	assert.equal(boardWidth(undefined, 390), 390);
	// Nobody looking: the card's own width, rather than a guess about the screen.
	assert.equal(boardWidth(undefined, undefined), 1000);
	// A number somebody typed is theirs, at any size: nothing here clamps.
	assert.equal(boardWidth(1800, 390), 1800);
	assert.equal(boardWidth(2400, 1440), 2400);
});

test("no default is above the width we tell agents to aim under", () => {
	const w = boardWidth(undefined, 1920);
	assert.ok(w <= WIDE_BOARD_W, `a card defaults to ${w}, over ${WIDE_BOARD_W}`);
});
