/**
 * Run the browser checks, each against a throwaway deck of its own.
 *
 * The fixture is a copy of `example/`, so the checks run on the same boards a reader can
 * open with `npm run dev:example` — and never on a deck somebody is working in. Every check
 * gets a fresh copy and a fresh server on it, so no check sees what another one did, and a
 * pool of workers (`DECKS_E2E_JOBS`, 4 by default) runs several at once. The copies live
 * under the system temp directory with `decks-e2e` in their names, which is what
 * `harness.preflight()` insists on before any check is allowed to write to a board.
 *
 *   npm run test:e2e                  # everything that does not need a model
 *   DECKS_E2E_AGENT=1 npm run test:e2e   # including the checks that prompt an agent
 *   DECKS_E2E_MODEL="muse-spark" DECKS_E2E_AGENT=1 npm run test:e2e   # …on a named model
 *   npm run test:e2e -- keys gestures    # just these
 *   DECKS_E2E_JOBS=1 npm run test:e2e    # one at a time (still a deck each)
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** `needsAgent` means it starts a turn, so it needs a model configured and will cost tokens. */
const CHECKS = [
	/*
	 * A core twelve, cut down from forty-five because the full suite took 8m17s and nothing
	 * that slow gets run between edits. These twelve are 297 of the old 857 assertions and
	 * about 121s; they were picked for assertions per second and for covering one surface
	 * each, not by theme.
	 *
	 * **The thirty-three that went are in git, not gone.** `git log --diff-filter=D
	 * --name-only -- e2e/checks` lists them; restoring one is a `git show` and a line here.
	 * Worth knowing what is no longer covered at all: touch and the phone layout
	 * (`mobile.mjs`, which was the most-cited check in this repo and the only place real
	 * touches were dispatched), the three board formats (`board-kinds.mjs`), embeds, file
	 * drops, thumbnails, streaming, scrollback paging, direct manipulation, the renderers,
	 * the shared-Chrome bridge, and the accounts surfaces.
	 *
	 * `accounts.mjs` was among them and was also the one check failing on main — its
	 * ordering assertion. Deleting it did not fix that; the ordering question is still open.
	 *
	 * Older removals, kept here because the reasons still explain absences: `header.mjs` and
	 * `panels.mjs` went when the title bar became two clusters and two panels became one,
	 * and `turn-bar.mjs` went with the spine itself.
	 */
	{ file: "panel.mjs", needsAgent: false },
	{ file: "tiers.mjs", needsAgent: false },
	{ file: "chat-content.mjs", needsAgent: false },
	{ file: "slash.mjs", needsAgent: false },
	{ file: "mirror.mjs", needsAgent: false },
	{ file: "inspector.mjs", needsAgent: false },
	{ file: "notifications.mjs", needsAgent: false },
	{ file: "modes.mjs", needsAgent: false },
	/* Commenting on selected words and drawing on a board, both while browsing. */
	{ file: "geometry.mjs", needsAgent: false },
	{ file: "agents-tab.mjs", needsAgent: false },
	/*
	 * Fullscreen for every format, on a board of each — which brings back the one thing the
	 * cut of `board-kinds.mjs` left with no coverage at all: a slides board and a flow board
	 * in the fixture. Until this check existed the suite only ever saw component boards,
	 * which is how a slides-only gate on fullscreen sat in the app unnoticed.
	 */
	{ file: "present.mjs", needsAgent: false },
	/*
	 * Code on a board: which blocks the runtime claims, and where their colours come from. Its
	 * own check because it is the one renderer whose output lives inside markup the file also
	 * wrote — so what it must *not* touch (a fence with no language, inline code) is as much
	 * of the subject as what it does.
	 */
	{ file: "highlighting.mjs", needsAgent: false },
	/*
	 * The renderer's own check, and the one that decides whether the editor may replace the frame:
	 * every board rendered by the new package, compared against the browser's parse of the same
	 * bytes. It needs no agent and no canvas — it drives `apps/web/editor.html`, which mounts only
	 * `@decks/editor`.
	 */
	{ file: "render-fidelity.mjs", needsAgent: false },
	/*
	 * What a press means: the four answers of phase 3's selection policy, driven by real presses
	 * through the editor's frame.
	 */
	{ file: "select-nodes.mjs", needsAgent: false },
	/*
	 * The gestures: drag, resize, duplicate, the palette, delete — one op each, driven by a real mouse.
	 * The other half of the proof is `editor-ops.test.ts` on the server, where those ops write files.
	 */
	{ file: "gestures.mjs", needsAgent: false },
	/*
	 * A flow document edited as fields. This is the other half of the fixture's flow board,
	 * and the first coverage in the suite of the *document* editor: the field half of
	 * `Editor.ts` ran on component boards only, and the reason a flow board was handed to the
	 * source textarea was an assumption about markdown that a flow board does not share.
	 */
	{ file: "editing.mjs", needsAgent: false },
	/*
	 * Which board is selected, and the one way in that did not work: a press on the board itself.
	 * Its own check because it is one rule with four readers — the inspector, the arrow keys, the
	 * focus view and the bar's own menu all ask the canvas which board is selected.
	 */
	{ file: "selection.mjs", needsAgent: false },
	/*
	 * A link on a board: a board in the deck opens beside the one that linked to it, anything
	 * else opens in a tab, and neither of them navigates the frame the board is drawn in.
	 */
	{ file: "board-links.mjs", needsAgent: false },
	/*
	 * A board's own code, run by pressing something on it. The one path where a click is not the
	 * permission: the board carries the words, the server reads them out of the file, and the
	 * first run asks. Needs no model, because nothing is prompted — the run is a click.
	 */
	{ file: "board-eval.mjs", needsAgent: false },
	{ file: "shell.mjs", needsAgent: false },
	/*
	 * The focus view: the canvas as one page. Its own check rather than a section of
	 * `modes.mjs`, because it needs the deck as it opens — a page that has been typed into by
	 * the sections before it is not a page any more.
	 */
	{ file: "focus.mjs", needsAgent: false },
	{ file: "camera.mjs", needsAgent: false },
	/* The "Canvas" renderer (`canvas-per-board`), an option in Settings: pictures stay drawn through a pan, pages stay clickable. */
	{ file: "canvas-per-board.mjs", needsAgent: false },
	/*
	 * Where a board lands when nobody said where, and whether the camera goes with it. Beside
	 * `camera.mjs` because the two halves are one experience: a board placed near what you have
	 * and a view that never moves to it is still a board you cannot find.
	 */
	{ file: "placement.mjs", needsAgent: false },
	/* The same rule when every camera is wrong: another window on another agent, this one panned away, a note in the slot. */
	{ file: "placement-views.mjs", needsAgent: false },
	/* An agent says where: newBoard and show with at, driven through a board's own code. */
	{ file: "placement-at.mjs", needsAgent: false },
	/*
	 * A camera that *arrives*. Its own check rather than a section of `camera.mjs`, because that
	 * one is about the camera's arithmetic and this one is about a clock: it samples the world
	 * transform every frame while a move is happening, which is a thing no other check does.
	 */
	{ file: "glide.mjs", needsAgent: false },
	{ file: "context.mjs", needsAgent: false },
	{ file: "per-agent.mjs", needsAgent: false },
	/*
	 * The four working marks: which drawing each runtime gets, what it animates, and that motion
	 * off leaves a finished mark rather than an empty one. Its own check because a mark is on
	 * screen for the whole of a turn and is the one thing here that is judged by looking.
	 */
	{ file: "working-marks.mjs", needsAgent: false },
	/*
	 * The agents list under the socket's own traffic: what a state change is allowed to touch.
	 * Not a section of `agents-tab.mjs`, because that check is about what a row *says* and this
	 * one is about what the DOM does when the same row's state changes underneath it.
	 */
	{ file: "panel-steady.mjs", needsAgent: false },
	/*
	 * The stage as a pen.dev file: boards as browser items in it, a drawing under them, and the
	 * same file reached from the wire, from a hand edit of the file, and from a drag in the page.
	 */
	{ file: "pen-stage.mjs", needsAgent: false },
	/* The stage is not a scroll container: a tall card opened for typing used to slide it off screen. */
	{ file: "stage-scroll.mjs", needsAgent: false },
	/* A card typed into as it reads: suggestions, the style bar, pieces that drag, untouched blocks kept. */
	{ file: "card-editor.mjs", needsAgent: false },
	/* The same card on a phone, by touch: a double tap opens it, taps accept, the sheet stands aside. */
	{ file: "card-phone.mjs", needsAgent: false },
	/*
	 * The stage's gestures against a design tool's and a notes app's: tools and a marquee in browse
	 * mode, selections that move together and snap, arrow ends, finger taps, and the pen's gestures.
	 */
	{ file: "stage-gestures.mjs", needsAgent: false },
	/*
	 * The canvas editor: a shape from the library, the properties panel that swaps, words and sizes
	 * it without ever scrolling sideways, and an arrow that keeps to the side it was drawn from.
	 */
	{ file: "shapes.mjs", needsAgent: false },
	/* A drag bends the arrows joined to what it carries: routed by the engine at each step, no tile painted again. */
	{ file: "bent-arrows.mjs", needsAgent: false },
	{ file: "item-pill.mjs", needsAgent: false },
	{ file: "engine-slide.mjs", needsAgent: false },
	{ file: "zoom-out-pictures.mjs", needsAgent: false },
	/* Zoomed in for a moment and out again, no board is left to a page that went to sleep: each shows its picture. */
	{ file: "live-pictures.mjs", needsAgent: false },
	/*
	 * What the stage draws with (`stage/backends/`), in Chromium and in WebKit as an iPhone: WebGL 2
	 * with no WebGPU, the notice with neither, a lost context started again, and a board's picture
	 * fetched sharper when a zoom in outgrows its copy.
	 */
	{ file: "backends.mjs", needsAgent: false },
	{ file: "context-loss.mjs", needsAgent: false },
	{ file: "sharper-pictures.mjs", needsAgent: false },
	/* A note's soft edge, painted in a tile and sent as an ImageBitmap, is not drawn too bright on WebGL 2. */
	{ file: "note-edges.mjs", needsAgent: false },
	/* The server's picture of the stage (`stage.screenshot`) has each drawn item where the canvas draws it, at zoom 1 and below. */
	{ file: "stage-shot.mjs", needsAgent: false },
	/* The engine's fixtures drawn alike on all three backends, and like the native goldens. */
	{ file: "stage-goldens.mjs", needsAgent: false },
	/* A dragged item is put down after its drop, back into the tiles. */
	{ file: "drop-lands.mjs", needsAgent: false },
	/*
	 * A film or a sound as an item on the canvas: pen's own rectangle marked `decks.media`, drawn
	 * as a still with a badge on it, and nothing decoding until it is pressed.
	 */
	{ file: "media.mjs", needsAgent: false },
	/* A frame things can be put into and taken out of, and the panel for how it holds them. */
	{ file: "frames.mjs", needsAgent: false },
	/* A → B → A: whether a canvas comes back where it was left. */
	{ file: "camera-roundtrip.mjs", needsAgent: false },
	/*
	 * The stage manager: what stages exist, and the person's way between them. The one surface
	 * where a deck of several stages is visible at all — the pill's name, the panel of cards, the
	 * search, and the landing.
	 */
	{ file: "stages.mjs", needsAgent: false },
	/* The SDK redesign's view calls in a real browser: reload counted per page, goto, focus on a named canvas. */
	{ file: "view-calls.mjs", needsAgent: false },
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
 * The ports, from the environment: the **base** pair, from which every worker's own pair is
 * derived (`API + 2·i`, `WEB + 2·i`), so worker 0 is on exactly the ports a run always used.
 *
 * They were fixed at 4329/4328, which was fine while there was one deck on a machine and
 * is not now: a suite cannot run while a live deck holds the port, and `strictPort` makes
 * that a failure rather than a quiet move. `harness.mjs` reads `DECKS_E2E_API`/`DECKS_E2E_WEB`;
 * each check is handed its own worker's pair in those two, so the two halves always agree.
 */
const API_BASE = Number(process.env.DECKS_E2E_API_PORT ?? 4329);
const WEB_BASE = Number(process.env.DECKS_E2E_WEB_PORT ?? 4328);
/*
 * How many checks run at once. Each worker is a Vite of its own and, per check, a server of its
 * own on a deck of its own and the check's own browser — so nothing a check does is seen by
 * another, and the order they run in stops mattering. Four is what this machine (10 cores) runs
 * without checks timing out; `DECKS_E2E_JOBS=1` is the old one-after-another, still isolated.
 */
const JOBS = Math.max(1, Math.min(Number(process.env.DECKS_E2E_JOBS ?? 4) || 1, selected.length || 1));
const urls = (i) => ({ api: `http://127.0.0.1:${API_BASE + 2 * i}`, web: `http://127.0.0.1:${WEB_BASE + 2 * i}`, apiPort: API_BASE + 2 * i, webPort: WEB_BASE + 2 * i });

/*
 * Set in this process too, for worker 0, so anything that reads the harness's defaults here reads
 * a port this run owns rather than 4329 — which on a machine with a live Decks open is somebody's
 * real canvas. (The runner used to call `resetStage()` with no argument and played the fixture's
 * boards onto that deck; it passes its worker's URL explicitly now, and this stays as the floor.)
 */
process.env.DECKS_E2E_API = urls(0).api;
process.env.DECKS_E2E_WEB = urls(0).web;
const { resetStage } = await import("./harness.mjs");

/** Every process group this run started, so every way out can take them with it. */
const groups = new Set();
/** Every deck copy, for the same reason. */
const decks = new Set();
let stopping = false;

const stopAll = () => {
	stopping = true;
	/*
	 * SIGKILL, to the group. `npm run dev:web` is npm around Vite around esbuild, and each server is
	 * spawned `detached`, which is what gives its whole tree one negative pid. Only the groups this
	 * run started — never a pattern: other worktrees run their own suites on other ports.
	 */
	for (const pid of groups) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	groups.clear();
	for (const deck of decks) rmSync(deck, { recursive: true, force: true });
	decks.clear();
};
process.on("exit", stopAll);
process.on("SIGINT", () => {
	stopAll();
	process.exit(130);
});
process.on("SIGTERM", () => {
	stopAll();
	process.exit(143);
});

/** A fresh copy of `example/`, as a check may find it: its own, so whatever it writes is gone after it. */
function freshDeck() {
	const data = mkdtempSync(join(tmpdir(), "decks-e2e-"));
	decks.add(data);
	cpSync(join(root, "example"), data, { recursive: true });
	// `example/decks/lib` is generated and gitignored, so a fresh clone has to be given one or every
	// board in the fixture loads without its stylesheet.
	cpSync(join(root, "runtime", "lib"), join(data, "decks", "lib"), { recursive: true });
	// Revisions and agent transcripts from whoever ran the example deck last are not fixture.
	rmSync(join(data, "decks", ".decks"), { recursive: true, force: true });
	rmSync(join(data, "decks", ".pi"), { recursive: true, force: true });
	// Nor are the signed-in accounts: `example/claude-accounts` is gitignored but exists on any machine
	// where somebody has logged in from the example deck, and a fixture must not carry real credentials.
	rmSync(join(data, "claude-accounts"), { recursive: true, force: true });
	return data;
}

/** Anything at all listening on a port — not only something that answers HTTP. */
function listening(port) {
	return new Promise((done) => {
		const probe = connect({ host: "127.0.0.1", port });
		probe.once("connect", () => {
			probe.destroy();
			done(true);
		});
		probe.once("error", () => done(false));
		probe.setTimeout(1000, () => {
			probe.destroy();
			done(false);
		});
	});
}

function launch(command, args, { cwd, env, log }) {
	const child = spawn(command, args, { cwd, detached: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
	groups.add(child.pid);
	for (const stream of [child.stdout, child.stderr]) {
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => {
			log.push(chunk);
			if (log.length > 400) log.splice(0, log.length - 200);
		});
	}
	child.closed = new Promise((done) => child.once("close", done));
	return child;
}

/** Stop a tree politely, so the server closes the Chromium it may have opened, then for certain. */
async function halt(child, grace = 2500) {
	if (!groups.has(child.pid)) return;
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		/* already gone */
	}
	const timer = new Promise((done) => setTimeout(done, grace));
	await Promise.race([child.closed, timer]);
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		/* gone, which is what we wanted */
	}
	await Promise.race([child.closed, new Promise((done) => setTimeout(done, 1000))]);
	groups.delete(child.pid);
}

async function until(what, test, { timeout, child, every = 100 }) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (child && child.exitCode !== null) throw new Error(`${what} exited with ${child.exitCode}`);
		if (await test()) return;
		await new Promise((resolve) => setTimeout(resolve, every));
	}
	throw new Error(`${what} did not come up within ${Math.round(timeout / 1000)}s`);
}

async function ping(url) {
	try {
		return (await fetch(url)).ok;
	} catch {
		return false;
	}
}

async function deckPath(api) {
	try {
		const response = await fetch(`${api}/api/deck`);
		if (!response.ok) return undefined;
		return (await response.json())?.deck?.path;
	} catch {
		return undefined;
	}
}

/*
 * One worker's Vite, for the whole run. `npm run dev:web` with the worker's ports: it proxies
 * `/api` and `/ws` to `DECKS_PORT`, which is where each of the worker's servers comes up in turn.
 * Kept across checks because what it costs is the first page's transforms, and a Vite that
 * survives does those once.
 */
async function startWeb(i) {
	const { web, apiPort, webPort } = urls(i);
	const log = [];
	const child = launch("npm", ["run", "dev:web"], { cwd: root, log, env: { DECKS_PORT: String(apiPort), DECKS_WEB_PORT: String(webPort) } });
	await until(`vite on ${web}`, () => ping(`${web}/`), { timeout: 90000, child, every: 200 });
	return { child, log };
}

/*
 * One check's server: `node --import tsx src/index.ts`, the server package's `start` script,
 * spawned directly rather than through two layers of npm, on a deck nobody else has seen.
 *
 * `start`, not `dev`: a suite's server must not reload under the suite. `dev` runs it with
 * `node --watch`, so saving a source file part-way through a run restarted it and whichever
 * check was starting waited thirty seconds for a board and failed with nothing run.
 */
async function startServer(i, data) {
	const { api, web, apiPort, webPort } = urls(i);
	const log = [];
	const child = launch(process.execPath, ["--import", "tsx", "src/index.ts"], {
		cwd: join(root, "apps", "server"),
		log,
		/*
		 * With the `.bin` folders on PATH, as `npm run` would have put them, so whatever the server
		 * spawns by name is found the same way it is under `npm run e2e:serve`.
		 */
		env: { PATH: [join(root, "apps", "server", "node_modules", ".bin"), join(root, "node_modules", ".bin"), process.env.PATH].join(delimiter), DECKS_DATA_DIR: data, DECKS_E2E_MARKER: "decks-e2e", DECKS_PORT: String(apiPort), DECKS_WEB_PORT: String(webPort), DECKS_E2E_API: api, DECKS_E2E_WEB: web },
	});
	await until(`server on ${api}`, async () => (await deckPath(api)) !== undefined, { timeout: 60000, child, every: 100 });
	/*
	 * Confirm it is *our* server: a server that failed to bind leaves the checks talking happily
	 * to whatever else is listening — which is how a run once went against a scratch deck.
	 */
	const serving = await deckPath(api);
	if (!serving || !serving.startsWith(data)) throw new Error(`something else is serving ${api} — it has ${serving ?? "an unknown deck"} open, not ${data}`);
	return { child, log };
}

function runCheck(file, { api, web }) {
	return new Promise((done) => {
		const child = spawn(process.execPath, [file], {
			cwd: root,
			// The worker's URLs, which every `open()` and `deckState()` in the harness reads.
			env: { ...process.env, DECKS_E2E_MARKER: "decks-e2e", DECKS_E2E_API: api, DECKS_E2E_WEB: web },
			stdio: ["ignore", "pipe", "pipe"],
		});
		groups.add(child.pid);
		let output = "";
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding("utf8");
			stream.on("data", (chunk) => {
				output += chunk;
			});
		}
		child.on("close", (code) => {
			groups.delete(child.pid);
			done({ code, output });
		});
	});
}

function tally(output) {
	const lines = output.split("\n");
	return {
		pass: lines.filter((line) => line.startsWith("PASS")).length,
		fail: lines.filter((line) => line.startsWith("FAIL")).length,
	};
}

/*
 * Longest first, by the last run's times on this machine, so the pool does not end on one worker
 * running `panel.mjs` while three sit idle. Only the schedule; the report is in `CHECKS` order.
 */
const TIMINGS = join(root, "node_modules", ".cache", "decks-e2e", "timings.json");
function readTimings() {
	try {
		return JSON.parse(readFileSync(TIMINGS, "utf8"));
	} catch {
		return {};
	}
}
function writeTimings(timings) {
	try {
		mkdirSync(dirname(TIMINGS), { recursive: true });
		writeFileSync(TIMINGS, JSON.stringify(timings, null, "\t"));
	} catch {
		/* a cache, nothing more */
	}
}

let exitCode = 0;
const webs = [];
try {
	/*
	 * Refuse before starting anything if any port this run would use is taken. A taken port is
	 * another suite, a live deck or a stale run, and none of them are ours to talk to or to stop.
	 */
	for (let i = 0; i < JOBS; i++) {
		const { apiPort, webPort } = urls(i);
		for (const port of [apiPort, webPort]) {
			if (await listening(port)) throw new Error(`something else is already serving 127.0.0.1:${port}. Stop it, or move this run with DECKS_E2E_API_PORT/DECKS_E2E_WEB_PORT (workers use base + 2·i) or fewer DECKS_E2E_JOBS.`);
		}
	}
	console.log(`running ${selected.length} check(s)${skipped.length ? `, skipping ${skipped.length}` : ""} on ${JOBS} worker(s), each check on its own fixture deck (ports ${API_BASE}/${WEB_BASE} + 2·i)`);
	// Said out loud, because it is the difference between a free run and a metered one.
	if (withAgent) console.log(`model: ${process.env.DECKS_E2E_MODEL || "whatever the runtime defaults to"}`);
	console.log("");

	const started = Date.now();
	/*
	 * Vite 0 first and on its own: it is the one that may re-optimize dependencies into
	 * `node_modules/.vite`, and the others should find that done rather than write it at once.
	 */
	webs[0] = await startWeb(0);
	await ping(`${urls(0).web}/src/index.tsx`);
	await Promise.all(Array.from({ length: JOBS - 1 }, async (_, k) => (webs[k + 1] = await startWeb(k + 1))));

	const timings = readTimings();
	const queue = [...selected].sort((a, b) => (timings[b.file] ?? 30) - (timings[a.file] ?? 30));
	const results = new Array(selected.length);
	let printed = 0;
	let pass = 0;
	let fail = 0;
	const failedFiles = [];
	let setup = 0;

	const report = () => {
		while (printed < selected.length && results[printed]) {
			const check = selected[printed];
			const { result, seconds } = results[printed];
			const counts = tally(result.output);
			pass += counts.pass;
			fail += counts.fail;
			const ok = counts.fail === 0 && result.code === 0;
			console.log(`${ok ? "  ok  " : "  FAIL"} ${check.file.padEnd(20)} ${String(counts.pass).padStart(2)} passed  ${seconds}s`);
			/*
			 * Every line, on request — because "10 passed" is not the same as "10 things were true":
			 * an assertion whose subject never appeared can pass by reading `undefined`.
			 */
			if (process.env.DECKS_E2E_VERBOSE === "1") {
				for (const line of result.output.split("\n")) if (/^(PASS|FAIL)/.test(line)) console.log(`        ${line}`);
			}
			if (!ok) {
				failedFiles.push(check.file);
				for (const line of result.output.split("\n")) if (/^FAIL/.test(line)) console.log(`        ${line}`);
				// Whenever the process failed, not only when nothing ran: a script that throws after
				// three passing checks looked like a silent failure.
				if (result.code !== 0) {
					console.log(`        exited ${result.code} — tail of its output:`);
					for (const line of result.output.trim().split("\n").slice(-(Number(process.env.DECKS_E2E_TAIL) || 8))) console.log(`        ${line}`);
				}
			}
			printed += 1;
		}
	};

	const worker = async (i) => {
		while (queue.length > 0 && !stopping) {
			const check = queue.shift();
			const index = selected.indexOf(check);
			const data = freshDeck();
			let server;
			let result;
			let at = Date.now();
			try {
				server = await startServer(i, data);
				setup += Date.now() - at;
				at = Date.now();
				// The whole deck on the canvas, where the fixture puts it: most checks expect to see every board.
				await resetStage(urls(i).api);
				result = await runCheck(join(here, "checks", check.file), urls(i));
			} catch (error) {
				const tail = server?.log.join("").trim().split("\n").slice(-10).join("\n") ?? "";
				result = { code: 1, output: `FAIL  runner — ${error.message}\n${tail}` };
			}
			const seconds = ((Date.now() - at) / 1000).toFixed(1);
			timings[check.file] = Number(seconds);
			if (server) await halt(server.child);
			rmSync(data, { recursive: true, force: true });
			decks.delete(data);
			results[index] = { result, seconds };
			report();
		}
	};
	await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i)));
	writeTimings(timings);

	/*
	 * Failed *files* as well as failed assertions: a check that dies on its first import prints no
	 * assertion at all, and the summary once said "256 passed, 0 failed" with one whole file red.
	 */
	console.log(`\n${pass} passed, ${fail} failed assertions, ${failedFiles.length} failed check(s), ${((Date.now() - started) / 1000).toFixed(0)}s on ${JOBS} worker(s)`);
	console.log(`  (a fresh deck and server per check: ${(setup / 1000 / Math.max(1, selected.length)).toFixed(1)}s each, before its time above)`);
	if (wanted.length > 0 && skipped.length > 0) console.log(`  skipped ${skipped.length} not selected`);
	else for (const check of skipped) console.log(`  skipped ${check.file} (needs a model; set DECKS_E2E_AGENT=1)`);
	if (fail > 0 || failedFiles.length > 0) exitCode = 1;
} catch (error) {
	console.error(`e2e: ${error.message}`);
	for (const web of webs) if (web) console.error(web.log.join("").split("\n").slice(-10).join("\n"));
	exitCode = 1;
} finally {
	stopAll();
}
process.exit(exitCode);
