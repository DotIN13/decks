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
 *   DECKS_E2E_MODEL="muse-spark" DECKS_E2E_AGENT=1 npm run test:e2e   # …on a named model
 *   npm run test:e2e -- keys gestures    # just these
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** `needsAgent` means it starts a turn, so it needs a model configured and will cost tokens. */
const CHECKS = [
	/*
	 * `header.mjs` and `panels.mjs` are gone, replaced rather than ported: the title bar
	 * they tested does not exist, and "two panels, one at a time" is one panel with a tab
	 * strip. `turn-bar.mjs` went with the spine itself.
	 */
	{ file: "clusters.mjs", needsAgent: false },
	{ file: "panel.mjs", needsAgent: false },
	{ file: "edge.mjs", needsAgent: false },
	{ file: "dock.mjs", needsAgent: false },
	{ file: "camera.mjs", needsAgent: false },
	{ file: "keys.mjs", needsAgent: false },
	{ file: "gestures.mjs", needsAgent: false },
	{ file: "mobile.mjs", needsAgent: false },
	{ file: "embed-scroll.mjs", needsAgent: false },
	{ file: "editing.mjs", needsAgent: false },
	{ file: "inspector.mjs", needsAgent: false },
	{ file: "invented-component.mjs", needsAgent: false },
	{ file: "rich-text.mjs", needsAgent: false },
	{ file: "file-drop.mjs", needsAgent: false },
	{ file: "no-flicker.mjs", needsAgent: false },
	{ file: "tiers.mjs", needsAgent: false },
	{ file: "deleted-board.mjs", needsAgent: false },
	{ file: "rail-scroll.mjs", needsAgent: false },
	{ file: "thumbs.mjs", needsAgent: false },
	{ file: "model-picker.mjs", needsAgent: false },
	{ file: "accounts.mjs", needsAgent: false },
	{ file: "agent-close.mjs", needsAgent: false },
	{ file: "notifications.mjs", needsAgent: false },
	{ file: "agent-rows.mjs", needsAgent: true },
	{ file: "stage-api.mjs", needsAgent: true },
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

/*
 * The ports, from the environment.
 *
 * They were fixed at 4329/4328, which was fine while there was one deck on a machine and
 * is not now: a suite cannot run while a live deck holds the port, and `strictPort` makes
 * that a failure rather than a quiet move. `harness.mjs` has always read
 * `DECKS_E2E_API`/`DECKS_E2E_WEB`; this passes the same numbers to the server it spawns,
 * so the two halves finally agree.
 */
const API_PORT = Number(process.env.DECKS_E2E_API_PORT ?? 4329);
const WEB_PORT = Number(process.env.DECKS_E2E_WEB_PORT ?? 4328);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/*
 * Into *this* process's environment as well, and that is not belt-and-braces.
 *
 * `harness.mjs` reads `DECKS_E2E_API` at import time, and this file imports it for
 * `resetStage` — which it then calls before every check. Passing the URLs only to the
 * server it spawns and the checks it forks left the runner's own copy of the harness
 * pointed at the default port, so `resetStage` played the fixture's boards onto whatever
 * deck happened to be on 4329. On a machine with a live Decks open, that is somebody's
 * real canvas: every board in their deck, put in play by a test run, and no check ever saw
 * a board because the plays landed somewhere else entirely.
 *
 * Set before the import below is used, so there is one source of these two numbers.
 */
process.env.DECKS_E2E_API = API_URL;
process.env.DECKS_E2E_WEB = WEB_URL;

/*
 * Imported here rather than at the top, because `harness.mjs` reads those two variables
 * once, at *its* import time. A static import runs before the two lines above, so the
 * runner's own copy of the harness would still hold the defaults — which is the bug those
 * lines were written to fix, arriving one statement too late to fix it.
 */
const { resetStage } = await import("./harness.mjs");

const data = mkdtempSync(join(tmpdir(), "decks-e2e-"));
cpSync(join(root, "example"), data, { recursive: true });
// `example/decks/lib` is generated and gitignored, so a fresh clone has to be given one
// or every board in the fixture loads without its stylesheet. The server would now write
// it on open (`App.refreshLib`), but the fixture is built before the server starts and a
// check that fails because of a race in its own setup is the worst kind to debug.
cpSync(join(root, "runtime", "lib"), join(data, "decks", "lib"), { recursive: true });
// Revisions and agent transcripts from whoever ran the example deck last are not fixture.
rmSync(join(data, "decks", ".decks"), { recursive: true, force: true });
rmSync(join(data, "decks", ".pi"), { recursive: true, force: true });
/*
 * And the signed-in accounts, for the same reason as the two above.
 *
 * `example/claude-accounts` is gitignored — this repo has a commit named "Never commit the
 * signed-in Claude accounts" — but it exists on any machine where somebody has logged in
 * from the example deck, and the copy above takes `example/` wholesale. So the fixture
 * arrived with a real account and an `active` symlink already in it, and `accounts.mjs`
 * failed three assertions about what a *fresh install* looks like. A check that depends on
 * whoever last used the example deck passes or fails by accident.
 */
rmSync(join(data, "claude-accounts"), { recursive: true, force: true });

const server = spawn("npm", ["run", "dev"], {
	cwd: root,
	/*
	 * Its own process group, which is what makes `stop()` able to reach the whole tree.
	 *
	 * `npm run dev` is a wrapper around `concurrently` around two more processes. Killing
	 * the pid we hold kills the wrapper and orphans the rest, and the orphans keep the
	 * ports — so the next run finds a stranger's deck on 4329 and refuses. With this, one
	 * negative pid addresses all of them.
	 */
	detached: true,
	env: {
		...process.env,
		DECKS_DATA_DIR: data,
		DECKS_E2E_MARKER: "decks-e2e",
		DECKS_PORT: String(API_PORT),
		DECKS_WEB_PORT: String(WEB_PORT),
		// The checks talk to these, and a mismatch between what is spawned and what is
		// polled is a 90-second wait ending in "did not come up".
		DECKS_E2E_API: API_URL,
		DECKS_E2E_WEB: WEB_URL,
	},
	stdio: ["ignore", "pipe", "pipe"],
});
const log = [];
for (const stream of [server.stdout, server.stderr]) {
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => log.push(chunk));
}

let exitCode = 0;
let stopped = false;
const stop = () => {
	if (stopped) return;
	stopped = true;
	/*
	 * SIGKILL, and not SIGTERM first.
	 *
	 * `npm run dev` is a wrapper around `concurrently` around two more processes, and
	 * `concurrently` does not pass a TERM down to children it started through npm scripts —
	 * so a polite stop left the server and Vite holding their ports, and the *next* run
	 * found "something else is already serving" and refused. Correctly, and confusingly,
	 * because the something else was the previous run.
	 *
	 * There is nothing here worth shutting down gracefully: a dev server over a throwaway
	 * fixture, and the fixture is deleted on the next line. `detached` above is what gives
	 * the whole tree one negative pid to send this to.
	 */
	try {
		process.kill(-server.pid, "SIGKILL");
	} catch {
		try {
			server.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}
	rmSync(data, { recursive: true, force: true });
};

/*
 * Every way this process can end, the tree goes with it.
 *
 * `finally` covers a thrown check and `SIGINT` covers a ⌃C, but neither covers being killed
 * from outside — which is how an interrupted run left a server behind and then broke the
 * next two runs before anyone worked out why.
 */
process.on("exit", stop);
process.on("SIGINT", () => {
	stop();
	process.exit(130);
});
process.on("SIGTERM", () => {
	stop();
	process.exit(143);
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
			`something else is already serving ${API_URL} — it has ${serving ?? "an unknown deck"} open, not the fixture at ${data}. Stop it and run again.`,
		);
	}
	console.log(`fixture: ${data}`);
	console.log(`running ${selected.length} check(s)${skipped.length ? `, skipping ${skipped.length}` : ""}`);
	// Said out loud, because it is the difference between a free run and a metered one.
	if (withAgent) console.log(`model: ${process.env.DECKS_E2E_MODEL || "whatever the runtime defaults to"}`);
	console.log("");

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
		/*
		 * Every line, on request — because "10 passed" is not the same as "10 things were
		 * true", and the difference matters most in the five files that need a model: an
		 * assertion whose subject never appeared can pass by reading `undefined`, and the
		 * only way to see that is to read what it printed beside itself.
		 */
		if (process.env.DECKS_E2E_VERBOSE === "1") {
			for (const line of result.output.split("\n")) {
				if (/^(PASS|FAIL)/.test(line)) console.log(`        ${line}`);
			}
		}
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
		const api = await ping(`${API_URL}/api/deck`);
		const web = await ping(`${WEB_URL}/`);
		if (api && web) return;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error("dev server did not come up within 90s");
}

async function deckPath() {
	try {
		const response = await fetch(`${API_URL}/api/deck`);
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
			/*
			 * The URLs go to the checks too, not only to the server.
			 *
			 * `harness.mjs` reads them, and every check goes through `open()` — so without
			 * them here a run on non-default ports spawns the fixture correctly and then has
			 * twenty-five checks navigate to whatever is on 4328, which is either nothing or,
			 * worse, somebody's live deck.
			 */
			env: { ...process.env, DECKS_E2E_MARKER: "decks-e2e", DECKS_E2E_API: API_URL, DECKS_E2E_WEB: WEB_URL },
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
