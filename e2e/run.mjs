/**
 * Run the browser checks against a throwaway deck.
 *
 * The fixture is a copy of `example/`, so the checks run on the same boards a reader can
 * open with `npm run dev:example` — and never on a deck somebody is working in. The copy
 * lives under the system temp directory with `decks-e2e` in its name, which is what
 * `harness.preflight()` insists on before any check is allowed to write to a board.
 *
 *   npm run test:e2e                  # everything that does not need a model
 *   DECKS_E2E_AGENT=1 npm run test:e2e   # including the checks that prompt an agent
 *   npm run test:e2e -- keys gestures    # just these
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetStage } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** `needsAgent` means it starts a turn, so it needs a model configured and will cost tokens. */
const CHECKS = [
	{ file: "header.mjs", needsAgent: false },
	{ file: "panels.mjs", needsAgent: false },
	{ file: "camera.mjs", needsAgent: false },
	{ file: "keys.mjs", needsAgent: false },
	{ file: "gestures.mjs", needsAgent: false },
	{ file: "embed-scroll.mjs", needsAgent: false },
	{ file: "editing.mjs", needsAgent: false },
	{ file: "no-flicker.mjs", needsAgent: false },
	{ file: "tiers.mjs", needsAgent: false },
	{ file: "deleted-board.mjs", needsAgent: false },
	{ file: "rail-scroll.mjs", needsAgent: false },
	{ file: "model-picker.mjs", needsAgent: false },
	{ file: "stage-api.mjs", needsAgent: true },
	{ file: "turn-bar.mjs", needsAgent: true },
	{ file: "running.mjs", needsAgent: true },
	{ file: "time-machine.mjs", needsAgent: true },
	{ file: "chrome.mjs", needsAgent: true },
];

const wanted = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const withAgent = process.env.DECKS_E2E_AGENT === "1";
const selected = CHECKS.filter((check) => {
	if (wanted.length > 0) return wanted.some((name) => check.file.startsWith(name.replace(/\.mjs$/, "")));
	return withAgent || !check.needsAgent;
});
const skipped = CHECKS.filter((check) => !selected.includes(check));

const data = mkdtempSync(join(tmpdir(), "decks-e2e-"));
cpSync(join(root, "example"), data, { recursive: true });
// `example/decks/lib` is generated and gitignored, so a fresh clone has to be given one
// or every board in the fixture loads without its stylesheet.
cpSync(join(root, "runtime", "lib"), join(data, "decks", "lib"), { recursive: true });
// Revisions and agent transcripts from whoever ran the example deck last are not fixture.
rmSync(join(data, "decks", ".decks"), { recursive: true, force: true });
rmSync(join(data, "decks", ".pi"), { recursive: true, force: true });

const server = spawn("npm", ["run", "dev"], {
	cwd: root,
	env: { ...process.env, DECKS_DATA_DIR: data, DECKS_E2E_MARKER: "decks-e2e" },
	stdio: ["ignore", "pipe", "pipe"],
});
const log = [];
for (const stream of [server.stdout, server.stderr]) {
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => log.push(chunk));
}

let exitCode = 0;
const stop = () => {
	try {
		process.kill(-server.pid, "SIGTERM");
	} catch {
		server.kill("SIGTERM");
	}
	rmSync(data, { recursive: true, force: true });
};
process.on("SIGINT", () => {
	stop();
	process.exit(130);
});

try {
	await waitForServer();
	/*
	 * Confirm it is *our* server.
	 *
	 * `npm run dev` fails to bind a port that is already taken, and the checks then talk
	 * happily to whatever else is listening — which is how a run once went against a
	 * scratch deck and reported a parity result that meant nothing. The ports are fixed, so
	 * this is not a rare accident; it is what happens whenever a dev server is left up.
	 */
	const serving = await deckPath();
	if (!serving || !serving.startsWith(data)) {
		throw new Error(
			`something else is already serving 127.0.0.1:4329 — it has ${serving ?? "an unknown deck"} open, not the fixture at ${data}. Stop it and run again.`,
		);
	}
	console.log(`fixture: ${data}`);
	console.log(`running ${selected.length} check(s)${skipped.length ? `, skipping ${skipped.length}` : ""}\n`);

	let pass = 0;
	let fail = 0;
	const failedFiles = [];
	const started = Date.now();

	for (const check of selected) {
		const at = Date.now();
		// Every check gets the whole deck on the canvas. They share one server and one
		// focused agent, so without this a check that narrows the canvas — clicking a rail
		// item plays that board and only that board — silently changes what the next one
		// sees, and it fails for a reason that has nothing to do with what it tests.
		await resetStage();
		const result = await runCheck(join(here, "checks", check.file));
		const counts = tally(result.output);
		pass += counts.pass;
		fail += counts.fail;
		const seconds = ((Date.now() - at) / 1000).toFixed(1);
		const status = counts.fail === 0 && result.code === 0 ? "ok" : "FAILED";
		console.log(`${status === "ok" ? "  ok  " : "  FAIL"} ${check.file.padEnd(20)} ${String(counts.pass).padStart(2)} passed  ${seconds}s`);
		if (status !== "ok") {
			failedFiles.push(check.file);
			for (const line of result.output.split("\n")) {
				if (/^FAIL/.test(line)) console.log(`        ${line}`);
			}
			// Printed whenever the process failed, not only when nothing ran: a script that
			// throws after three passing checks looked like a silent failure.
			if (result.code !== 0) {
				console.log(`        exited ${result.code} — tail of its output:`);
				for (const line of result.output.trim().split("\n").slice(-8)) console.log(`        ${line}`);
			}
		}
	}

	console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - started) / 1000).toFixed(0)}s`);
	for (const check of skipped) {
		const why = wanted.length > 0 ? "not selected" : "needs a model; set DECKS_E2E_AGENT=1";
		console.log(`  skipped ${check.file} (${why})`);
	}
	if (fail > 0 || failedFiles.length > 0) exitCode = 1;
} catch (error) {
	console.error(`e2e: ${error.message}`);
	console.error(log.join("").split("\n").slice(-15).join("\n"));
	exitCode = 1;
} finally {
	stop();
}
process.exit(exitCode);

async function waitForServer() {
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`dev server exited with ${server.exitCode}`);
		const api = await ping("http://127.0.0.1:4329/api/deck");
		const web = await ping("http://127.0.0.1:4328/");
		if (api && web) return;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error("dev server did not come up within 90s");
}

async function deckPath() {
	try {
		const response = await fetch("http://127.0.0.1:4329/api/deck");
		if (!response.ok) return undefined;
		return (await response.json())?.deck?.path;
	} catch {
		return undefined;
	}
}

async function ping(url) {
	try {
		const response = await fetch(url);
		return response.ok;
	} catch {
		return false;
	}
}

function runCheck(file) {
	return new Promise((done) => {
		const child = spawn(process.execPath, [file], {
			cwd: root,
			env: { ...process.env, DECKS_E2E_MARKER: "decks-e2e" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding("utf8");
			stream.on("data", (chunk) => {
				output += chunk;
			});
		}
		child.on("close", (code) => done({ code, output }));
	});
}

function tally(output) {
	const lines = output.split("\n");
	return {
		pass: lines.filter((line) => line.startsWith("PASS")).length,
		fail: lines.filter((line) => line.startsWith("FAIL")).length,
	};
}
