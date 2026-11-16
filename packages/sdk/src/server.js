/**
 * Finding, starting and stopping this user's Decks: the clients' half of the address file.
 *
 * Node only (the `decks` command and the MCP relay import it; a page never does). The server writes
 * `~/.decks/server.json` when it starts listening (`apps/server/src/address.ts`): its address, its
 * process, and how to start it again. A client reads it to know where Decks is, and when no live
 * server is named it starts one: through launchd when macOS keeps the server (`service`), else by
 * the command the file remembers, else the server of this install on its defaults.
 *
 * What the environment says wins: `DECKS_URL` or `DECKS_PORT` names a server outright (an agent's
 * shell has `DECKS_URL`), and a client told where Decks is never starts one.
 */
import { execFile, spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export const decksHome = (env = process.env) => env.DECKS_HOME || join(homedir(), ".decks");
export const addressFile = (env = process.env) => join(decksHome(env), "server.json");
/** Where a server this command started writes what it prints. */
export const logFile = (env = process.env) => join(decksHome(env), "server.log");

export function readAddress(env = process.env) {
	try {
		const saved = JSON.parse(readFileSync(addressFile(env), "utf8"));
		return typeof saved?.url === "string" ? saved : undefined;
	} catch {
		return undefined;
	}
}

export function processAlive(pid) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

/**
 * Where Decks is, and how that is known: `DECKS_URL`, then `DECKS_PORT` on this machine, then the
 * address file, then this machine's default port.
 */
export function locate(env = process.env) {
	if (env.DECKS_URL) return { url: env.DECKS_URL.replace(/\/+$/, ""), from: "DECKS_URL" };
	if (env.DECKS_PORT) return { url: `http://127.0.0.1:${env.DECKS_PORT}`, from: "DECKS_PORT" };
	const address = readAddress(env);
	if (address) return { url: address.url.replace(/\/+$/, ""), from: "file", address };
	return { url: "http://127.0.0.1:4329", from: "default" };
}

/** Whether anything answers at an address: any reply at all, a refusal included. */
export async function answers(url, ms = 1500) {
	try {
		await fetch(`${url}/api/hello`, { signal: AbortSignal.timeout(ms) });
		return true;
	} catch {
		return false;
	}
}

const launchdTarget = (service) => `gui/${userInfo().uid}/${service}`;

/** This install's own server, on its defaults: what a machine that never ran Decks starts. */
function installStart(env) {
	const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/server/src/index.ts");
	if (!existsSync(entry)) return undefined;
	return { command: process.execPath, args: ["--import", "tsx", entry], cwd: dirname(dirname(entry)), env: {} };
}

/**
 * Start the server and wait until it answers. Says what it did: `{ url, started, how }`, `started`
 * false when one already answered.
 */
export async function startServer(given = {}) {
	const env = given.env ?? process.env;
	const wait = given.wait ?? 30_000;
	const at = locate(env);
	if (await answers(at.url)) return { url: at.url, started: false, how: "it was already running" };
	if (at.from === "DECKS_URL") throw new Error(`Nothing answers at ${at.url}, and DECKS_URL names a Decks this command did not start: start that one where it runs.`);
	const address = at.address;
	let how;
	if (address?.service) {
		await run("launchctl", ["kickstart", launchdTarget(address.service)]);
		how = `macOS started it (launchd job ${address.service})`;
	} else {
		const start = address?.start ?? installStart(env);
		if (!start) throw new Error(`No Decks answers at ${at.url}, and there is no server to start: ${addressFile(env)} names none and this install has no apps/server.`);
		mkdirSync(decksHome(env), { recursive: true, mode: 0o700 });
		const log = openSync(logFile(env), "a", 0o600);
		// The server gets its own settings, not this caller's: an agent's shell names itself and its token in `DECKS_*`.
		const mine = { ...env };
		for (const name of ["DECKS_AGENT", "DECKS_TOKEN", "DECKS_URL", "DECKS_SDK", "DECKS_SESSION", "DECKS_APP"]) delete mine[name];
		// A port named in the environment is the one asked for, over the one the file remembers.
		const child = spawn(start.command, start.args, { cwd: start.cwd, env: { ...mine, ...start.env, ...(env.DECKS_PORT ? { DECKS_PORT: env.DECKS_PORT } : {}) }, detached: true, stdio: ["ignore", log, log] });
		child.unref();
		closeSync(log);
		how = `started it (process ${child.pid}; it writes to ${logFile(env)})`;
	}
	const until = Date.now() + wait;
	while (Date.now() < until) {
		// The address may be new: a first start writes the file.
		const now = locate(env);
		if (await answers(now.url, 800)) return { url: now.url, started: true, how };
		await sleep(300);
	}
	throw new Error(`Decks was started but did not answer at ${at.url} within ${Math.round(wait / 1000)} s. ${address?.service ? `launchctl print ${launchdTarget(address.service)} says more.` : `Its output is in ${logFile(env)}.`}`);
}

/**
 * A server to call, started when there is none: for a client the environment told nothing
 * (`DECKS_URL` unset). Answers the address.
 */
export async function ensureServer(given = {}) {
	const env = given.env ?? process.env;
	const at = locate(env);
	if (at.from === "DECKS_URL") return { url: at.url, started: false };
	if (at.from === "file" && processAlive(at.address.pid)) return { url: at.url, started: false };
	return startServer(given);
}

/** Stop the server the address file names. Under launchd with KeepAlive it comes straight back, and the answer says so. */
export async function stopServer(given = {}) {
	const env = given.env ?? process.env;
	const address = readAddress(env);
	if (!address || !processAlive(address.pid)) return { stopped: false, why: `No running Decks is named in ${addressFile(env)}.` };
	if (address.service) await run("launchctl", ["kill", "SIGTERM", launchdTarget(address.service)]);
	else process.kill(address.pid, "SIGTERM");
	const until = Date.now() + (given.wait ?? 10_000);
	while (Date.now() < until && processAlive(address.pid)) await sleep(150);
	if (processAlive(address.pid)) return { stopped: false, why: `Process ${address.pid} did not stop within ${Math.round((given.wait ?? 10_000) / 1000)} s.` };
	return { stopped: true, pid: address.pid, ...(address.service ? { note: `macOS keeps the job ${address.service} running, so it starts again by itself. To stop it for good: launchctl bootout ${launchdTarget(address.service)}` } : {}) };
}

/** What is known about the server, without starting anything. */
export async function serverStatus(given = {}) {
	const env = given.env ?? process.env;
	const at = locate(env);
	const address = at.address;
	const running = await answers(at.url);
	return {
		running,
		url: at.url,
		from: at.from,
		...(address ? { pid: processAlive(address.pid) ? address.pid : undefined, dataDir: address.dataDir, started: address.started, ...(address.stopped ? { stopped: address.stopped } : {}), ...(address.service ? { service: address.service } : {}) } : {}),
		file: addressFile(env),
	};
}

/** The files the server's output goes to: launchd's for a job, else the one `startServer` opens. */
export async function logFiles(given = {}) {
	const env = given.env ?? process.env;
	const address = readAddress(env);
	if (address?.service) {
		try {
			const { stdout } = await run("launchctl", ["print", launchdTarget(address.service)]);
			const files = [...stdout.matchAll(/^\s*std(?:out|err) path = (.+)$/gm)].map((found) => found[1].trim());
			if (files.length) return [...new Set(files)];
		} catch {}
	}
	return [logFile(env)];
}

/**
 * The person's token for a Decks on this machine, for a client that starts by itself (the MCP relay):
 * the one `decks login` kept in `~/.decks/token` when the server still takes it, else a new one, got
 * as `decks login` gets it with no code: the server writes a token for its own user in its data
 * folder at each start (`<data dir>/.decks/cli-token`), readable by that user alone, and trades it
 * for a terminal's. Undefined when neither works: someone has to run `decks login <code>`.
 */
export async function personToken(url, given = {}) {
	const env = given.env ?? process.env;
	const file = join(decksHome(env), "token");
	let saved = {};
	try {
		saved = JSON.parse(readFileSync(file, "utf8")) ?? {};
	} catch {}
	const works = async (token) => {
		try {
			const said = await (await fetch(`${url}/api/hello`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) })).json();
			return said?.paired === true;
		} catch {
			return false;
		}
	};
	if (typeof saved[url] === "string" && (await works(saved[url]))) return saved[url];
	const dataDir = (readAddress(env)?.dataDir ?? env.DECKS_DATA_DIR ?? join(homedir(), ".decks")).replace(/^~(?=\/|$)/, homedir());
	let local;
	try {
		local = JSON.parse(readFileSync(join(dataDir, ".decks", "cli-token"), "utf8"));
	} catch {
		return undefined;
	}
	// Never sent anywhere but the server that wrote it.
	if (typeof local?.token !== "string" || (local.url && new URL(local.url).port !== new URL(url).port)) return undefined;
	try {
		const response = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${local.token}` }, body: JSON.stringify({ label: `decks login on ${hostname()}` }) });
		const answer = await response.json();
		if (!response.ok || typeof answer?.token !== "string") return undefined;
		mkdirSync(decksHome(env), { recursive: true, mode: 0o700 });
		writeFileSync(file, `${JSON.stringify({ ...saved, [url]: answer.token }, null, "\t")}\n`, { mode: 0o600 });
		chmodSync(file, 0o600);
		return answer.token;
	} catch {
		return undefined;
	}
}
