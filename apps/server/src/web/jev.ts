/**
 * `stage.web_jev` — a goal-driven browser agent beside the primitive-driven `stage.web`.
 *
 * `stage.web` drives the person's own Chrome one verb at a time: the agent reads, clicks
 * and fills, and the person watches their own tab. This toolkit is the other shape of the
 * same job: hand jev-ultrafast (browser-use's agent with a dynamic, indexed action space)
 * one URL and one goal, and it drives a browser of its own until the goal is done or it
 * is blocked. The browser is a headless Chromium this server launches — never the
 * person's Chrome, which stays the extension's and the person's.
 *
 * A run outlives a stage call (a stage run is abandoned after 20 seconds; a jev run is
 * seconds to minutes), so the surface is a job: `run` starts one and returns at once,
 * `state` is the transcript so far, `stop` ends it, `status` says whether a run can start
 * at all. One run at a time, like `web` drives one tab.
 *
 * The Python side is vendored in `runtime/jev/` (MIT): `runner.py` wraps the library and
 * writes one JSON line per decision cycle, this class only parses lines. Its environment
 * needs two things this class checks for rather than assumes: a venv with the library's
 * two dependencies (made once, under `~/.cache/decks-jev`), and the model keys —
 * `TYPESAFE_API_KEY` for the decision model, `TEXT_MODEL_API_KEY` when a goal needs text
 * typed. Missing keys are a sentence in `status()`, not a crash in the middle of a run.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { jevDir } from "@decks/runtime";
import { WebGate, type GateEvent, type GateHooks, type GateQuestion } from "@decks/web-gate";

export interface JevRunSpec {
	url: string;
	goal: string;
	/**
	 * Which browser the run drives.
	 *
	 * `chrome` is the tab the person shared with the deck, through the extension relay: the
	 * logins are theirs and the two gates hold anything that sends or types. `headless` is a
	 * Chromium this server launches, with nobody logged in and nothing to protect. Left out,
	 * a shared Chrome is used when there is one, because that is the run that can reach the
	 * page the goal is about.
	 */
	browser?: "chrome" | "headless";
}

/** One decision cycle, as the runner reported it. */
export interface JevStep {
	at: number;
	status: string;
	elapsedMs: number;
	steps: number;
	url?: string;
	/** The action the cycle executed: its label, the operation, and any text typed. */
	last?: { action: string; operation: string; text: string | null };
}

export interface JevRun {
	id: string;
	url: string;
	goal: string;
	startedAt: number;
	/** `starting` until the first line, then the runner's word; the rest are this class's. */
	status: "starting" | "running" | "done" | "blocked" | "failed" | "stopped";
	elapsedMs: number;
	steps: JevStep[];
	/** Why it ended, when it did not end with `done`. */
	note?: string;
	endedAt?: number;
	/** Where it is driving. */
	browser: "chrome" | "headless";
	/** What a gate is holding, while it holds it: nothing else in the run moves until this is answered. */
	waiting?: { id: string; kind: "allow" | "words"; action: string; tab?: string; field?: string; since: number };
	/** What the gates did, oldest first — the run's own record of what it was not allowed to do alone. */
	gate: GateEvent[];
}

/** How many gate events a run keeps. Enough to read the run's shape; not a log. */
const GATE_KEPT = 40;

/**
 * The person, when there is one to ask.
 *
 * A gate's question goes two ways at once: the status board, where the person can allow it,
 * and `stage.web_jev.answer`, where the agent supervising the run can. Whichever answers
 * first settles it, and the run carries on either way.
 */
export interface JevOptions {
	/** Ask the person, through the status board. False when there is no board to ask on. */
	person?: (text: string) => Promise<boolean>;
	/**
	 * Let go of the shared tab for the length of a run, and say how to take it back.
	 *
	 * A tab is driven by one CDP client at a time, so a browser agent running a goal in the
	 * person's own Chrome borrows the connection rather than sharing it. What comes back is the
	 * function that hands the tab to `stage.web` again.
	 */
	borrow?: () => Promise<() => Promise<void>>;
}

/** How long a held run waits for an answer before the gate refuses it. */
const HELD_MS = 120_000;

/**
 * What the agent is told about the browser it is in, when that browser is somebody's own.
 *
 * This is a courtesy, not the enforcement: the gates are in the wire and hold whether or not
 * the agent read this. What it buys is an agent that does not spend its steps fighting them —
 * one that reports what it reached instead of retrying a press that was refused.
 */
const SUPERVISED = [
	"This browser is supervised, and two things are not yours to do alone.",
	"The words that go into a field come from the person watching, not from you: type as usual, and treat what a field contains as correct even if it is not what you asked for.",
	"A press that would send, buy, post, confirm or delete is held for approval and may be refused. If an action comes back refused, do not try it again by another route: stop and report what you reached.",
].join(" ");

export interface JevStatus {
	/** A run could start now: keys present and nothing already running. */
	ready: boolean;
	/** The environment variables a run needs and does not have. */
	missing: string[];
	/** A Chrome is shared, so a run without a `browser` drives the person's own tab. */
	shared: boolean;
	running?: { id: string; url: string; goal: string; startedAt: number; steps: number; browser: "chrome" | "headless"; waiting?: JevRun["waiting"] };
	last?: { id: string; status: string; steps: number; elapsedMs: number; note?: string };
	note: string;
}

/**
 * What the real machinery is behind: the keys, a browser, a runner process. A test hands
 * in a fake whose runner is a Node one-liner printing the same lines, so the state
 * machine is tested without Python, Chromium or a network.
 */
export interface JevBackend {
	keys(): Record<string, string | undefined>;
	/** A browser for one run: where its CDP endpoint is, and how to close it. */
	browser(): Promise<{ cdpUrl: string; close(): Promise<void> }>;
	/** The runner process for one run, with the run's environment on top of the server's. */
	runner(spec: JevRunSpec, env: Record<string, string>): Promise<JevRunnerProcess>;
}

/** The little of a child process this class reads — what `spawn` returns satisfies it. */
export interface JevRunnerProcess {
	stdout: NodeJS.ReadableStream;
	stderr: NodeJS.ReadableStream;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "close", listener: (code: number | null) => void): unknown;
}

/**
 * The one key without which no decision can be made — and which key that is depends on who
 * answers. TypeSafe's own model needs `TYPESAFE_API_KEY`; a chat model standing in for it needs
 * its own, and a server running that way should not be told it is missing a key it will never
 * use. `TEXT_MODEL_API_KEY` is only needed to type, and a run in the shared Chrome never types
 * a word of its own: the words come from whoever is supervising it.
 */
function requiredKeys(): string[] {
	return process.env.JEV_DECISION === "chat" ? ["JEV_DECISION_API_KEY"] : ["TYPESAFE_API_KEY"];
}
/** A run this long has stopped making progress; the library's own step budget usually ends it first. */
const MAX_RUN_MS = 180_000;

export class JevService {
	private current: JevRun | undefined;
	private child: JevRunnerProcess | undefined;
	private closeBrowser: (() => Promise<void>) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** The gate holding the run, while it holds it. One at a time, like the run. */
	private holding: { id: string; settle: (answer: boolean | string) => void; refuse: () => void; timer: ReturnType<typeof setTimeout> } | undefined;

	constructor(
		private readonly backend: JevBackend = realBackend(),
		private readonly options: JevOptions = {},
	) {}

	status(): JevStatus {
		const keys = this.backend.keys();
		const missing = requiredKeys().filter((name) => !keys[name]?.trim());
		const running = this.current && !this.current.endedAt ? this.current : undefined;
		const last = this.current?.endedAt ? this.current : undefined;
		const shared = this.sharedEndpoint !== undefined;
		return {
			ready: missing.length === 0 && !running,
			missing,
			shared,
			...(running ? { running: { id: running.id, url: running.url, goal: running.goal, startedAt: running.startedAt, steps: running.steps.length, browser: running.browser, ...(running.waiting ? { waiting: running.waiting } : {}) } } : {}),
			...(last ? { last: { id: last.id, status: last.status, steps: last.steps.length, elapsedMs: last.elapsedMs, ...(last.note ? { note: last.note } : {}) } } : {}),
			note: missing.length > 0
				? `Set ${missing.join(" and ")} in the server's environment; without it no run can start.`
				: running
					? running.waiting
						? `A gate is holding the run: it wants to ${running.waiting.action}. Answer it with stage.web_jev.answer(${running.waiting.kind === "words" ? '{ text: "…" }' : "{ allow: true }"})${this.options.person ? ", or on the status board" : ""}.`
						: "A run is going; stage.web_jev.state() follows it, stage.web_jev.stop() ends it."
					: shared
						? "Ready, in your own Chrome: stage.web_jev.run({ url, goal }) starts a run in the tab you shared, and stops before anything is sent or typed."
						: "Ready, in a browser of the server's own: stage.web_jev.run({ url, goal }) starts a run. Share a tab to run it in your own Chrome instead.",
		};
	}

	/**
	 * Answer what a gate is holding.
	 *
	 * The two answers are different questions. `allow` is the yes or no before something is
	 * sent; `text` is what actually goes into a field, because the words are the supervising
	 * agent's and never the browser agent's own.
	 */
	answer(input: { allow?: boolean; text?: string }): { answered: string } {
		const run = this.current;
		const holding = this.holding;
		const waiting = run?.waiting;
		if (!run || !holding || !waiting) throw new Error("Nothing is waiting: stage.web_jev.state() shows the run and what it is doing.");
		if (waiting.kind === "words") {
			if (typeof input.text !== "string" || !input.text) throw new Error(`The run is waiting for text to type into ${waiting.field ?? "a field"}: stage.web_jev.answer({ text: "…" })`);
			holding.settle(input.text);
			return { answered: `${input.text.length} characters for ${waiting.field ?? "a field"}` };
		}
		if (typeof input.allow !== "boolean") throw new Error(`The run is waiting for a yes or no: it wants to ${waiting.action}. stage.web_jev.answer({ allow: true }) or { allow: false }.`);
		holding.settle(input.allow);
		return { answered: input.allow ? `allowed: ${waiting.action}` : `refused: ${waiting.action}` };
	}

	/** The endpoint of a Chrome somebody is logged into, as the bridge last reported it. */
	private sharedEndpoint: string | undefined;

	/**
	 * Told when a Chrome connects or goes away.
	 *
	 * Pushed rather than pulled: `status()` is a synchronous read an agent makes on every turn,
	 * and asking the bridge whether a browser is attached is not something it can do in the
	 * middle of one.
	 */
	setShared(endpoint: string | undefined): void {
		this.sharedEndpoint = endpoint;
	}

	/**
	 * Start one run. Returns as soon as the browser and the runner are up — the run
	 * itself is followed with `state()`, because nothing can wait for it inside a
	 * twenty-second stage call.
	 */
	async run(spec: JevRunSpec): Promise<{ id: string; note: string }> {
		const url = spec.url?.trim();
		const goal = spec.goal?.trim();
		if (!url) throw new Error("run needs a URL to start from");
		if (!goal) throw new Error("run needs a goal, in a sentence or two");
		if (this.current && !this.current.endedAt) throw new Error("A run is already going; stage.web_jev.stop() ends it, state() follows it.");
		const keys = this.backend.keys();
		const missing = requiredKeys().filter((name) => !keys[name]?.trim());
		if (missing.length > 0) throw new Error(`Set ${missing.join(" and ")} in the server's environment; without it no run can start.`);

		/*
		 * Which browser, decided here and nowhere else.
		 *
		 * A shared Chrome is the default because a goal is usually about a page behind a login,
		 * and the gates are what make that safe: the run drives the person's own tab and stops at
		 * the two things it may not do alone. `headless` is how an agent asks for the browser
		 * nobody is logged into, and is the only way to run with no Chrome shared at all.
		 */
		const shared = spec.browser === "headless" ? undefined : this.sharedEndpoint;
		const where: "chrome" | "headless" = shared ? "chrome" : "headless";
		if (spec.browser === "chrome" && !shared)
			throw new Error('No Chrome is shared with the deck, so there is nothing to drive. Share a tab from the Decks extension, or run with { browser: "headless" } in a browser of the server\'s own.');

		const run: JevRun = { id: randomUUID(), url, goal, startedAt: Date.now(), status: "starting", elapsedMs: 0, steps: [], browser: where, gate: [] };
		this.current = run;
		let launched: { cdpUrl: string; close(): Promise<void> };
		try {
			launched = shared ? await this.gated(shared, run) : await this.backend.browser();
		} catch (error) {
			await this.end(run, "failed", `The browser could not launch: ${(error as Error).message}`);
			throw new Error(`The browser could not launch: ${(error as Error).message}`);
		}
		this.closeBrowser = launched.close;
		/*
		 * The harness daemon this run starts lives in a directory of the run's own, so two
		 * runs can never find each other's daemon, and the runner's finally block knows
		 * exactly which daemon to stop.
		 */
		const runtimeDir = mkdtempSync(join(tmpdir(), "decks-jev-"));
		const passthrough = Object.fromEntries(Object.entries(keys).filter(([, value]) => typeof value === "string" && value)) as Record<string, string>;
		let child: JevRunnerProcess;
		try {
			const told = where === "chrome" ? { ...spec, url, goal: `${goal}\n\n${SUPERVISED}` } : { ...spec, url, goal };
			child = await this.backend.runner(told, { ...passthrough, BU_CDP_URL: launched.cdpUrl, BU_NAME: "decks-jev", BH_RUNTIME_DIR: runtimeDir });
		} catch (error) {
			await this.end(run, "failed", `The runner could not start: ${(error as Error).message}`);
			rmSync(runtimeDir, { recursive: true, force: true });
			throw new Error(`The runner could not start: ${(error as Error).message}`);
		}
		this.child = child;
		this.armTimer();

		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			for (let cut = buffer.indexOf("\n"); cut >= 0; cut = buffer.indexOf("\n")) {
				const line = buffer.slice(0, cut).trim();
				buffer = buffer.slice(cut + 1);
				if (line) this.line(run, line);
			}
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-2000);
		});
		child.on("close", (code) => {
			if (this.child === child) this.child = undefined;
			rmSync(runtimeDir, { recursive: true, force: true });
			if (run.endedAt) return;
			// The process ended without an `end` or `error` line: say what the exit said.
			const tail = stderr.trim().split("\n").at(-1);
			void this.end(run, "failed", code === 0 ? "The runner ended without a result." : `The runner exited ${code}${tail ? `: ${tail}` : "."}`);
		});
		return {
			id: run.id,
			note:
				where === "chrome"
					? "Started in the tab you shared. It stops at anything that sends or types: stage.web_jev.state() shows the run, and answer() is how a held one carries on."
					: "Started. stage.web_jev.state() follows it; each step is one decision the model made.",
		};
	}

	/** The run going now, or the last one: the whole transcript of steps. */
	state(): JevRun {
		if (!this.current) throw new Error("No run has been started; stage.web_jev.run({ url, goal }) starts one.");
		return this.current;
	}

	/** End the run: the runner gets SIGTERM (its finally still runs), the browser closes. */
	async stop(note = "Stopped."): Promise<void> {
		const run = this.current;
		if (!run || run.endedAt) return;
		this.child?.kill("SIGTERM");
		await this.end(run, "stopped", note);
	}

	async dispose(): Promise<void> {
		await this.stop("The server is shutting down.");
	}

	// --- the two gates ---------------------------------------------------------------

	/**
	 * The shared Chrome, behind the gate.
	 *
	 * The agent attaches to this exactly as it would attach to a browser, which is the whole
	 * point: the gate is a wire it cannot see past, not an instruction it could talk its way
	 * out of. What comes out the other side is the person's own tab, logged in as them.
	 */
	private async gated(upstream: string, run: JevRun): Promise<{ cdpUrl: string; close(): Promise<void> }> {
		const hooks: GateHooks = {
			allow: (question) => this.askToSend(question),
			words: (question) => this.askForWords(question),
		};
		/*
		 * The tab is borrowed before the gate is built and given back when it closes, so the two
		 * halves of the browser work are never attached at once: `stage.web` would be reading a
		 * page a browser agent is halfway through changing.
		 */
		const release = await this.options.borrow?.();
		let gate: WebGate;
		try {
			gate = await WebGate.start({ upstream, hooks, onEvent: (event) => this.gateEvent(run, event) });
		} catch (error) {
			await release?.();
			throw error;
		}
		return {
			cdpUrl: gate.cdpUrl,
			close: async () => {
				await gate.close();
				await release?.();
			},
		};
	}

	/** What the gates did, kept on the run so `state()` says what the agent was not allowed to do alone. */
	private gateEvent(run: JevRun, event: GateEvent): void {
		run.gate.push(event);
		while (run.gate.length > GATE_KEPT) run.gate.shift();
		/*
		 * A held run is not a run making no progress, so the ceiling that ends a stuck one is put
		 * down while a question is out and picked up again when it is answered.
		 */
		if (event.kind === "held") this.disarmTimer();
		else if (event.kind !== "closed") this.armTimer();
	}

	/** Before something is sent: the person on the status board, or the agent on its next turn. */
	private askToSend(question: GateQuestion): Promise<boolean> {
		return this.hold<boolean>(question, false, (settle) => {
			const line = `A browser agent wants to ${question.action}${question.tab ? ` on ${question.tab}` : ""}. Allow?`;
			void this.options.person?.(line).then((allowed) => settle(allowed));
		});
	}

	/** Instead of the agent's own words: the text that actually goes into the field. */
	private askForWords(question: GateQuestion): Promise<string> {
		return this.hold<string>(question, "", () => {});
	}

	/**
	 * One held command: recorded on the run, and settled by whoever answers first.
	 *
	 * A question nobody answers is refused rather than allowed, and the timer here is what
	 * makes that true even when the caller never comes back.
	 */
	private hold<T extends boolean | string>(question: GateQuestion, refused: T, also: (settle: (answer: T) => void) => void): Promise<T> {
		const run = this.current;
		if (!run) return Promise.resolve(refused);
		return new Promise<T>((resolve) => {
			const settle = (answer: T) => {
				if (this.holding?.id !== question.id) return;
				clearTimeout(this.holding.timer);
				this.holding = undefined;
				if (run.waiting?.id === question.id) run.waiting = undefined;
				resolve(answer);
			};
			const timer = setTimeout(() => settle(refused), HELD_MS);
			timer.unref?.();
			this.holding = { id: question.id, settle: settle as (answer: boolean | string) => void, refuse: () => settle(refused), timer };
			run.waiting = { id: question.id, kind: question.kind, action: question.action, ...(question.tab ? { tab: question.tab } : {}), ...(question.field ? { field: question.field } : {}), since: Date.now() };
			also(settle);
		});
	}

	private armTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.stop(`Stopped after ${Math.round(MAX_RUN_MS / 1000)} seconds.`), MAX_RUN_MS);
		this.timer.unref?.();
	}

	private disarmTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private line(run: JevRun, raw: string): void {
		let parsed: { t?: string; status?: string; elapsed_ms?: number; steps?: number; url?: string; note?: string; last?: JevStep["last"] };
		try {
			parsed = JSON.parse(raw);
		} catch {
			return; // A stray print is not a state.
		}
		if (run.endedAt) return;
		if (parsed.t === "state") {
			run.status = "running";
			run.elapsedMs = parsed.elapsed_ms ?? run.elapsedMs;
			run.steps.push({
				at: Date.now(),
				status: parsed.status ?? "ready",
				elapsedMs: parsed.elapsed_ms ?? 0,
				steps: parsed.steps ?? run.steps.length,
				...(parsed.url ? { url: parsed.url } : {}),
				...(parsed.last ? { last: parsed.last } : {}),
			});
		} else if (parsed.t === "end") {
			run.elapsedMs = parsed.elapsed_ms ?? run.elapsedMs;
			void this.end(run, parsed.status === "done" ? "done" : "blocked", parsed.status === "done" ? undefined : "The agent stopped: the goal did not advance.");
		} else if (parsed.t === "error") {
			void this.end(run, "failed", parsed.note ?? "The runner failed without saying why.");
		}
	}

	private async end(run: JevRun, status: JevRun["status"], note?: string): Promise<void> {
		if (run.endedAt) return;
		run.status = status;
		if (note) run.note = note;
		run.endedAt = Date.now();
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		/*
		 * A question that outlived its run is refused, not left hanging: the gate would otherwise
		 * sit on a socket nothing is reading.
		 */
		if (this.holding) {
			clearTimeout(this.holding.timer);
			const refuse = this.holding.refuse;
			this.holding = undefined;
			if (run.waiting) run.waiting = undefined;
			refuse();
		}
		const close = this.closeBrowser;
		this.closeBrowser = undefined;
		try {
			await close?.();
		} catch {
			// The browser was already gone; the run's own result stands.
		}
	}
}

/** Where the venv lives: machine-level like Playwright's browser cache, surviving deploys. */
export function venvDir(): string {
	return join(homedir(), ".cache", "decks-jev", "venv");
}

/**
 * The real backend: keys from the process environment, a Playwright Chromium with a CDP
 * port for browser-harness to attach to, and the vendored runner in a venv made on first
 * use (two pip packages; the one step that needs the network).
 */
function realBackend(): JevBackend {
	return {
		keys: () => ({
			TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
			TYPESAFE_MODEL: process.env.TYPESAFE_MODEL,
			TEXT_MODEL_API_KEY: process.env.TEXT_MODEL_API_KEY,
			TEXT_MODEL_BASE_URL: process.env.TEXT_MODEL_BASE_URL,
			TEXT_MODEL: process.env.TEXT_MODEL,
			TEXT_MODEL_REASONING: process.env.TEXT_MODEL_REASONING,
			// A decision model other than TypeSafe's own (`runtime/jev/decision_chat.py`).
			// Passed through like the rest, because the runner is what decides to use it.
			JEV_DECISION: process.env.JEV_DECISION,
			JEV_DECISION_API_KEY: process.env.JEV_DECISION_API_KEY,
			JEV_DECISION_BASE_URL: process.env.JEV_DECISION_BASE_URL,
			JEV_DECISION_MODEL: process.env.JEV_DECISION_MODEL,
			JEV_DECISION_SESSION: process.env.JEV_DECISION_SESSION,
			JEV_DECISION_MAX_TOKENS: process.env.JEV_DECISION_MAX_TOKENS,
		}),
		browser: async () => {
			const port = await freePort();
			const playwright = await import("playwright");
			const browser = await playwright.chromium.launch({ args: [`--remote-debugging-port=${port}`] });
			return { cdpUrl: `http://127.0.0.1:${port}`, close: () => browser.close() };
		},
		runner: async (spec, env) => {
			const python = await ensureVenv();
			return spawn(python, [join(jevDir(), "runner.py"), JSON.stringify({ url: spec.url, goal: spec.goal })], {
				env: { ...process.env, ...env },
				stdio: ["ignore", "pipe", "pipe"],
			});
		},
	};
}

/** A port nobody holds right now. The gap to Chromium taking it is small and a collision is a failed run, not a wrong one. */
function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const probe = net.createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const port = (probe.address() as net.AddressInfo).port;
			probe.close(() => resolvePort(port));
		});
	});
}

/** The venv's python, made on first use. `browser-harness` is pinned to the version the vendored code was read against. */
async function ensureVenv(): Promise<string> {
	const python = join(venvDir(), "bin", "python");
	try {
		await access(python);
		return python;
	} catch {
		// Fall through to make it.
	}
	await mkdir(join(venvDir(), ".."), { recursive: true });
	await run("python3", ["-m", "venv", venvDir()]);
	await run(join(venvDir(), "bin", "pip"), ["install", "--quiet", "browser-harness==0.1.13", "httpx[http2]>=0.28,<1"]);
	return python;
}

function run(command: string, args: string[]): Promise<void> {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-1000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolveRun();
			else reject(new Error(`${command} exited ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`));
		});
	});
}
