#!/usr/bin/env node
// Heavy jobs take turns: node tools/heavy.mjs [--wait] [--class check] -- <command ...>
// exclusive (the default): builds, installs, the whole type check; runs alone. check: a browser check; two at once.
// Refuses under 8 GB free; always releases. REWRITE_AGENT names the owner; HEAVY_LOCK, HEAVY_MIN_GB, HEAVY_FREE_GB are for tests.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";

const LOCK = () => process.env.HEAVY_LOCK || "/tmp/decks-rewrite-heavy.lock";

const MIN_GB = () => Number(process.env.HEAVY_MIN_GB || 8);

export const CHECK_SLOTS = 2;

const STALE_MS = 30 * 60 * 1000;

const WAIT_MS = 2 * 1000;

const BUSY = 75;

/** The slot folders: slot 0, the exclusive one, is the lock itself as before; check slots sit beside it. */
const slotDir = (slot) => (slot === 0 ? LOCK() : `${LOCK()}.check-${slot}`);

const CHECKS = Array.from({ length: CHECK_SLOTS }, (_, i) => i + 1);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const ownerOf = (dir) => { try { return readFileSync(`${dir}/owner`, "utf8").trim(); } catch { return ""; } };

/** A slot of a class: { slot, release }, waiting in turn; undefined when not waiting and none is free. */
export async function acquire({ cls = "exclusive", wait = true } = {}) {
	const queue = `${LOCK()}.queue`;
	const got = (slot) => {
		const release = () => rmSync(slotDir(slot), { recursive: true, force: true });
		process.on("exit", release);
		return { slot, release };
	};
	if (!wait) {
		const slot = take(cls);
		return slot === undefined ? undefined : got(slot);
	}
	mkdirSync(queue, { recursive: true });
	const ticket = `${String(Date.now()).padStart(15, "0")}-${process.pid}-${Math.random().toString(36).slice(2, 6)}-${cls}`;
	writeFileSync(`${queue}/${ticket}`, "");
	const leave = () => rmSync(`${queue}/${ticket}`, { force: true });
	process.on("exit", leave);
	for (let round = 0; ; round++) {
		const slot = mayTry(queue, ticket, cls) ? take(cls) : undefined;
		if (slot !== undefined) return leave(), got(slot);
		if (round % 15 === 0) console.error(`heavy: waiting for a ${cls} slot (${holders().join("; ") || "just released"})`);
		await new Promise((r) => setTimeout(r, WAIT_MS));
	}
}

/** Run work holding a slot of the class; the slot is released whatever happens. */
export async function withSlot(cls, work) {
	const got = await acquire({ cls });
	try { return await work(got.slot); } finally { got.release(); }
}

/** Tickets in order: the oldest may go; a check may also go while every older ticket is a check. */
function mayTry(queue, ticket, cls) {
	const live = readdirSync(queue).sort().filter((name) => alive(Number(name.split("-")[1])) || (rmSync(`${queue}/${name}`, { force: true }), false));
	const older = live.slice(0, live.indexOf(ticket));
	return older.length === 0 || (cls === "check" && older.every((name) => name.endsWith("-check")));
}

/** Take a free slot of the class, then back off if the other class holds one, so the two never overlap. */
function take(cls) {
	for (const slot of cls === "check" ? CHECKS : [0]) {
		try { mkdirSync(slotDir(slot)); } catch (e) { if (e.code === "EEXIST" && held(slot)) continue; if (e.code !== "EEXIST") throw e; continue; }
		writeFileSync(`${slotDir(slot)}/owner`, `${process.env.REWRITE_AGENT || "someone"} ${cls} ${new Date().toISOString()} pid ${process.pid}\n`);
		const clash = cls === "check" ? held(0) : CHECKS.some(held);
		if (clash) { rmSync(slotDir(slot), { recursive: true, force: true }); return undefined; }
		return slot;
	}
	return undefined;
}

/** Whether a slot is held: its folder is there and its owner still runs; a dead owner's folder is cleared. */
function held(slot) {
	const dir = slotDir(slot);
	if (!existsSync(dir)) return false;
	const pid = Number(/pid (\d+)/.exec(ownerOf(dir))?.[1]);
	if (pid && !alive(pid)) return void rmSync(dir, { recursive: true, force: true }), false;
	return true;
}

function holders() {
	return [0, ...CHECKS].filter((s) => existsSync(slotDir(s))).map((s) => {
		const minutes = Math.round((Date.now() - statSync(slotDir(s)).mtimeMs) / 60000);
		return `${ownerOf(slotDir(s)).split(" ").slice(0, 2).join(" ")}, ${minutes} min${minutes * 60000 > STALE_MS ? " (stale: tell Mason)" : ""}`;
	});
}

export function freeGb() {
	if (process.env.HEAVY_FREE_GB) return Number(process.env.HEAVY_FREE_GB);
	const fs = statfsSync("/System/Volumes/Data", { bigint: false });
	return (fs.bavail * fs.bsize) / 1024 ** 3;
}

function run(cmd, cls) {
	return new Promise((resolve) => {
		const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env: { ...process.env, HEAVY_HELD: cls } });
		const forward = (sig) => child.kill(sig);
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, forward);
		child.on("error", (e) => { console.error(`heavy: could not start ${cmd[0]}: ${e.message}`); resolve(127); });
		child.on("exit", (code, sig) => resolve(code ?? 128 + (constants.signals[sig] || 1)));
	});
}

async function main(argv) {
	const dash = argv.indexOf("--");
	const cmd = dash < 0 ? [] : argv.slice(dash + 1);
	const flags = argv.slice(0, Math.max(dash, 0));
	if (!cmd.length) { console.error("usage: node tools/heavy.mjs [--wait] [--class check] -- <command ...>"); return 2; }
	const free = freeGb();
	if (free < MIN_GB()) {
		console.error(`heavy: only ${free.toFixed(1)} GB free, under ${MIN_GB()} GB. Free disk, then tell Mason.`);
		return 3;
	}
	const cls = flags.includes("--class") && flags[flags.indexOf("--class") + 1] === "check" ? "check" : "exclusive";
	const got = await acquire({ cls, wait: flags.includes("--wait") });
	if (!got) { console.error(`heavy: the lock is held (${holders().join("; ")}). Wait, or pass --wait.`); return BUSY; }
	try { return await run(cmd, cls); } finally { got.release(); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv.slice(2));
