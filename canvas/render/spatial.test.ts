import assert from "node:assert/strict";
import test from "node:test";
import { BoxIndex, type Rect } from "./spatial.ts";

const touches = (a: Rect, b: Rect) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

test("a search finds exactly the boxes a scan would, in ascending order", () => {
	let seed = 7;
	const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	for (const n of [0, 1, 15, 16, 17, 300, 5000]) {
		const rects = Array.from({ length: n }, () => ({ x: random() * 1e6 - 5e5, y: random() * 1.6e6, w: 200 + random() * 1800, h: 200 + random() * 4000 }));
		const index = new BoxIndex(rects);
		for (let q = 0; q < 50; q++) {
			const view = { x: random() * 1e6 - 5e5, y: random() * 1.6e6, w: random() * 2e5, h: random() * 2e5 };
			const scan = rects.flatMap((r, i) => (touches(r, view) ? [i] : []));
			assert.deepEqual(index.search(view), scan, `n=${n}`);
		}
	}
});

test("a box sharing only an edge with the view is found", () => {
	const index = new BoxIndex([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]);
	assert.deepEqual(index.search({ x: 10, y: 0, w: 10, h: 1 }), [0, 1]);
});
