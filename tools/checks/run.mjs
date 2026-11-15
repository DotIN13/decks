#!/usr/bin/env node
// Runs today's browser checks, unchanged, against the new programs: node tools/checks/run.mjs <check> ...
// Per check: Decks-local on a fresh fixture copy, the harness, and the page, each on ports of its own.
// A heavy job: node tools/heavy.mjs --wait -- node tools/checks/run.mjs <check>. Only server: --only-server.
// CHECKS_LOG_DIR=<dir> keeps each check's whole log there; CHECKS_VERBOSE=1 prints a failure's tail.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const FIXTURE = join(ROOT, "tools/fixtures/deck");
const BASE = Number(process.env.CHECKS_PORT ?? 4612);
const WAIT_MS = 60_000;
/** What one run shares: the page built once. */
const RUN = { dist: undefined };
const CHECK_MS = Number(process.env.CHECKS_TIMEOUT_MS ?? 300_000);

/** How each program starts, given its ports and the deck. Edit here when an owner changes theirs. */
export const PROGRAMS = {
	server: ({ server, deck }) => ({ cmd: process.execPath, args: ["--import", "tsx", "server/main.ts", "--deck", deck, "--port", String(server)] }),
	harness: ({ deck, home }) => ({ cmd: process.execPath, args: ["--import", "tsx", "harness/main.ts", "--deck", deck, "--kinds", "pi"], env: { PI_CODING_AGENT_DIR: join(ROOT, "e2e/fake-agent"), DECKS_DATA_DIR: home } }),
	// The built page on a plain static server with the dev server's proxy rules (page-server.mjs);
	// CHECKS_PAGE=dev runs vite's dev server instead, directly, not through npm.
	page: ({ deck, web, dist }) =>
		process.env.CHECKS_PAGE === "dev" || !dist
			? { cmd: join(ROOT, "node_modules/.bin/vite"), args: [], cwd: join(ROOT, "harness/page"), env: { DECKS_DECK: deck, DECKS_PAGE_PORT: String(web), DECKS_PAGE_COMPAT: "1" } }
			: { cmd: process.execPath, args: [join(ROOT, "tools/checks/page-server.mjs"), "--dist", dist, "--deck", deck, "--port", String(web), "--compat"] },
};

export const portsFor = (i) => ({ server: BASE + 3 * i, harness: BASE + 3 * i + 1, web: BASE + 3 * i + 2 });

/** The person's token, from the lock file the server writes in the deck. */
function personToken(deck) {
	return JSON.parse(readFileSync(join(deck, ".decks/server.json"), "utf8")).token;
}

/** The page is ready once its dev server answers /page.json. */
const pageReady = (ports) => fetch(`http://127.0.0.1:${ports.web}/page.json`).then((r) => r.ok, () => false);

/**
 * The harness listens on no port: it is ready once the server relays runtime.list to it and the
 * deck has its first agent, which the harness makes on a deck with none, as today's server did.
 */
async function harnessReady(ports, deck) {
	const post = async (name) => {
		const answer = await fetch(`http://127.0.0.1:${ports.server}/api/v1/${name}`, { method: "POST", headers: { authorization: `Bearer ${personToken(deck)}`, "content-type": "application/json" }, body: "{}" });
		return (await answer.json()) ?? {};
	};
	try {
		if ((await post("runtime.list")).ok !== true) return false;
		const agents = await post("agent.list");
		return agents.ok === true && Array.isArray(agents.value) && agents.value.length > 0;
	} catch {
		return false;
	}
}

const listening = (port) => new Promise((done) => {
	const socket = connect(port, "127.0.0.1");
	socket.once("connect", () => (socket.destroy(), done(true)));
	socket.once("error", () => done(false));
});

async function until(ready, child, name) {
	const end = Date.now() + WAIT_MS;
	while (Date.now() < end) {
		if (child.exitCode !== null) throw new Error(`${name} exited (${child.exitCode}) before it was ready`);
		if (await ready()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`${name} was not ready in ${WAIT_MS / 1000} s`);
}

/** This shell's environment without any DECKS_ variable: a check must never reach the person's own Decks. */
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DECKS_")));

/** Every program running now, so an interrupted runner leaves none behind. */
const LIVE = new Set();
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(sig, () => {
		for (const child of LIVE) signal(child, "SIGKILL");
		process.exit(130);
	});
}

function launch(name, { cmd, args, env = {}, cwd = ROOT }, log) {
	const child = spawn(cmd, args, { cwd, detached: true, env: { ...CLEAN, ...env }, stdio: ["ignore", "pipe", "pipe"] });
	LIVE.add(child);
	child.once("exit", () => LIVE.delete(child));
	// Every line tagged with its program, so a check's FAIL line is found wherever its chunk broke.
	for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => log.push(String(chunk).replace(/^(?=.)/gm, `[${name}] `)));
	return child;
}

const signal = (child, name) => {
	try { process.kill(-child.pid, name); } catch {}
};
const stop = (child) => signal(child, "SIGTERM");

/** SIGTERM to the program's whole group, then SIGKILL if it has not exited after a grace period. */
async function stopAndWait(child) {
	if (child.exitCode !== null || child.signalCode !== null) return signal(child, "SIGKILL");
	const exited = new Promise((done) => child.once("exit", done));
	stop(child);
	await Promise.race([exited, new Promise((r) => setTimeout(r, 3_000))]);
	signal(child, "SIGKILL");
}

/** The three programs up on a fresh fixture copy, work(ports, deck) run, then all stopped and the copy gone. */
/** The page built once for a run, into a scratch folder: vite build of harness/page. */
export function buildPage() {
	const dist = join(mkdtempSync(join(tmpdir(), "decks-page-")), "dist");
	const built = spawnSync(join(ROOT, "node_modules/.bin/vite"), ["build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: join(ROOT, "harness/page"), env: CLEAN, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
	if (built.status !== 0) throw new Error(`the page did not build: ${built.stderr.slice(-400)}`);
	return dist;
}

export async function runPrograms(work, { i = 0, onlyServer = false, log = [], dist = RUN.dist } = {}) {
	const ports = portsFor(i);
	for (const port of Object.values(ports)) if (await listening(port)) throw new Error(`port ${port} is in use`);
	const scratch = mkdtempSync(join(tmpdir(), "decks-e2e-"));
	const deck = join(scratch, "deck");
	const home = join(scratch, "home");
	cpSync(FIXTURE, deck, { recursive: true });
	mkdirSync(home);
	const started = [];
	try {
		for (const name of onlyServer ? ["server"] : ["server", "harness", "page"]) {
			const child = launch(name, PROGRAMS[name]({ ...ports, deck, home, dist }), log);
			started.push(child);
			const ready = name === "harness" ? () => harnessReady(ports, deck) : name === "page" ? () => pageReady(ports) : () => listening(ports.server);
			await until(ready, child, name);
		}
		return await work({ ports, deck, started, log });
	} finally {
		await Promise.all(started.reverse().map(stopAndWait));
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** One check, start to end: the programs up, the check run, everything stopped and the copy gone. */
export async function runCheck(file, i, { onlyServer = false } = {}) {
	const log = [];
	try {
		return await runPrograms(async ({ ports, started }) => {
			const web = onlyServer ? ports.server : ports.web;
			// The page proxies the server's routes and carries the person's token in its HTML, as today's page did.
			const env = { DECKS_E2E_MARKER: "decks-e2e", DECKS_E2E_API: `http://127.0.0.1:${web}`, DECKS_E2E_WEB: `http://127.0.0.1:${web}` };
			const check = launch("check", { cmd: process.execPath, args: [join(ROOT, "e2e/checks", file)], env }, log);
			started.push(check);
			const code = await new Promise((done) => {
				const timer = setTimeout(() => (stop(check), done("timeout")), CHECK_MS);
				check.on("exit", (c) => (clearTimeout(timer), done(c)));
			});
			return { file, ok: code === 0, why: code === 0 ? "" : firstFailure(log, code), log };
		}, { i, onlyServer, log });
	} catch (error) {
		return { file, ok: false, why: error.message, log };
	}
}

/** The first line of a check's output that says it failed, else the exit. */
function firstFailure(log, code) {
	const lines = log.join("").split("\n").filter((l) => l.startsWith("[check]"));
	const bad = lines.find((l) => /✗|\bFAIL\b|not ok/.test(l)) ?? lines.find((l) => /\bError\b|refusing/.test(l)) ?? (code !== 0 ? `exit ${code} with no failing line; see the log` : undefined);
	return (bad ?? lines.at(-1) ?? `exit ${code}`).replace(/^\[check\]\s*/, "").slice(0, 300);
}

async function main(argv) {
	const onlyServer = argv.includes("--only-server");
	const files = argv.filter((a) => !a.startsWith("--")).map((a) => (a.endsWith(".mjs") ? a : `${a}.mjs`));
	if (!files.length) return console.error("usage: node tools/checks/run.mjs [--only-server] <check> ..."), 2;
	const missing = files.filter((f) => !existsSync(join(ROOT, "e2e/checks", f)));
	if (missing.length) return console.error(`no such check: ${missing.join(", ")}`), 2;
	if (!onlyServer && process.env.CHECKS_PAGE !== "dev") RUN.dist = buildPage();
	// The fake model today's agent checks drive Pi with (e2e/fake-agent points at it), shared by every check.
	const model = (await listening(4700)) ? undefined : launch("model", { cmd: process.execPath, args: [join(ROOT, "e2e/fake-model.mjs")] }, []);
	let failed = 0;
	const seen = new Map();
	for (const file of files) {
		const result = await runCheck(file, 0, { onlyServer });
		if (!result.ok) failed++;
		console.log(`${result.ok ? "pass" : "FAIL"}  ${file}${result.ok ? "" : `  ${result.why}`}`);
		if (!result.ok && process.env.CHECKS_VERBOSE === "1") console.log(result.log?.join("").split("\n").slice(-40).join("\n"));
		// One log per run of a check: a check named twice keeps both (file.log, file.2.log, ...).
		if (process.env.CHECKS_LOG_DIR) {
			seen.set(file, (seen.get(file) ?? 0) + 1);
			const n = seen.get(file);
			writeFileSync(join(process.env.CHECKS_LOG_DIR, n === 1 ? `${file}.log` : `${file}.${n}.log`), result.log?.join("") ?? "");
		}
	}
	if (model) stop(model);
	if (RUN.dist) rmSync(join(RUN.dist, ".."), { recursive: true, force: true });
	console.log(`${files.length - failed} of ${files.length} checks pass`);
	return failed ? 1 : 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv.slice(2));
