import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCK_FILE } from "../../protocol/index.ts";
import { attach, detach } from "../../clients/attach/index.ts";

// Stop 2 in one command: node tools/clients/try.ts [--tool claude] [--deck d].
// Copies the fixture deck to scratch (unless --deck), starts Decks-local on
// it, attaches the tool in a scratch folder, and says what to run. Ctrl-C
// detaches and stops the server.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRATCH = join(ROOT, ".scratch/Lexicon/try");
const flag = (name: string, fallback: string) => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};

async function main(): Promise<void> {
	const tool = flag("tool", "claude");
	const port = flag("port", "4609");
	let deck = flag("deck", "");
	if (!deck) {
		deck = join(SCRATCH, "deck");
		rmSync(SCRATCH, { recursive: true, force: true });
		cpSync(join(ROOT, "tools/fixtures/deck"), deck, { recursive: true });
	}
	const server = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(ROOT, "server/main.ts"), "--deck", deck, "--port", port], { stdio: "inherit" });
	for (let i = 0; i < 100 && !existsSync(join(deck, LOCK_FILE)); i++) await new Promise((resolve) => setTimeout(resolve, 100));
	if (!existsSync(join(deck, LOCK_FILE))) throw new Error(`Decks-local wrote no ${LOCK_FILE} in 10 s.`);
	const folder = join(SCRATCH, `${tool}-agent`);
	mkdirSync(folder, { recursive: true });
	const lock = JSON.parse(readFileSync(join(deck, LOCK_FILE), "utf8")) as { url: string; token: string };
	Object.assign(process.env, { DECKS_DECK: deck, DECKS_URL: lock.url, DECKS_TOKEN: lock.token });
	console.log(await attach(["--tool", tool, "--dir", folder]));
	console.log(`\nNow: cd ${folder} && ${tool}\nAsk it to make a card on the canvas. Ctrl-C here detaches it and stops the server.`);
	const stop = async () => {
		console.log(await detach(["--dir", folder]).catch((e: Error) => e.message));
		server.kill("SIGTERM");
		process.exit(0);
	};
	process.on("SIGINT", () => void stop());
	server.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((error: Error) => {
	console.error(error.message);
	process.exit(1);
});
