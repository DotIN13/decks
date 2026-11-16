import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The address file: where this user's Decks is, and how to start it again.
 *
 * A client with nothing in its environment (`decks` at a terminal, the MCP relay inside Claude Code)
 * has to find the server before it can call it, and start one when there is none. The server writes
 * `~/.decks/server.json` when it starts listening: its address, its process, its data folder, the
 * command that started it, and the launchd job that keeps it running when there is one. When it
 * stops it leaves the file, with the process taken out, so the next client knows what to start.
 *
 * One file, one server: a second server on the machine (a test's, a demo's) finds the file held by
 * a live process and leaves it alone. `DECKS_ADDRESS=0` keeps a server from ever claiming it, and
 * `DECKS_HOME` moves it, as it moves `decks login`'s tokens. The clients' half is
 * `packages/sdk/src/server.js`.
 */
export interface Address {
	url: string;
	/** The server's process while it runs; absent once it stopped. */
	pid?: number;
	dataDir: string;
	/** When it started, and when it stopped if it has: epoch milliseconds. */
	started: number;
	stopped?: number;
	/** The launchd job that keeps it running, when macOS started it: restarted by `launchctl kickstart`. */
	service?: string;
	/** The command that started it, for a client to run again: node, its arguments, where, and the `DECKS_*` settings. */
	start: { command: string; args: string[]; cwd: string; env: Record<string, string> };
}

export function addressFile(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.DECKS_HOME || join(homedir(), ".decks"), "server.json");
}

export function readAddress(env: NodeJS.ProcessEnv = process.env): Address | undefined {
	try {
		const saved = JSON.parse(readFileSync(addressFile(env), "utf8")) as Partial<Address>;
		return typeof saved?.url === "string" && typeof saved.dataDir === "string" ? (saved as Address) : undefined;
	} catch {
		return undefined;
	}
}

/** Whether a process is still there: signal 0 asks without sending anything. */
export function processAlive(pid: number | undefined): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// Another user's process is still a process.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * The launchd job this process is, or undefined. launchd names the job in `XPC_SERVICE_NAME` and is
 * the parent of what it starts; a shell inside an app inherits the app's name (`application.…`) but
 * has the shell as its parent.
 */
export function launchdService(env: NodeJS.ProcessEnv = process.env, parent: number = process.ppid): string | undefined {
	const name = env.XPC_SERVICE_NAME;
	return name && name !== "0" && !name.startsWith("application.") && parent === 1 ? name : undefined;
}

/** What Decks sets for one caller (an agent's shell, an app's server): never a server's own setting. */
const CALLERS = new Set(["DECKS_AGENT", "DECKS_URL", "DECKS_SDK", "DECKS_SESSION", "DECKS_APP", "DECKS_NODE", "DECKS_STAGE_URL", "DECKS_STAGE_SHOT", "DECKS_MIGRATE_DRY_RUN"]);

/**
 * The settings a restart needs: the server's own `DECKS_*` variables, without what belongs to a
 * caller and without the secrets one can hold (a Studio key, a token).
 */
function startEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value !== undefined && name.startsWith("DECKS_") && !CALLERS.has(name) && !/KEY|TOKEN|SECRET|PASSWORD/.test(name)) kept[name] = value;
	}
	return kept;
}

export interface Claim {
	/** Whether this server holds the file; false when a live server already did, or `DECKS_ADDRESS=0`. */
	held: boolean;
	/** At stop: take this process out of the file, leaving how to start it. */
	stop(): void;
}

/** Claim the address file for this server, unless a live one holds it. */
export function claimAddress(url: string, dataDir: string, env: NodeJS.ProcessEnv = process.env): Claim {
	const none: Claim = { held: false, stop: () => {} };
	if (env.DECKS_ADDRESS === "0") return none;
	const file = addressFile(env);
	const before = readAddress(env);
	if (before?.pid && before.pid !== process.pid && processAlive(before.pid)) return none;
	const service = launchdService(env);
	const address: Address = {
		url,
		pid: process.pid,
		dataDir,
		started: Date.now(),
		...(service ? { service } : {}),
		start: { command: process.execPath, args: [...process.execArgv, ...process.argv.slice(1)], cwd: process.cwd(), env: startEnv(env) },
	};
	const write = (value: Address) => {
		mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
		writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600 });
		chmodSync(file, 0o600);
	};
	try {
		write(address);
	} catch {
		return none;
	}
	return {
		held: true,
		stop: () => {
			// Only while it is still ours: another server may have claimed it since.
			if (readAddress(env)?.pid !== process.pid) return;
			const { pid: _pid, ...rest } = address;
			try {
				write({ ...rest, stopped: Date.now() });
			} catch {}
		},
	};
}
