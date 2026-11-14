import { test } from "node:test";
import assert from "node:assert/strict";
import { arr, int, lit, named, namesIn, nul, obj, opt, rec, str, union, type Infer } from "./schema.ts";
import { check } from "./validate.ts";

// A declared shape gives its TypeScript type with no second declaration,
// and checks a value against itself.

const Point = named("Point", obj({ x: int(), y: int() }));
const Thing = obj({ id: str(), at: opt(Point), tags: arr(str()), kind: lit("a", "b"), parent: opt(union(str(), nul)), extra: opt(rec(int())) });
type Thing = Infer<typeof Thing>;

test("Infer gives the type: required, optional, literal and union fields", () => {
	const ok: Thing = { id: "t", tags: [], kind: "a", parent: null, at: { x: 1, y: 2 } };
	// @ts-expect-error kind must be "a" or "b"
	const bad: Thing = { id: "t", tags: [], kind: "c" };
	assert.ok(ok && bad);
});

test("check passes a value that fits", () => {
	assert.deepEqual(check(Thing, { id: "t", tags: ["x"], kind: "b", extra: { n: 1 } }), []);
});

test("check names each problem", () => {
	const problems = check(Thing, { tags: [1], kind: "c", other: true, at: { x: 1.5, y: 0 } });
	assert.ok(problems.some((p) => p.includes("needs id")));
	assert.ok(problems.some((p) => p.includes("tags[0]")));
	assert.ok(problems.some((p) => p.includes("other")));
	assert.ok(problems.some((p) => p.includes("whole number")));
});

test("namesIn finds each named shape once", () => {
	assert.deepEqual([...namesIn(obj({ a: Point, b: arr(Point) })).keys()], ["Point"]);
});
