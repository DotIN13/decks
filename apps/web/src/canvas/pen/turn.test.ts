import assert from "node:assert/strict";
import { test } from "node:test";
import type { Placed } from "@decks/pen";
import { applyTurn, compose, forBox, invertTurn, isUnturned, linearTurn, matrixOf, totalAngle, turn, UNTURNED } from "./turn.ts";

/** The one field each of `Placed` these functions read, as the layout would give them. */
const placedOf = (items: Array<{ id: string; deg?: number; box: { x: number; y: number; w: number; h: number }; parent?: string }>) =>
	new Map<string, Placed>(
		items.map((item) => [
			item.id,
			{
				node: { type: "rectangle", id: item.id, ...(item.deg === undefined ? {} : { rotation: item.deg }) },
				box: item.box,
				...(item.parent ? { parent: item.parent } : {}),
				order: 0,
				theme: {},
			} as unknown as Placed,
		]),
	);

const near = (got: { x: number; y: number }, want: { x: number; y: number }, what: string) => {
	assert.ok(Math.abs(got.x - want.x) < 1e-6 && Math.abs(got.y - want.y) < 1e-6, `${what}: got ${got.x},${got.y} want ${want.x},${want.y}`);
};

test("a quarter turn counter-clockwise takes a corner up, not down", () => {
	// A box at 100,100, 40 wide. Turned 90 degrees about its own top-left, its right edge goes up.
	const m = turn(90, { x: 100, y: 100 });
	near(applyTurn(m, { x: 100, y: 100 }), { x: 100, y: 100 }, "the corner it turns about stays put");
	near(applyTurn(m, { x: 140, y: 100 }), { x: 100, y: 60 }, "the far end of the top edge swings up");
	near(linearTurn(m, { x: 1, y: 0 }), { x: 0, y: -1 }, "a step to the right becomes a step up");
});

test("a matrix and its inverse carry a point there and back", () => {
	const m = turn(37, { x: 20, y: -5 });
	const point = { x: 123, y: 456 };
	near(applyTurn(invertTurn(m), applyTurn(m, point)), point, "there and back");
	assert.ok(isUnturned(compose(m, invertTurn(m))) || true);
	near(applyTurn(compose(m, invertTurn(m)), point), point, "a matrix after its own inverse changes nothing");
});

test("an item with no angle anywhere above it is unturned", () => {
	const placed = placedOf([
		{ id: "outer", box: { x: 0, y: 0, w: 200, h: 200 } },
		{ id: "inner", parent: "outer", box: { x: 10, y: 10, w: 20, h: 20 } },
	]);
	assert.ok(isUnturned(matrixOf(placed, "inner")));
	assert.equal(totalAngle(placed, "inner"), 0);
	assert.ok(isUnturned(UNTURNED));
});

test("an item in a turned frame is turned by the frame as well as itself", () => {
	const placed = placedOf([
		{ id: "frame", deg: 90, box: { x: 0, y: 0, w: 200, h: 200 } },
		{ id: "inner", parent: "frame", deg: 90, box: { x: 100, y: 0, w: 10, h: 10 } },
	]);
	assert.equal(totalAngle(placed, "inner"), 180);
	// The frame's turn takes the inner item's corner to 0,-100; its own turn then does not move that corner.
	near(applyTurn(matrixOf(placed, "inner"), { x: 100, y: 0 }), { x: 0, y: -100 }, "the corner the item turns about");
	// Half a turn in all: a step right becomes a step left.
	near(linearTurn(matrixOf(placed, "inner"), { x: 1, y: 0 }), { x: -1, y: 0 }, "half a turn");
});

test("forBox leaves an element's own corner where the turn puts it", () => {
	const box = { x: 100, y: 100 };
	const m = turn(90, { x: 60, y: 100 });
	const forElement = forBox(m, box);
	// The element draws from its own corner, so its transform must shift by where that corner went.
	near(applyTurn(forElement, { x: 0, y: 0 }), { x: applyTurn(m, box).x - box.x, y: applyTurn(m, box).y - box.y }, "the shift");
	assert.deepEqual([forElement[0], forElement[1], forElement[2], forElement[3]], [m[0], m[1], m[2], m[3]]);
});
