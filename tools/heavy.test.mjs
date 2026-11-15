// Tests for tools/heavy.mjs, each on its own lock in a scratch folder, with disk sizes injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEAVY = new URL("./heavy.mjs", import.meta.url).pathname;

function heavy(args, env = {}) {
	const lock = join(mkdtempSync(join(tmpdir(), "heavy-")), "lock");
	const run = (more = {}) => spawnSync(process.execPath, [HEAVY, ...args], {
		encoding: "utf8",
		env: { ...process.env, HEAVY_LOCK: lock, HEAVY_FREE_GB: "50", REWRITE_AGENT: "Test", ...env, ...more },
	});
	return { lock, run };
}

test("runs the command under the lock and releases it", () => {
	const { lock, run } = heavy(["--", "sh", "-c", `test -f "$HEAVY_LOCK/owner" && grep -q Test "$HEAVY_LOCK/owner"`]);
	const r = run();
	assert.equal(r.status, 0, r.stderr);
	assert.equal(existsSync(lock), false);
});

test("passes on the command's exit code and still releases", () => {
	const { lock, run } = heavy(["--", "sh", "-c", "exit 7"]);
	assert.equal(run().status, 7);
	assert.equal(existsSync(lock), false);
});

test("refuses while another holds the lock, and leaves that lock alone", () => {
	const { lock, run } = heavy(["--", "true"]);
	mkdirSync(lock);
	writeFileSync(join(lock, "owner"), "Other now\n");
	const r = run();
	assert.equal(r.status, 75);
	assert.match(r.stderr, /held \(Other now/);
	assert.equal(existsSync(lock), true);
});

test("refuses under 8 GB free without taking the lock", () => {
	const { lock, run } = heavy(["--", "true"], { HEAVY_FREE_GB: "3.5" });
	const r = run();
	assert.equal(r.status, 3);
	assert.match(r.stderr, /3\.5 GB free, under 8 GB/);
	assert.equal(existsSync(lock), false);
});

test("releases when the command cannot start", () => {
	const { lock, run } = heavy(["--", "no-such-command-anywhere"]);
	assert.equal(run().status, 127);
	assert.equal(existsSync(lock), false);
});

test("releases when the job is interrupted", async () => {
	const { lock } = heavy([]);
	const { spawn } = await import("node:child_process");
	const child = spawn(process.execPath, [HEAVY, "--", "sleep", "30"], {
		env: { ...process.env, HEAVY_LOCK: lock, HEAVY_FREE_GB: "50" },
	});
	while (!existsSync(join(lock, "owner"))) await new Promise((r) => setTimeout(r, 50));
	child.kill("SIGTERM");
	await new Promise((r) => child.on("exit", r));
	assert.equal(existsSync(lock), false);
});

test("without a command it prints its usage", () => {
	const r = heavy([]).run();
	assert.equal(r.status, 2);
	assert.match(r.stderr, /usage/);
});

test("waiters take the lock in the order they came", async () => {
	const { lock } = heavy([]);
	const { spawn } = await import("node:child_process");
	const { appendFileSync, readFileSync } = await import("node:fs");
	mkdirSync(lock);
	const order = join(lock, "..", "order");
	const waiter = (name) => spawn(process.execPath, [HEAVY, "--wait", "--", "sh", "-c", `echo ${name} >> "${order}"`], { env: { ...process.env, HEAVY_LOCK: lock, HEAVY_FREE_GB: "50" } });
	const a = waiter("a");
	await new Promise((r) => setTimeout(r, 300));
	const b = waiter("b");
	await new Promise((r) => setTimeout(r, 300));
	appendFileSync(order, "");
	rmSync(lock, { recursive: true });
	await Promise.all([a, b].map((c) => new Promise((r) => c.on("exit", r))));
	assert.equal(readFileSync(order, "utf8"), "a\nb\n");
});
