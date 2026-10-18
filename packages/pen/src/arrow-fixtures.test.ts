import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arrowPoints, arrowShape, arrowStyle } from "./arrows.ts";
import type { Frame, Placed } from "./layout.ts";

/*
 * The cases the stage engine's Rust router is held to (`packages/stage/crates/scene/src/arrows.rs`,
 * its test `arrows_match_pen`): boxes, sides, join points, bends and all three routes, each with
 * the points and the path pen makes of them. A change to `arrows.ts` fails here until the file is
 * written again (`UPDATE_ARROW_FIXTURES=1`), and then fails the Rust test until the port follows.
 */
const FILE = fileURLToPath(new URL("../../stage/crates/scene/fixtures/arrows.json", import.meta.url));

function cases() {
	let seed = 7;
	const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
	const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
	const pick = <T,>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
	const box = (): Frame => ({ x: int(-400, 400) + (rand() < 0.3 ? 0.5 : 0), y: int(-300, 300), w: pick([0, 0, 40, 80, 120, 200, 33.3]), h: pick([0, 30, 60, 100, 47.5]) });
	const sides = [undefined, undefined, "top", "right", "bottom", "left"] as const;
	const out = [];
	for (let i = 0; i < 1200; i++) {
		const a = box();
		const b = rand() < 0.15 ? { ...a, x: a.x + int(-20, 20), y: a.y + int(-20, 20) } : box();
		const end = (name: string, f: Frame) => {
			if (f.w === 0 && f.h === 0 && rand() < 0.5) return [f.x, f.y];
			const side = pick(sides);
			if (!side) return name;
			return rand() < 0.5 ? { item: name, side } : { item: name, side, at: pick([0, 0.25, 0.5, 0.8, 1, 1.4, -0.2]) };
		};
		const metadata: Record<string, unknown> = { type: "decks.arrow", from: end("a", a), to: end("b", b), route: pick(["straight", "curved", "elbow", undefined]), heads: pick(["end", "both", "none", undefined]) };
		const bend = rand();
		if (bend < 0.2) metadata.bend = pick([0, 0.2, 0.5, 0.9, 1, 1.5]);
		else if (bend < 0.4) metadata.bend = [int(-80, 80), int(-80, 80)];
		const placed = new Map<string, Placed>([["a", { box: a } as Placed], ["b", { box: b } as Placed]]);
		const stroke = pick([1, 2, 2, 3.5, 4]);
		const points = arrowPoints(metadata, placed);
		const shape = points ? arrowShape(points, stroke, arrowStyle(metadata)) : undefined;
		out.push({ a, b, metadata, stroke, points, shape: shape && { x: shape.x, y: shape.y, width: shape.width, height: shape.height, geometry: shape.geometry } });
	}
	return out;
}

test("the arrow fixtures the Rust router is held to are pen's own", () => {
	const now = JSON.stringify(cases());
	if (process.env.UPDATE_ARROW_FIXTURES) writeFileSync(FILE, now);
	assert.equal(readFileSync(FILE, "utf8"), now, "arrows.ts changed: run with UPDATE_ARROW_FIXTURES=1, then make arrows.rs match");
});
