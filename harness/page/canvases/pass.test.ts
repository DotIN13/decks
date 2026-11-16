import assert from "node:assert/strict";
import { test } from "node:test";

// A canvas pass is asked for once per half life; a renewal names the pass it renews.

test("a renewal sends the pass it renews, and the first ask sends none", async () => {
	const bodies: Array<Record<string, unknown>> = [];
	let n = 0;
	Object.assign(globalThis, { location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1" } });
	globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
		bodies.push(JSON.parse(init?.body ?? "{}"));
		n += 1;
		// Lives a second, so it is renewed at once on the next ask.
		return new Response(JSON.stringify({ pass: `p${n}`, expires: Date.now() + 1000 }));
	}) as typeof fetch;
	const { canvasPass } = await import("./pass.ts");
	assert.equal((await canvasPass("plan")).token, "p1");
	assert.equal((await canvasPass("plan")).token, "p2");
	assert.deepEqual(bodies, [{ canvas: "plan" }, { canvas: "plan", renewing: "p1" }]);
});
