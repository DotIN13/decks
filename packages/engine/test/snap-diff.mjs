// The C++ snapping against `snap.ts`, the reference: thousands of moves and resizes among random
// boxes, many of them already lined up, so ties and equal gaps are common. Same shift, same guides.
// node --import tsx packages/engine/test/snap-diff.mjs
import { snapEdges, snapMove } from "../../../apps/web/src/canvas/pen/snap.ts";
import { loadPicker } from "../src/pick.ts";

const picker = await loadPicker();
let seed = 3;
// mulberry32: an LCG multiplied in doubles loses bits past 2^53 and repeats within a few hundred numbers.
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// On a coarse grid, so edges, middles and gaps line up often.
const g = () => Math.round(rand() * 40) * 10;
const box = () => ({ x: g(), y: g(), w: 10 + g() / 2, h: 10 + g() / 2 });
const same = (a, b) => JSON.stringify(a, (k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)) === JSON.stringify(b, (k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));
let failed = 0;
const cases = 20000;
for (let i = 0; i < cases; i++) {
	const targets = Array.from({ length: Math.floor(rand() * 12) }, box);
	const threshold = [2, 5, 8, 20][i % 4];
	const moving = { ...box(), x: g() + rand() * 7 - 3, y: g() + rand() * 7 - 3 };
	const want = snapMove(moving, targets, threshold);
	const got = picker.snapMove(moving, targets, threshold);
	if (!same(want, got)) {
		failed++;
		if (failed < 5) console.log("move differs", JSON.stringify({ moving, targets, threshold, want, got }).slice(0, 600));
	}
	const all = ["x1", "x2", "y1", "y2"];
	const edges = all.filter(() => rand() < 0.5);
	const b = { x1: moving.x, y1: moving.y, x2: moving.x + moving.w, y2: moving.y + moving.h };
	const wantE = snapEdges(b, edges, targets, threshold);
	const gotE = picker.snapEdges(b, edges, targets, threshold);
	if (!same(wantE, gotE)) {
		failed++;
		if (failed < 5) console.log("resize differs", JSON.stringify({ b, edges, want: wantE, got: gotE }).slice(0, 600));
	}
}
console.log(`${cases} moves and ${cases} resizes: ${failed ? `${failed} differ` : "all the same"}`);
process.exit(failed ? 1 : 0);
