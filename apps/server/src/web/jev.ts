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

export interface JevRunSpec {
	url: string;
	goal: string;
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
}

export interface JevStatus {
	/** A run could start now: keys present and nothing already running. */
	ready: boolean;
	/** The environment variables a run needs and does not have. */
	missing: string[];
	running?: { id: string; url: string; goal: string; startedAt: number; steps: number };
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

/** The one key without which no decision can be made. `TEXT_MODEL_API_KEY` is only needed to type. */
const REQUIRED = ["TYPESAFE_API_KEY"];
/** A run this long has stopped making progress; the library's own step budget usually ends it first. */
const MAX_RUN_MS = 180_000;

export class JevService {
	private current: JevRun | undefined;
	private child: JevRunnerProcess | undefined;
	private closeBrowser: (() => Promise<void>) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly backend: JevBackend = realBackend()) {}

	status(): JevStatus {
		const keys = this.backend.keys();
		const missing = REQUIRED.filter((name) => !keys[name]?.trim());
		const running = this.current && !this.current.endedAt ? this.current : undefined;
		const last = this.current?.endedAt ? this.current : undefined;
		return {
			ready: missing.length === 0 && !running,
			missing,
			...(running ? { running: { id: running.id, url: running.url, goal: running.goal, startedAt: running.startedAt, steps: running.steps.length } } : {}),
			...(last ? { last: { id: last.id, status: last.status, steps: last.steps.length, elapsedMs: last.elapsedMs, ...(last.note ? { note: last.note } : {}) } } : {}),
			note: missing.length > 0
				? `Set ${missing.join(" and ")} in the server's environment; without it no run can start.`
				: running
					? "A run is going; stage.web_jev.state() follows it, stage.web_jev.stop() ends it."
					: "Ready. stage.web_jev.run({ url, goal }) starts a run; state() follows it.",
		};
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
		const missing = REQUIRED.filter((name) => !keys[name]?.trim());
		if (missing.length > 0) throw new Error(`Set ${missing.join(" and ")} in the server's environment; without it no run can start.`);

		const run: JevRun = { id: randomUUID(), url, goal, startedAt: Date.now(), status: "starting", elapsedMs: 0, steps: [] };
		this.current = run;
		let browser: { cdpUrl: string; close(): Promise<void> };
		try {
			browser = await this.backend.browser();
		} catch (error) {
			await this.end(run, "failed", `The browser could not launch: ${(error as Error).message}`);
			throw new Error(`The browser could not launch: ${(error as Error).message}`);
		}
		this.closeBrowser = browser.close;
		/*
		 * The harness daemon this run starts lives in a directory of the run's own, so two
		 * runs can never find each other's daemon, and the runner's finally block knows
		 * exactly which daemon to stop.
		 */
		const runtimeDir = mkdtempSync(join(tmpdir(), "decks-jev-"));
		const passthrough = Object.fromEntries(Object.entries(keys).filter(([, value]) => typeof value === "string" && value)) as Record<string, string>;
		let child: JevRunnerProcess;
		try {
			child = await this.backend.runner(spec, { ...passthrough, BU_CDP_URL: browser.cdpUrl, BU_NAME: "decks-jev", BH_RUNTIME_DIR: runtimeDir });
		} catch (error) {
			await this.end(run, "failed", `The runner could not start: ${(error as Error).message}`);
			rmSync(runtimeDir, { recursive: true, force: true });
			throw new Error(`The runner could not start: ${(error as Error).message}`);
		}
		this.child = child;
		this.timer = setTimeout(() => void this.stop(`Stopped after ${Math.round(MAX_RUN_MS / 1000)} seconds.`), MAX_RUN_MS);

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
		return { id: run.id, note: "Started. stage.web_jev.state() follows it; each step is one decision the model made." };
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
