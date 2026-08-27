import assert from "node:assert/strict";
import { test } from "node:test";
import { runEval, safeJson } from "./eval.ts";

/** A stand-in for the real service: enough surface to prove the plumbing. */
const stage = {
	boards: async () => [{ path: "boards/a.html", title: "A" }],
	show: async (path: string) => {
		shown.push(path);
	},
	fail: async () => {
		throw new Error("no such board");
	},
};
const shown: string[] = [];

test("a top-level return is what comes back — the thing the API asks for", async () => {
	const outcome = await runEval("return 1 + 1;", stage);
	assert.equal(outcome.error, undefined);
	assert.equal(outcome.value, 2);
});

test("TypeScript is stripped, not compiled as a module", async () => {
	const outcome = await runEval(
		`const paths: string[] = (await stage.boards()).map((b: { path: string }) => b.path);\nreturn paths;`,
		stage,
	);
	assert.equal(outcome.error, undefined);
	assert.deepEqual(outcome.value, ["boards/a.html"]);
});

test("logs come back with the value", async () => {
	const outcome = await runEval(`console.log("looking"); console.warn("careful", { n: 1 }); return "done";`, stage);
	assert.deepEqual(outcome.logs, ["looking", '[warn] careful {\n  "n": 1\n}']);
	assert.equal(outcome.value, "done");
});

test("await works, and so do the stage's own errors", async () => {
	shown.length = 0;
	const ok = await runEval(`await stage.show("boards/a.html"); return "shown";`, stage);
	assert.equal(ok.value, "shown");
	assert.deepEqual(shown, ["boards/a.html"]);

	const bad = await runEval(`await stage.fail();`, stage);
	assert.match(bad.error ?? "", /no such board/);
});

test("a syntax error is reported as one, not thrown", async () => {
	const outcome = await runEval("return (;", stage);
	assert.match(outcome.error ?? "", /Could not compile/);
	assert.equal(outcome.value, undefined);
});

test("the wait is abandoned rather than hanging forever", async () => {
	const outcome = await runEval("await new Promise((resolve) => setTimeout(resolve, 5000)); return 1;", stage, 120);
	assert.equal(outcome.timedOut, true);
	assert.match(outcome.error ?? "", /Still running/);
});

test("a cycle in the returned value does not crash the report", async () => {
	const outcome = await runEval("const a: any = { name: 'a' }; a.self = a; return a;", stage);
	assert.equal(outcome.error, undefined);
	// The value is whatever the code produced; `safeJson` is what the agent reads,
	// and it is the piece that has to survive a cycle.
	assert.match(safeJson(outcome.value), /\[circular\]/);
	assert.throws(() => JSON.stringify(outcome.value), TypeError);
});
