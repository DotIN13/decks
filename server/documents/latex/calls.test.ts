import assert from "node:assert/strict";
import { test } from "node:test";
import { testServer } from "../../kernel/testing.ts";
import type { RunJob } from "../../kernel/types.ts";
import { documents } from "../feature.ts";

// file.compile and the git calls through the router, in the documents feature: answers checked
// against their declared shapes, the event told, a card refused.

const PDF = new TextEncoder().encode("%PDF-1.5");

test("file.compile answers Compiled, writes the PDF and tells file.compiled", async () => {
	const jobs: RunJob[] = [];
	const server = await testServer({ features: [documents()], deck: { "papers/p.tex": "\\documentclass{article}" }, run: async (job) => (jobs.push(job), { code: 0, out: "", files: { "p.pdf": PDF } }) });
	try {
		const done = await server.value<{ ok: boolean; pdf: string }>("file.compile", { path: "papers/p.tex" }, "agent");
		assert.deepEqual([done.ok, done.pdf], [true, "docs/build/papers/p.pdf"]);
		assert.equal(jobs[0]?.cwd, "papers");
		const told = server.heard.find((h) => h.name === "file.compiled");
		assert.deepEqual(told?.payload.ids, ["papers/p.tex"]);
		assert.equal((await server.call("file.compile", { path: "papers/p.tex" }, "card")).ok, false);
	} finally {
		await server.close();
	}
});

test("with no machine, compile and the git calls are unavailable", async () => {
	const server = await testServer({ features: [documents()], deck: { "p.tex": "x" } });
	try {
		for (const name of ["file.compile", "file.repo", "file.pull", "file.push"]) {
			const answer = await server.call(name, { path: "p.tex" });
			assert.equal(answer.ok ? "ok" : answer.error.code, "unavailable", name);
		}
	} finally {
		await server.close();
	}
});

test("file.repo answers null through the router when git finds no repository", async () => {
	const server = await testServer({ features: [documents()], deck: { "p.tex": "x" }, run: async () => ({ code: 128, out: "fatal: not a git repository", files: {} }) });
	try {
		assert.equal(await server.value("file.repo", { path: "p.tex" }), null);
	} finally {
		await server.close();
	}
});
