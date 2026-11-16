// The runner's bookkeeping between runs: a dead run's programs on a slot, ended by the slot's next holder
// (endLeftovers), and the refusals a check's server gave a pass, counted by what was refused (refusalsOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a dead run's programs on a slot are ended by the slot's next holder", async () => {
	const dir = mkdtempSync(join(tmpdir(), "leftovers-"));
	process.env.HEAVY_LOCK = join(dir, "heavy.lock");
	const { endLeftovers } = await import("./run.mjs");
	const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
	try {
		writeFileSync(`${process.env.HEAVY_LOCK}.programs-1.json`, JSON.stringify([orphan.pid]));
		const exited = new Promise((done) => orphan.once("exit", done));
		assert.deepEqual(endLeftovers(1), [String(orphan.pid)]);
		await exited;
		assert.deepEqual(endLeftovers(1), [], "the list is gone once ended");
	} finally {
		try { process.kill(-orphan.pid, "SIGKILL"); } catch {}
		rmSync(dir, { recursive: true, force: true });
		delete process.env.HEAVY_LOCK;
	}
});

test("a check's refusals are counted by what was refused", async () => {
	const dir = mkdtempSync(join(tmpdir(), "refusals-"));
	try {
		const { refusalsOf } = await import("./run.mjs");
		const file = join(dir, "refusals.jsonl");
		writeFileSync(file, [{ call: "file.read" }, { route: "POST /compat/snapshot" }, { call: "file.read" }].map((one) => JSON.stringify(one)).join("\n") + "\nnot json\n");
		assert.deepEqual(refusalsOf(file), [["file.read", 2], ["POST /compat/snapshot", 1]]);
		assert.deepEqual(refusalsOf(join(dir, "none.jsonl")), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
