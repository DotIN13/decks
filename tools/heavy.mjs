#!/usr/bin/env node
// Runs one heavy job at a time: node tools/heavy.mjs [--wait] -- <command ...>
// Takes the lock, refuses under 8 GB of free disk, runs the command, always releases.
// REWRITE_AGENT names the owner. HEAVY_LOCK, HEAVY_MIN_GB and HEAVY_FREE_GB (a fake free size) are for tests.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { mkdirSync, readFileSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";

const LOCK = process.env.HEAVY_LOCK || "/tmp/decks-rewrite-heavy.lock";
const MIN_GB = Number(process.env.HEAVY_MIN_GB || 8);
const STALE_MS = 30 * 60 * 1000;
const WAIT_MS = 10 * 1000;
const BUSY = 75;

export function freeGb() {
	if (process.env.HEAVY_FREE_GB) return Number(process.env.HEAVY_FREE_GB);
	const fs = statfsSync("/System/Volumes/Data", { bigint: false });
	return (fs.bavail * fs.bsize) / 1024 ** 3;
}

function holder() {
	try {
		const age = Date.now() - statSync(LOCK).mtimeMs;
		let owner = "unknown";
		try { owner = readFileSync(`${LOCK}/owner`, "utf8").trim(); } catch {}
		return { owner, minutes: Math.round(age / 60000), stale: age > STALE_MS };
	} catch { return null; }
}

function take() {
	try { mkdirSync(LOCK); } catch (e) { if (e.code === "EEXIST") return false; throw e; }
	writeFileSync(`${LOCK}/owner`, `${process.env.REWRITE_AGENT || "someone"} ${new Date().toISOString()} pid ${process.pid}\n`);
	return true;
}

const release = () => rmSync(LOCK, { recursive: true, force: true });

async function acquire(wait) {
	for (;;) {
		if (take()) return true;
		const h = holder();
		const who = h ? `${h.owner}, ${h.minutes} min` : "just released";
		if (h?.stale) console.error(`heavy: the lock is stale (${who}). Tell Mason; do not break it.`);
		if (!wait) { console.error(`heavy: the lock is held (${who}). Wait, or pass --wait.`); return false; }
		console.error(`heavy: waiting for the lock (${who})`);
		await new Promise((r) => setTimeout(r, WAIT_MS));
	}
}

function run(cmd) {
	return new Promise((resolve) => {
		const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" });
		const forward = (sig) => child.kill(sig);
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, forward);
		child.on("error", (e) => { console.error(`heavy: could not start ${cmd[0]}: ${e.message}`); resolve(127); });
		child.on("exit", (code, sig) => resolve(code ?? 128 + (constants.signals[sig] || 1)));
	});
}

async function main(argv) {
	const dash = argv.indexOf("--");
	const cmd = dash < 0 ? [] : argv.slice(dash + 1);
	if (!cmd.length) { console.error("usage: node tools/heavy.mjs [--wait] -- <command ...>"); return 2; }
	const free = freeGb();
	if (free < MIN_GB) {
		console.error(`heavy: only ${free.toFixed(1)} GB free, under ${MIN_GB} GB. Free disk, then tell Mason.`);
		return 3;
	}
	if (!(await acquire(argv.slice(0, Math.max(dash, 0)).includes("--wait")))) return BUSY;
	process.on("exit", release);
	try { return await run(cmd); } finally { release(); }
}

process.exitCode = await main(process.argv.slice(2));
