import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSeries } from "./series.ts";

/*
 * The one property that matters, asserted the only way it can be: by counting how many are
 * in flight. A test of the *results* would pass just as well with `Promise.all`, which is
 * exactly the change this exists to prevent.
 */
test("nothing overlaps, however slow the middle one is", async () => {
	let running = 0;
	let mostAtOnce = 0;
	const order: number[] = [];
	const out = await mapSeries([10, 20, 30], async (item, index) => {
		running += 1;
		mostAtOnce = Math.max(mostAtOnce, running);
		order.push(index);
		await new Promise((resolve) => setTimeout(resolve, index === 1 ? 20 : 1));
		running -= 1;
		return item * 2;
	});
	assert.equal(mostAtOnce, 1, "one subprocess at a time is the whole point");
	assert.deepEqual(order, [0, 1, 2], "and in the order given, so a list does not shuffle itself");
	assert.deepEqual(out, [20, 40, 60]);
});

test("an empty list is no work and no error", async () => {
	assert.deepEqual(await mapSeries([], async () => 1), []);
});

test("a rejection stops the rest, rather than starting them anyway", async () => {
	const started: number[] = [];
	await assert.rejects(
		mapSeries([1, 2, 3], async (item) => {
			started.push(item);
			if (item === 2) throw new Error("no");
			return item;
		}),
		/no/,
	);
	assert.deepEqual(started, [1, 2], "the third was never begun");
});
