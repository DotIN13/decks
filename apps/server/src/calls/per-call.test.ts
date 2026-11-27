import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { inCall, verbContext } from "./context.ts";

/*
 * One caller's calls run at once (the person's tabs and canvas frames share one tool), so each call's
 * notes, pictures and canvas are its own (`inCall`): a call started in the middle of another neither
 * empties its notes nor changes the canvas it means.
 */
test("two calls at once keep their own canvas and their own notes", async () => {
	const ctx = verbContext({
		canvas: { pens: { has: () => true } } as never,
		agent: { id: "person", person: true, stageName: () => "home" } as never,
		port: 0,
	});
	const call = (canvas: string, wait: number) =>
		inCall(canvas, async (frame) => {
			await sleep(wait);
			ctx.notes.push(`said on ${canvas}`);
			const before = ctx.hereCanvas();
			await sleep(5);
			return { before, after: ctx.hereCanvas(), notes: [...frame.notes] };
		});
	const [a, b] = await Promise.all([call("a", 15), call("b", 0)]);
	assert.deepEqual(a, { before: "a", after: "a", notes: ["said on a"] });
	assert.deepEqual(b, { before: "b", after: "b", notes: ["said on b"] });
	assert.equal(ctx.hereCanvas(), "home", "outside any call, the person's own canvas");
});
