// A run killed outright leaves its programs up, each in a process group of its own; the next holder of the
// slot ends every group the dead run wrote down (run.mjs endLeftovers), so its ports are free again.
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
