#!/usr/bin/env node
// Runs today's browser checks, unchanged, against the new programs: node tools/checks/run.mjs <check> ...
// Per check: Decks-local on a fresh fixture copy, the harness, and the page, each on ports of its own.
// It takes the heavy lock itself, a slot per check run (call it directly). Only server: --only-server.
// CHECKS_LOG_DIR keeps each check's log, CHECKS_VERBOSE=1 a failure's tail; CHECKS_PROGRAMS=<checkout>
// runs the programs from another checkout, the checks from this one (and a check may restart one: controlServer).
import { spawn, spawnSync } from "node:child_process";
import { freeGb, withSlot } from "../heavy.mjs";
import { portsFree } from "./ports.mjs";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);

/** Where the programs come from: this checkout, or the one CHECKS_PROGRAMS names. */
const PROGRAM_ROOT = process.env.CHECKS_PROGRAMS ? resolve(process.env.CHECKS_PROGRAMS) : ROOT;

const FIXTURE = join(PROGRAM_ROOT, "tools/fixtures/deck");

const BASE = Number(process.env.CHECKS_PORT ?? 4610);

const WAIT_MS = 60_000;

const CHECK_MS = Number(process.env.CHECKS_TIMEOUT_MS ?? 300_000);

/** What one run shares: the page built once. */
const RUN = { dist: undefined, kinds: "pi" };

/** Every check tools/checks/checks.json describes, by name: what it is (timed, agent, named, bench, dev) and its path. */
const checks = () => JSON.parse(readFileSync(join(ROOT, "tools/checks/checks.json"), "utf8")).checks;

/** What checks.json says of one check, by its name or file name. */
export const traitsOf = (file) => checks()[file.replace(/\.mjs$/, "")] ?? {};

/** A check that measures time runs alone, on the dev server it was written for (DESIGN.md section 11). */
export const timed = (file) => traitsOf(file).timed === true;

/** A check written against the dev page's timing (checks.json says why) runs on the dev server too. */
const onDev = (file) => timed(file) || traitsOf(file).dev === true;

/** The fake model and agent, in tools/checks after the switch-over, in e2e before. */
const helper = (name) => (existsSync(join(ROOT, "tools/checks", name)) ? join(ROOT, "tools/checks", name) : join(ROOT, "e2e", name));

/** How each program starts, given its ports and the deck. Edit here when an owner changes theirs. */
export const PROGRAMS = {
	server: ({ server, deck }) => ({ cmd: process.execPath, args: ["--import", "tsx", "server/main.ts", "--deck", deck, "--port", String(server)] }),
	harness: ({ deck, home }) => ({ cmd: process.execPath, args: ["--import", "tsx", "harness/main.ts", "--deck", deck, "--kinds", RUN.kinds], env: { PI_CODING_AGENT_DIR: helper("fake-agent"), DECKS_DATA_DIR: home } }),
	// The built page on a plain static server with the dev server's proxy rules (page-server.mjs);
	// CHECKS_PAGE=dev runs vite's dev server instead, directly, not through npm.
	page: ({ deck, web, dist }) =>
		process.env.CHECKS_PAGE === "dev" || !dist
			? { cmd: join(PROGRAM_ROOT, "node_modules/.bin/vite"), args: [], cwd: join(PROGRAM_ROOT, "harness/page"), env: { DECKS_DECK: deck, DECKS_PAGE_PORT: String(web), DECKS_PAGE_COMPAT: "1" } }
			: { cmd: process.execPath, args: [join(PROGRAM_ROOT, "tools/checks/page-server.mjs"), "--dist", dist, "--deck", deck, "--port", String(web), "--compat"] },
};

/** Ports by lock slot (0 alone, 1 and 2 the check slots), so two checks at once never share one. */
export const portsFor = (i) => ({ server: BASE + 3 * i, harness: BASE + 3 * i + 1, web: BASE + 3 * i + 2 });

// A check's run: its programs up, the check against them, its first failing line.

/** One check, start to end: the programs up, the check run, everything stopped and the copy gone. */
export async function runCheck(file, i, { onlyServer = false } = {}) {
	const log = [];
	try {
		return await runPrograms(async ({ ports, started, restart }) => {
			const web = onlyServer ? ports.server : ports.web;
			const control = await controlServer(ports.harness, restart);
			// The page proxies the server's routes and carries the person's token in its HTML, as today's page did.
			const env = { DECKS_E2E_MARKER: "decks-e2e", DECKS_E2E_API: `http://127.0.0.1:${web}`, DECKS_E2E_WEB: `http://127.0.0.1:${web}`, DECKS_E2E_CONTROL: `http://127.0.0.1:${ports.harness}` };
			const check = launch("check", { cmd: process.execPath, args: [checkPath(file)], env, cwd: ROOT }, log);
			started.push(check);
			const code = await new Promise((done) => {
				const timer = setTimeout(() => (stop(check), done("timeout")), CHECK_MS);
				check.on("exit", (c) => (clearTimeout(timer), done(c)));
			}).finally(() => control.close());
			return { file, ok: code === 0, why: code === 0 ? "" : firstFailure(log, code), log };
		}, { i, onlyServer, log, dist: onDev(file) ? null : RUN.dist });
	} catch (error) {
		return { file, ok: false, why: error.message, log };
	}
}

/**
 * The check's way to restart a program, on the harness's port (the harness listens on none):
 * POST /restart { program, env } stops that program and starts it again with those variables added,
 * answering once it is ready again; env {} starts it as the runner did.
 */
function controlServer(port, restart) {
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		try {
			const { program, env = {} } = JSON.parse(body || "{}");
			if (req.method !== "POST" || req.url !== "/restart" || !PROGRAMS[program]) throw new Error("POST /restart { program, env }");
			await restart(program, env);
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
		} catch (error) {
			res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: error.message }));
		}
	});
	return new Promise((done, fail) => server.once("error", fail).listen(port, "127.0.0.1", () => done(server)));
}

/** The first line of a check's output that says it failed, else the exit. */
function firstFailure(log, code) {
	const lines = log.join("").split("\n").filter((l) => l.startsWith("[check]"));
	const bad = lines.find((l) => /✗|\bFAIL\b|not ok/.test(l)) ?? lines.find((l) => /\bError\b|refusing/.test(l)) ?? (code !== 0 ? `exit ${code} with no failing line; see the log` : undefined);
	return (bad ?? lines.at(-1) ?? `exit ${code}`).replace(/^\[check\]\s*/, "").slice(0, 300);
}

/** The three programs up on a fresh fixture copy, work(ports, deck) run, then all stopped and the copy gone. */
export async function runPrograms(work, { i = 0, onlyServer = false, log = [], dist = RUN.dist } = {}) {
	const ports = portsFor(i);
	// The slot is ours: any program a dead holder of it left running is no live run's, so it goes first.
	const left = endLeftovers(i);
	if (left.length) log.push(`[runner] ended ${left.length} program(s) a dead run of slot ${i} left running: ${left.join(", ")}\n`);
	// The last caller's programs may still be closing its ports: wait for them.
	await portsFree(Object.values(ports));
	const scratch = mkdtempSync(join(tmpdir(), "decks-e2e-"));
	const deck = join(scratch, "deck");
	const home = join(scratch, "home");
	cpSync(FIXTURE, deck, { recursive: true });
	// Every deck from today is at 0.5.1, which lets its old pages kept at the root open: the copy says so too.
	mkdirSync(join(deck, ".decks"), { recursive: true });
	if (!existsSync(join(deck, ".decks/migrations.json"))) writeFileSync(join(deck, ".decks/migrations.json"), '{\n\t"version": "0.5.1"\n}\n');
	mkdirSync(home);
	const started = [];
	const running = new Map();
	const ready = (name) => (name === "harness" ? () => harnessReady(ports, deck) : name === "page" ? () => pageReady(ports) : () => listening(ports.server));
	const start = async (name, extra = {}) => {
		const spec = PROGRAMS[name]({ ...ports, deck, home, dist });
		const child = launch(name, { ...spec, env: { ...spec.env, ...extra } }, log);
		started.push(child);
		running.set(name, child);
		remember(i, started);
		await until(ready(name), child, name);
	};
	/**
	 * A program stopped and started again, with variables of its own. After the server, the harness is
	 * given 15 s to find it again; one that does not is restarted too, and the log says so.
	 */
	const restart = async (name, extra) => {
		const was = running.get(name);
		if (was) await stopAndWait(was);
		await portsFree(name === "server" ? [ports.server] : name === "page" ? [ports.web] : []);
		await start(name, extra);
		if (name !== "server" || !running.has("harness")) return;
		const back = await until(ready("harness"), running.get("harness"), "harness", 15_000).then(() => true, () => false);
		if (back) return;
		log.push("[runner] the harness did not find the restarted server in 15 s; restarting it too\n");
		await restart("harness", {});
	};
	try {
		for (const name of onlyServer ? ["server"] : ["server", "harness", "page"]) await start(name);
		return await work({ ports, deck, started, log, restart });
	} finally {
		await Promise.all(started.reverse().map(stopAndWait));
		// The slot goes back only once its ports are closed, so the next holder never meets these programs.
		await portsFree(Object.values(ports), { ms: 15_000 }).catch((error) => log.push(`[runner] ${error.message}\n`));
		forget(i);
		rmSync(scratch, { recursive: true, force: true });
	}
}

// What a slot's programs are, kept beside the heavy lock: a run killed outright (a Decks restart ends the
// command that started it) leaves its programs up, each in a group of its own, and the next holder ends them.

const programsFile = (slot) => `${process.env.HEAVY_LOCK || "/tmp/decks-rewrite-heavy.lock"}.programs-${slot}.json`;

/** Write down the process groups this run started on its slot. */
function remember(slot, children) {
	writeFileSync(programsFile(slot), JSON.stringify(children.map((child) => child.pid).filter(Boolean)));
}

/** The run is over and its programs are stopped: nothing is left to end. */
function forget(slot) {
	rmSync(programsFile(slot), { force: true });
}

/** End every process group a dead run of this slot wrote down and left running; answers the ones ended. */
export function endLeftovers(slot) {
	let pids = [];
	try {
		pids = JSON.parse(readFileSync(programsFile(slot), "utf8"));
	} catch {
		return [];
	}
	const ended = [];
	for (const pid of pids) {
		try {
			process.kill(-pid, 0);
			process.kill(-pid, "SIGKILL");
			ended.push(String(pid));
		} catch {
			/* that group is gone already */
		}
	}
	forget(slot);
	return ended;
}

/** Where a check is: its path in checks.json, or the path it was named by (tools/checks/<feature>/<name>.mjs). */
export function checkPath(file) {
	if (file.includes("/")) return resolve(ROOT, file);
	return join(ROOT, traitsOf(file).path ?? `e2e/checks/${file}`);
}

// Whether a program is up: the server listening, the harness's agent, the page.

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

async function until(ready, child, name, ms = WAIT_MS) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (child.exitCode !== null) throw new Error(`${name} exited (${child.exitCode}) before it was ready`);
		if (await ready()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`${name} was not ready in ${ms / 1000} s`);
}

// The programs as child processes: started with a clean environment, stopped as a group.

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

function launch(name, { cmd, args, env = {}, cwd = PROGRAM_ROOT }, log) {
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
	// Its port is free only once it is gone: wait for the kill too, so the slot is let go after it.
	if (child.exitCode === null && child.signalCode === null) await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))]);
}

// The command line: a slot per check, the page built once, a line per check.

/** The page built once for a run, into a scratch folder: vite build of harness/page. */
export function buildPage() {
	const dist = join(mkdtempSync(join(tmpdir(), "decks-page-")), "dist");
	// Development mode, unminified: the code today's checks were written against (vite's dev server).
	// Minified, a timed check (ink-long-stroke) measured two ways too close to tell apart, 7 runs in 10.
	const built = spawnSync(join(PROGRAM_ROOT, "node_modules/.bin/vite"), ["build", "--mode", "development", "--minify", "false", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: join(PROGRAM_ROOT, "harness/page"), env: CLEAN, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
	if (built.status !== 0) throw new Error(`the page did not build: ${built.stderr.slice(-400)}`);
	return dist;
}

async function main(argv) {
	const onlyServer = argv.includes("--only-server");
	const asked = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--kinds").map((a) => (a.endsWith(".mjs") ? a : `${a}.mjs`));
	// None named: every check with a place in checks.json that is not an agent's, a long one or a bench, as CI runs them.
	const named = asked.length ? asked : Object.entries(checks()).filter(([, t]) => t.path && !t.agent && !t.named && !t.bench).map(([name]) => `${name}.mjs`);
	// A check that starts an agent's turn runs only with --agent: it needs a model and may cost tokens.
	const withAgent = argv.includes("--agent");
	// --kinds claude starts the harness with a signed-in Claude instead of Pi on the fake model, for a check marked model.
	if (argv.includes("--kinds")) RUN.kinds = argv[argv.indexOf("--kinds") + 1];
	const files = named.filter((f) => withAgent || !traitsOf(f).agent);
	for (const f of named.filter((f) => !files.includes(f))) console.log(`skip  ${f}  starts an agent's turn: pass --agent`);
	if (!named.length) return console.error("usage: node tools/checks/run.mjs [--only-server] [--agent] [--kinds claude] <check> ..."), 2;
	const missing = files.filter((f) => !existsSync(checkPath(f)));
	if (missing.length) return console.error(`no such check: ${missing.join(", ")}`), 2;
	// A slot per check, never for the loop, taken here: under heavy.mjs every check would share one slot's ports.
	if (process.env.HEAVY_HELD) return console.error("Refused: run tools/checks/run.mjs directly, not under tools/heavy.mjs; it takes a lock slot for each check itself (two at once, a timed check alone)."), 2;
	const inSlot = async (cls, work) => {
		if (freeGb() < 8) throw new Error(`only ${freeGb().toFixed(1)} GB free, under 8 GB: free disk, then tell Mason`);
		return withSlot(cls, work);
	};
	// Checks that measure time run on the dev server, as they were written for (DESIGN.md section 11).
	if (!onlyServer && process.env.CHECKS_PAGE !== "dev" && files.some((f) => !onDev(f))) RUN.dist = await inSlot("exclusive", () => buildPage());
	// The fake model today's agent checks drive Pi with (e2e/fake-agent points at it), shared by every check.
	const model = (await listening(4700)) ? undefined : launch("model", { cmd: process.execPath, args: [helper("fake-model.mjs")] }, []);
	let failed = 0;
	const seen = new Map();
	for (const file of files) {
		const result = await inSlot(timed(file) ? "exclusive" : "check", (slot) => runCheck(file, slot, { onlyServer }));
		if (!result.ok) failed++;
		console.log(`${result.ok ? "pass" : "FAIL"}  ${file}${result.ok ? "" : `  ${result.why}`}`);
		if (!result.ok && process.env.CHECKS_VERBOSE === "1") console.log(result.log?.join("").split("\n").slice(-40).join("\n"));
		// One log per run of a check: a check named twice keeps both (file.log, file.2.log, ...).
		if (process.env.CHECKS_LOG_DIR) {
			seen.set(file, (seen.get(file) ?? 0) + 1);
			const n = seen.get(file);
			const name = file.split("/").pop();
			mkdirSync(process.env.CHECKS_LOG_DIR, { recursive: true });
			writeFileSync(join(process.env.CHECKS_LOG_DIR, n === 1 ? `${name}.log` : `${name}.${n}.log`), result.log?.join("") ?? "");
		}
	}
	if (model) stop(model);
	if (RUN.dist) rmSync(join(RUN.dist, ".."), { recursive: true, force: true });
	console.log(`${files.length - failed} of ${files.length} checks pass`);
	return failed ? 1 : 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv.slice(2));

