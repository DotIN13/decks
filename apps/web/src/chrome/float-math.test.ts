import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FLOATS_KEY,
	clamp,
	clearFloats,
	fromAnchor,
	fling,
	fromSaved,
	glideMs,
	toFraction,
	loadFloats,
	saveFloat,
	settle,
	snapHome,
	toAnchor,
	velocityFrom,
	stowsRight,
	stowedAt,
	loadStowed,
	saveStowed,
	STOWED_KEY,
	type Anchor,
	type Box,
	type Saved,
} from "./float-math.ts";

const bounds: Box = { x: 100, y: 50, w: 800, h: 600 };
const size = { w: 200, h: 100 };

function fakeStorage(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
	const data: Record<string, string> = { ...initial };
	return {
		data,
		get length() {
			return Object.keys(data).length;
		},
		clear: () => {
			for (const k of Object.keys(data)) delete data[k];
		},
		getItem: (k) => (k in data ? (data[k] as string) : null),
		key: (i) => Object.keys(data)[i] ?? null,
		removeItem: (k) => {
			delete data[k];
		},
		setItem: (k, v) => {
			data[k] = String(v);
		},
	};
}

test("clamp leaves a point that is already inside alone", () => {
	assert.deepEqual(clamp({ x: 300, y: 200 }, size, bounds), { x: 300, y: 200 });
});

test("clamp pins each edge, margin in", () => {
	assert.deepEqual(clamp({ x: -50, y: 200 }, size, bounds), { x: 106, y: 200 });
	assert.deepEqual(clamp({ x: 300, y: -50 }, size, bounds), { x: 300, y: 56 });
	assert.deepEqual(clamp({ x: 2000, y: 200 }, size, bounds), { x: 100 + 800 - 200 - 6, y: 200 });
	assert.deepEqual(clamp({ x: 300, y: 2000 }, size, bounds), { x: 300, y: 50 + 600 - 100 - 6 });
	assert.deepEqual(clamp({ x: -1, y: -1 }, size, bounds, 0), { x: 100, y: 50 });
	assert.deepEqual(clamp({ x: 9999, y: 9999 }, size, bounds, 10), { x: 690, y: 540 });
});

test("clamp keeps the top-left edge when the float is bigger than the bounds", () => {
	assert.deepEqual(clamp({ x: 0, y: 0 }, { w: 2000, h: 2000 }, bounds), { x: 106, y: 56 });
});

test("snapHome inside the radius is home, outside is untouched", () => {
	const home = { x: 500, y: 300 };
	assert.deepEqual(snapHome({ x: 510, y: 310 }, home), { p: home, home: true });
	assert.deepEqual(snapHome({ x: 524, y: 300 }, home), { p: home, home: true });
	assert.deepEqual(snapHome({ x: 525, y: 300 }, home), { p: { x: 525, y: 300 }, home: false });
	// 20 across and 20 down is 28 away, outside a circle of 24 even though each axis is within it.
	assert.deepEqual(snapHome({ x: 520, y: 320 }, home), { p: { x: 520, y: 320 }, home: false });
	assert.deepEqual(snapHome({ x: 520, y: 320 }, home, 30), { p: home, home: true });
});

test("toAnchor picks the nearest corner and measures from it", () => {
	assert.deepEqual(toAnchor({ x: 110, y: 60 }, size, bounds), { anchor: "tl", dx: 10, dy: 10 });
	assert.deepEqual(toAnchor({ x: 680, y: 60 }, size, bounds), { anchor: "tr", dx: 20, dy: 10 });
	assert.deepEqual(toAnchor({ x: 110, y: 520 }, size, bounds), { anchor: "bl", dx: 10, dy: 30 });
	assert.deepEqual(toAnchor({ x: 680, y: 520 }, size, bounds), { anchor: "br", dx: 20, dy: 30 });
});

test("toAnchor and fromAnchor round-trip at every corner", () => {
	const home = { x: 0, y: 0 };
	const points = [
		{ x: 110, y: 60 },
		{ x: 680, y: 60 },
		{ x: 110, y: 520 },
		{ x: 680, y: 520 },
		{ x: 400, y: 300 },
	];
	const seen = new Set<Anchor>();
	for (const p of points) {
		const saved = toAnchor(p, size, bounds);
		assert.notEqual(saved, "home");
		if (saved !== "home" && "anchor" in saved) seen.add(saved.anchor);
		assert.deepEqual(fromAnchor(saved, size, bounds, home), p);
	}
	assert.deepEqual([...seen].sort(), ["bl", "br", "tl", "tr"]);
});

test("fromAnchor keeps the inset when the bounds change size", () => {
	const saved: Saved = { anchor: "br", dx: 20, dy: 30 };
	assert.deepEqual(fromAnchor(saved, size, { x: 0, y: 0, w: 1000, h: 800 }, { x: 0, y: 0 }), { x: 780, y: 670 });
	assert.deepEqual(fromAnchor(saved, size, { x: 0, y: 0, w: 500, h: 400 }, { x: 0, y: 0 }), { x: 280, y: 270 });
});

test("fromAnchor at home is wherever home is now", () => {
	assert.deepEqual(fromAnchor("home", size, bounds, { x: 7, y: 8 }), { x: 7, y: 8 });
});

test("save and load with a fake storage", () => {
	const storage = fakeStorage();
	saveFloat("bar", { anchor: "br", dx: 1, dy: 2 }, storage);
	saveFloat("panel", "home", storage);
	assert.deepEqual(loadFloats(storage), { bar: { anchor: "br", dx: 1, dy: 2 }, panel: "home" });
	saveFloat("bar", "home", storage);
	assert.deepEqual(loadFloats(storage), { bar: "home", panel: "home" });
	clearFloats(storage);
	assert.deepEqual(loadFloats(storage), {});
	assert.equal(storage.getItem(FLOATS_KEY), null);
});

test("load tolerates garbage and drops entries of the wrong shape", () => {
	assert.deepEqual(loadFloats(fakeStorage()), {});
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: "{not json" })), {});
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: "[1,2]" })), {});
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: "null" })), {});
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: '"home"' })), {});
	const mixed = JSON.stringify({
		ok: { anchor: "tl", dx: 3, dy: 4 },
		badAnchor: { anchor: "middle", dx: 3, dy: 4 },
		badNumber: { anchor: "tl", dx: "3", dy: 4 },
		infinite: { anchor: "tl", dx: 1e999, dy: 4 },
		word: "elsewhere",
		home: "home",
	});
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: mixed })), {
		ok: { anchor: "tl", dx: 3, dy: 4 },
		home: "home",
	});
	const broken = {
		getItem: () => {
			throw new Error("refused");
		},
	};
	assert.deepEqual(loadFloats(broken), {});
});

test("saving over garbage replaces it instead of failing", () => {
	const storage = fakeStorage({ [FLOATS_KEY]: "{not json" });
	saveFloat("bar", "home", storage);
	assert.deepEqual(loadFloats(storage), { bar: "home" });
});

test("velocityFrom measures the last window of samples, in px per ms", () => {
	const samples = [
		{ x: 0, y: 0, t: 0 },
		{ x: 10, y: 0, t: 50 },
		{ x: 60, y: 20, t: 100 },
		{ x: 110, y: 40, t: 150 },
	];
	const v = velocityFrom(samples, 150);
	// The window is the last 100ms: from t=50 to t=150, 100px right and 40px down.
	assert.deepEqual(v, { vx: 1, vy: 0.4 });
});

test("velocityFrom is zero after a pause, and with too few samples", () => {
	assert.deepEqual(velocityFrom([{ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 50 }], 400), { vx: 0, vy: 0 });
	assert.deepEqual(velocityFrom([], 0), { vx: 0, vy: 0 });
	assert.deepEqual(velocityFrom([{ x: 5, y: 5, t: 10 }], 10), { vx: 0, vy: 0 });
});

test("fling carries a throw on and leaves a placement alone", () => {
	assert.deepEqual(fling({ x: 100, y: 100 }, { vx: 0, vy: 0 }), { x: 100, y: 100 });
	assert.deepEqual(fling({ x: 100, y: 100 }, { vx: 0.1, vy: 0 }), { x: 100, y: 100 });
	const thrown = fling({ x: 100, y: 100 }, { vx: 1, vy: 0 }, 260, 640);
	assert.deepEqual(thrown, { x: 360, y: 100 });
	const capped = fling({ x: 100, y: 100 }, { vx: 10, vy: 0 }, 260, 640);
	assert.deepEqual(capped, { x: 740, y: 100 });
});

test("settle goes home from further away than a plain snap", () => {
	const home = { x: 400, y: 500 };
	assert.deepEqual(settle({ x: 450, y: 540 }, size, bounds, home), { p: home, home: true });
	assert.equal(settle({ x: 500, y: 540 }, size, bounds, home).home, false);
});

test("settle takes an edge it comes close to, and clamps a throw past it", () => {
	const home = { x: 400, y: 500 };
	// 20px from the left margin (100 + 12): taken to it.
	assert.deepEqual(settle({ x: 132, y: 300 }, size, bounds, home).p, { x: 112, y: 300 });
	// Thrown past the right edge: clamped to the margin.
	assert.deepEqual(settle({ x: 2000, y: 300 }, size, bounds, home).p, { x: 100 + 800 - 200 - 12, y: 300 });
	// Well inside and far from every edge: untouched.
	assert.deepEqual(settle({ x: 300, y: 300 }, size, bounds, home).p, { x: 300, y: 300 });
});

test("glideMs grows with the distance, within its limits", () => {
	assert.equal(glideMs({ x: 0, y: 0 }, { x: 0, y: 0 }), 180);
	assert.equal(glideMs({ x: 0, y: 0 }, { x: 100, y: 0 }), 240);
	assert.equal(glideMs({ x: 0, y: 0 }, { x: 2000, y: 0 }), 420);
});

test("toFraction and fromSaved round-trip, and the ends are the margins", () => {
	const p = { x: 300, y: 200 };
	const saved = toFraction(p, size, bounds);
	assert.deepEqual(fromSaved(saved, size, bounds, { x: 0, y: 0 }), p);
	assert.deepEqual(toFraction({ x: 106, y: 56 }, size, bounds), { fx: 0, fy: 0 });
	assert.deepEqual(toFraction({ x: 100 + 800 - 200 - 6, y: 50 + 600 - 100 - 6 }, size, bounds), { fx: 1, fy: 1 });
	// Off the edge is clamped to the edge, so a stale save cannot put a float outside.
	assert.deepEqual(toFraction({ x: -500, y: 9000 }, size, bounds), { fx: 0, fy: 1 });
});

test("a narrower column moves a float by its share of the change", () => {
	// Centred in an 800px column with a 200px float: fx = 0.5.
	const saved = toFraction({ x: 400, y: 200 }, size, bounds);
	assert.equal((saved as { fx: number }).fx, 0.5);
	// The sidebar opens: 264px less room on the left. Home (the centre) moves by 132; so
	// does a float at the centre, and one against the right edge does not move at all.
	const narrower: Box = { x: 364, y: 50, w: 536, h: 600 };
	assert.equal(fromSaved(saved, size, narrower, { x: 0, y: 0 }).x, 364 + 6 + 0.5 * (536 - 200 - 12));
	const atRight = toFraction({ x: 694, y: 200 }, size, bounds);
	assert.equal(fromSaved(atRight, size, narrower, { x: 0, y: 0 }).x, 694);
});

test("a bottom-pinned share keeps the bottom edge when the float's height changes", () => {
	const tall = { w: 200, h: 164 };
	const short = { w: 200, h: 128 };
	const p = { x: 300, y: 400 };
	const saved = toFraction(p, tall, bounds, 6, "bottom");
	assert.deepEqual(fromSaved(saved, tall, bounds, { x: 0, y: 0 }, 6, "bottom"), p);
	// 36px shorter: the top moves down by 36 and the bottom edge (564) stays.
	const shorter = fromSaved(saved, short, bounds, { x: 0, y: 0 }, 6, "bottom");
	assert.equal(Math.round(shorter.y + short.h), p.y + tall.h);
	// Against the bottom margin is 1, whatever the height.
	assert.equal((toFraction({ x: 0, y: 50 + 600 - 6 - 164 }, tall, bounds, 6, "bottom") as { fy: number }).fy, 1);
});

test("the older corner form is still read", () => {
	const saved: Saved = { anchor: "br", dx: 10, dy: 20 };
	assert.deepEqual(fromSaved(saved, size, bounds, { x: 0, y: 0 }), fromAnchor(saved, size, bounds, { x: 0, y: 0 }));
	assert.deepEqual(loadFloats(fakeStorage({ [FLOATS_KEY]: JSON.stringify({ a: { fx: 0.2, fy: 0.9 }, b: saved, c: { fx: "no" } }) })), { a: { fx: 0.2, fy: 0.9 }, b: saved });
});

test("a hard throw at the right edge puts the float away, and nothing gentler does", () => {
	// bounds end at x 900; the float is 200 wide and stands at 500, so its edge is 200 short.
	const p = { x: 500, y: 300 };
	assert.equal(stowsRight(p, { vx: 2, vy: 0.2 }, size, bounds), true);
	// Placed, not thrown: no velocity, even standing against the edge.
	assert.equal(stowsRight({ x: 688, y: 300 }, { vx: 0, vy: 0 }, size, bounds), false);
	// A gentle throw to the right parks it against the edge; that is `settle`'s job.
	assert.equal(stowsRight(p, { vx: 0.8, vy: 0 }, size, bounds), false);
	// Fast, but down into the corner rather than at the side.
	assert.equal(stowsRight(p, { vx: 1.5, vy: 1.4 }, size, bounds), false);
	// Fast and sideways, the wrong way.
	assert.equal(stowsRight(p, { vx: -3, vy: 0 }, size, bounds), false);
	// Fast, but from so far away that carried on it never reaches the edge.
	assert.equal(stowsRight({ x: 100, y: 300 }, { vx: 1.3, vy: 0 }, size, { x: 0, y: 0, w: 2000, h: 600 }), false);
});

test("a stowed float shows only its tab, and stays inside the height", () => {
	assert.deepEqual(stowedAt(300, size, bounds, 36), { x: 864, y: 300 });
	assert.deepEqual(stowedAt(5000, size, bounds, 36), { x: 864, y: 538 });
});

test("what is put away is remembered, taken out again, and garbage is nothing", () => {
	const storage = fakeStorage();
	saveStowed("composer", 0.75, storage);
	assert.deepEqual(loadStowed(storage), { composer: 0.75 });
	saveStowed("composer", undefined, storage);
	assert.deepEqual(loadStowed(storage), {});
	assert.deepEqual(loadStowed(fakeStorage({ [STOWED_KEY]: "{not json" })), {});
	assert.deepEqual(loadStowed(fakeStorage({ [STOWED_KEY]: '{"a":"x","b":4}' })), { b: 1 });
});
