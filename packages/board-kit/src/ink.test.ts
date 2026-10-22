import assert from "node:assert/strict";
import { test } from "node:test";
import {
	hitStroke,
	inkBounds,
	inkCommit,
	inkHistory,
	inkRedo,
	inkShaper,
	inkUndo,
	lassoPick,
	moveStroke,
	simplify,
	strokeShape,
	type InkStroke,
} from "./ink.ts";

const stroke = (id: string, points: number[], extra: Partial<InkStroke> = {}): InkStroke => ({ id, tool: "pen", color: "red", size: 4, points, ...extra });

test("a pen that pressed is an outline to fill; a mouse and a marker are a line to stroke", () => {
	const pressed = strokeShape(stroke("a", [0, 0, 0.2, 50, 0, 0.9, 100, 0, 0.4]));
	assert.equal(pressed.filled, true);
	assert.match(pressed.d, /^M.*A.*A.*Z$/, "two sides and a round cap at each end");
	const mouse = strokeShape(stroke("b", [0, 0, 0.5, 50, 10, 0.5, 100, 0, 0.5]));
	assert.deepEqual(mouse, { d: "M0 0Q50 10 75 5L100 0", filled: false });
	const marker = strokeShape(stroke("c", [0, 0, 0.1, 50, 0, 0.9], { tool: "marker" }));
	assert.equal(marker.filled, false);
	assert.equal(strokeShape(stroke("dot", [5, 5, 0.5])).d, "M5 5l0.01 0", "a dot is drawn by its round caps");
});

test("simplifying keeps the ends and the corners, and drops what sits on the line", () => {
	const line: number[] = [];
	for (let x = 0; x <= 100; x++) line.push(x, 0, 0.5);
	assert.deepEqual(simplify(line), [0, 0, 0.5, 100, 0, 0.5]);
	const corner = [0, 0, 0.5, 50, 0.1, 0.5, 100, 0, 0.5, 100, 50, 0.5, 100, 100, 0.5];
	assert.deepEqual(simplify(corner), [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5]);
	const pressed = [0, 0, 0.2, 50, 0, 0.9, 100, 0, 0.2];
	assert.deepEqual(simplify(pressed), pressed, "a point where the pressure turns is a corner of the width");
});

test("the eraser touches a stroke along its whole length, and not beside it", () => {
	const drawn = stroke("a", [0, 0, 0.5, 100, 0, 0.5]);
	assert.equal(hitStroke(drawn, 50, 3, 2), true);
	assert.equal(hitStroke(drawn, 50, 20, 2), false);
	assert.equal(hitStroke(stroke("dot", [5, 5, 0.5]), 6, 6, 2), true);
});

test("a lasso takes the strokes it goes round, and not the neighbour it brushes", () => {
	const inside = stroke("in", [20, 20, 0.5, 40, 40, 0.5, 60, 20, 0.5]);
	const brushing = stroke("brush", [90, 50, 0.5, 150, 50, 0.5, 200, 50, 0.5, 250, 50, 0.5]);
	const loop = [0, 0, 100, 0, 100, 100, 0, 100];
	assert.deepEqual(lassoPick([inside, brushing], loop), ["in"]);
	assert.deepEqual(lassoPick([inside], [0, 0, 1, 1]), [], "two points are not a loop");
});

test("bounds include the width, and a move carries every point and no pressure", () => {
	const drawn = stroke("a", [10, 10, 0.5, 30, 20, 1]);
	const box = inkBounds([drawn]);
	assert.ok(box && box.x < 10 && box.y < 10 && box.x + box.w > 30);
	assert.equal(inkBounds([]), undefined);
	assert.deepEqual(moveStroke(drawn, 5, -5).points, [15, 5, 0.5, 35, 15, 1]);
});

test("undo and redo walk the lists the drawing has been, and a new stroke ends the redo", () => {
	const a = stroke("a", [0, 0, 0.5]);
	const b = stroke("b", [1, 1, 0.5]);
	let history = inkHistory([]);
	history = inkCommit(history, [a]);
	history = inkCommit(history, [a, b]);
	history = inkUndo(history);
	assert.deepEqual(history.present, [a]);
	history = inkRedo(history);
	assert.deepEqual(history.present, [a, b]);
	history = inkUndo(inkUndo(history));
	assert.deepEqual(history.present, []);
	assert.equal(inkUndo(history), history, "nothing before the first list");
	history = inkCommit(history, [b]);
	assert.equal(inkRedo(history), history, "drawing again is a new future");
});

test("a stroke shaped as it grows is the same path, character for character, as shaped whole", () => {
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const kinds: Array<{ name: string; tool: InkStroke["tool"]; pressure: (i: number) => number; grow: number }> = [
		{ name: "a mouse", tool: "pen", pressure: () => 0.5, grow: 1 },
		{ name: "a pencil", tool: "pen", pressure: () => Math.round(rand() * 100) / 100, grow: 1 },
		{ name: "a pencil pressing only later", tool: "pen", pressure: (i) => (i < 40 ? 0.5 : 0.3 + rand() * 0.5), grow: 1 },
		{ name: "a pencil, samples coming several at once", tool: "pen", pressure: () => 0.2 + rand() * 0.7, grow: 4 },
		{ name: "a marker", tool: "marker", pressure: () => rand(), grow: 2 },
	];
	for (const kind of kinds) {
		for (const length of [1, 2, 3, 5, 600, 2000]) {
			const shaper = inkShaper();
			const points: number[] = [];
			let x = 100;
			let y = 100;
			for (let i = 0; i < length; ) {
				for (let k = 0; k < kind.grow && i < length; k++, i++) {
					// Now and then a sample on the same spot, which has no direction of its own.
					if (rand() > 0.1) {
						x += (rand() - 0.4) * 9;
						y += (rand() - 0.5) * 7;
					}
					points.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, kind.pressure(i));
				}
				const stroke = { id: "live", tool: kind.tool, color: "ink" as const, size: 4, points };
				assert.deepEqual(shaper.shape(stroke), strokeShape(stroke), `${kind.name}, ${points.length / 3} of ${length} points`);
			}
		}
	}
});

test("a shaper given other points than it last had starts again", () => {
	const shaper = inkShaper();
	const one = { id: "a", tool: "pen" as const, color: "ink" as const, size: 4, points: [0, 0, 0.5, 10, 0, 0.5, 20, 5, 0.5] };
	assert.deepEqual(shaper.shape(one), strokeShape(one));
	// Held still: the stroke becomes a line from its start, in place.
	one.points.splice(3, 6, 30, 30, 0.5);
	assert.deepEqual(shaper.shape(one), strokeShape(one));
	one.points.splice(3, 3, 40, 10, 0.5);
	assert.deepEqual(shaper.shape(one), strokeShape(one));
	const other = { ...one, points: [5, 5, 0.2, 6, 9, 0.9] };
	assert.deepEqual(shaper.shape(other), strokeShape(other));
	const bigger = { ...other, size: 9 };
	assert.deepEqual(shaper.shape(bigger), strokeShape(bigger));
});
