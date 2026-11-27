import assert from "node:assert/strict";
import { test } from "node:test";
import { cardWidth, IMPORT_MAP, WIDE_CARD_W } from "./size.ts";

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
	assert.equal(cardWidth(undefined, 1920), 1000);
	assert.equal(cardWidth(undefined, 3840), 1000, "and a very wide screen changes nothing");
	// A screen narrower than the default wins, which is the whole point of asking.
	assert.equal(cardWidth(undefined, 390), 390);
	// Nobody looking: the card's own width, rather than a guess about the screen.
	assert.equal(cardWidth(undefined, undefined), 1000);
	// A number somebody typed is theirs, at any size: nothing here clamps.
	assert.equal(cardWidth(1800, 390), 1800);
	assert.equal(cardWidth(2400, 1440), 2400);
});

test("no default is above the width we tell agents to aim under", () => {
	const w = cardWidth(undefined, 1920);
	assert.ok(w <= WIDE_CARD_W, `a card defaults to ${w}, over ${WIDE_CARD_W}`);
});
