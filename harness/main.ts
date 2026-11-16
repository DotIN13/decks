#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOCK_FILE } from "@decks/protocol";
import { readLock, startHarness, type Lock } from "./host.ts";
export { readLock } from "./host.ts";
import type { RunKind } from "./runtimes/types/index.ts";

// The harness's entry: node --import tsx harness/main.ts --deck <folder>
// [--port 4620] [--kinds pi,claude] [--canvas c] [--no-first-agent]. It connects
// to the server the deck's lock file names, or starts server/main.ts when none
// runs. A deck with no agent gets one, at home on --canvas when named.

const SERVER = fileURLToPath(new URL("../server/main.ts", import.meta.url));

function flag(argv: string[], name: string): string | undefined {
	const at = argv.indexOf(`--${name}`);
	return at >= 0 ? argv[at + 1] : undefined;
}

/** Start Decks-local on the deck, and wait for its lock file. */
export async function startServer(deck: string, port: string): Promise<{ lock: Lock; child: ChildProcess }> {
	const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), SERVER, "--deck", deck, "--port", port], { stdio: "inherit" });
	for (let i = 0; i < 150; i++) {
		const lock = readLock(deck);
		if (lock && lock.pid === child.pid) return { lock, child };
		await new Promise((done) => setTimeout(done, 100));
	}
	child.kill("SIGTERM");
	throw new Error(`Decks-local wrote no ${LOCK_FILE} in 15 s.`);
}

async function main(argv: string[]): Promise<void> {
	const deck = resolve(flag(argv, "deck") ?? process.env.DECKS_DECK ?? "");
	if (!flag(argv, "deck") && !process.env.DECKS_DECK) throw new Error("Name the deck folder: --deck <folder>.");
	const found = readLock(deck);
	const started = found ? undefined : await startServer(deck, flag(argv, "port") ?? "4620");
	const lock = found ?? started!.lock;
	const kinds = flag(argv, "kinds")?.split(",").filter(Boolean) as RunKind[] | undefined;
	const canvas = flag(argv, "canvas");
	const firstAgent = argv.includes("--no-first-agent") ? (false as const) : canvas ? { canvas } : {};
	const harness = await startHarness({ url: lock.url, token: lock.token, deck, firstAgent, ...(kinds ? { kinds } : {}) });
	console.log(`The Decks harness is connected to ${lock.url}${started ? ", a server it started" : ""}.`);
	const stop = () => void harness.stop().then(() => {
		started?.child.kill("SIGTERM");
		process.exit(0);
	});
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((error: Error) => {
		console.error(error.message);
		process.exit(1);
	});
}
