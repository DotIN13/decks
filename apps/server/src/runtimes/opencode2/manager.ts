import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { opencode2Executable, opencode2Folders } from "./install.ts";

/**
 * One `opencode serve` (OpenCode 2) for every OpenCode 2 agent on the deck.
 *
 * The same design as opencode 1's `opencode/manager.ts`, written again rather than shared
 * because the two servers differ in every detail a manager touches: the listening line, how a
 * caller proves itself, which folders it is given and how its config arrives. What carries
 * over is the shape. The server is **reference counted** (the first agent brings it up, the
 * last one out stops it), its **start is memoised** (two agents starting at once share one
 * spawn) and it holds **one secret per lifetime**, minted fresh each time it starts.
 *
 * That secret does two jobs here. It is OpenCode 2's server password (`OPENCODE_PASSWORD`,
 * HTTP Basic as user `opencode`), so only Decks can drive the server; and it is the token
 * Decks' own tools send back to Decks (`DECKS_STAGE_TOKEN`), so only this server's tools can
 * reach the canvas.
 */

/** What the shared server is told about at spawn. Built by the first agent to acquire. */
export interface Opencode2ServerSpec {
	/** The server's working directory: the deck. */
	cwd: string;
	/** Where Decks' tools call back: Decks' own `/api/stage/eval`. */
	stageUrl: string;
	/**
	 * The inline config, `OPENCODE_CONFIG_CONTENT`. Decks' plugin and skills go here, by
	 * absolute path, on top of the person's own OpenCode 2 config. Nothing per agent: this is
	 * server-wide, and a model or mode written here would reach every chat.
	 */
	config: { plugins?: string[]; skills?: string[] };
}

export interface Opencode2ServerHandle {
	/** The URL the server announced. */
	url: string;
	/** The server's secret: its password, and the token its tools carry back to Decks. */
	secret: string;
	/** Give up this claim; the last claim out stops the server. Safe to call twice. */
	release(): void;
}

/** How the server process is started, overridable for tests. */
export interface Opencode2ManagerOptions {
	spawn?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => Opencode2Child;
	/** The environment the server is started from; the process's own by default. */
	env?: NodeJS.ProcessEnv;
}

/** The slice of a child process the manager touches. */
export interface Opencode2Child {
	stdout?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	stderr?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	kill(): boolean;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null) => void): unknown;
}

/** What OpenCode 2 prints when it is listening: `server listening on http://127.0.0.1:41713`. */
export const LISTENING = /server listening on\s+(https?:\/\/\S+)/;

export class Opencode2Manager {
	private readonly spawnImpl: (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => Opencode2Child;
	/** Whether this manager launches the binary itself, so a missing binary is a refusal. */
	private readonly launchesItself: boolean;
	private readonly baseEnv: NodeJS.ProcessEnv;
	private process: Opencode2Child | undefined;
	private secret = "";
	private refcount = 0;
	private starting: Promise<string> | undefined;
	private readonly exitListeners = new Set<() => void>();
	private dead = false;

	constructor(options: Opencode2ManagerOptions = {}) {
		this.launchesItself = options.spawn === undefined;
		this.baseEnv = options.env ?? process.env;
		this.spawnImpl = options.spawn ?? ((argv, env, cwd) => spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as Opencode2Child);
	}

	async acquire(spec: Opencode2ServerSpec): Promise<Opencode2ServerHandle> {
		this.refcount += 1;
		if (!this.starting) {
			this.secret = randomBytes(24).toString("base64url");
			this.dead = false;
			this.starting = this.startServer(spec).catch((error) => {
				// A server that never came up holds nobody's claim.
				this.refcount = 0;
				this.starting = undefined;
				throw error;
			});
		}
		const url = await this.starting;
		const secret = this.secret;
		let released = false;
		return {
			url,
			secret,
			release: () => {
				if (released) return;
				released = true;
				// A claim against an older server does not touch the newer one's count: the
				// secret is minted per lifetime, so an old handle's never equals the current one.
				if (secret !== this.secret) return;
				if (this.refcount > 0) this.refcount -= 1;
				if (this.refcount === 0 && !this.dead && this.process) this.teardown();
			},
		};
	}

	/** Told when the server dies under its agents; answers a function that stops telling. */
	onExit(listener: () => void): () => void {
		this.exitListeners.add(listener);
		return () => {
			this.exitListeners.delete(listener);
		};
	}

	alive(): boolean {
		return this.process !== undefined && !this.dead;
	}

	/** The environment the server is started with: Decks' secret, its folders, its config. */
	environment(spec: Opencode2ServerSpec, secret: string): NodeJS.ProcessEnv {
		return {
			...this.baseEnv,
			...opencode2Folders(this.baseEnv.HOME, this.baseEnv).env,
			OPENCODE_PASSWORD: secret,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(spec.config),
			// Decks decides which OpenCode 2 runs; an update in the background would change it
			// under a running deck.
			OPENCODE_DISABLE_AUTOUPDATE: "1",
			DECKS_STAGE_URL: spec.stageUrl,
			DECKS_STAGE_TOKEN: secret,
		};
	}

	private startServer(spec: Opencode2ServerSpec): Promise<string> {
		return new Promise((accept, refuse) => {
			const executable = opencode2Executable();
			if (!executable && this.launchesItself) {
				refuse(new Error(NOT_INSTALLED));
				return;
			}
			let child: Opencode2Child;
			try {
				child = this.spawnImpl([executable ?? "opencode2", "serve", "--hostname=127.0.0.1", "--port=0"], this.environment(spec, this.secret), spec.cwd);
			} catch (error) {
				refuse(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			this.process = child;

			// The URL is read from the server's own line rather than guessed: `--port=0` means
			// the kernel picks, and only the server knows what it picked.
			let output = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill();
				refuse(new Error(`OpenCode 2 did not start within 60s. It said: ${output.trim().slice(-300) || "nothing"}`));
			}, 60_000);
			const read = (chunk: Buffer) => {
				output += chunk.toString();
				const match = LISTENING.exec(output);
				if (!match || settled) return;
				settled = true;
				clearTimeout(timer);
				accept(match[1]!);
			};
			child.stdout?.on("data", read);
			child.stderr?.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});
			child.on("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				refuse(error);
			});
			child.on("exit", (code) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					refuse(new Error(`OpenCode 2 exited with ${code}: ${output.trim().slice(-300)}`));
					return;
				}
				this.died(child);
			});
		});
	}

	private teardown(): void {
		this.process?.kill();
		this.process = undefined;
		this.starting = undefined;
	}

	private died(child: Opencode2Child): void {
		if (this.process !== child || this.dead) return;
		this.dead = true;
		this.process = undefined;
		this.starting = undefined;
		this.refcount = 0;
		const listeners = [...this.exitListeners];
		this.exitListeners.clear();
		for (const listener of listeners) listener();
	}
}

export const NOT_INSTALLED = "OpenCode 2 is not installed. Install it to ~/.opencode2/bin/opencode2, put opencode2 on PATH, or set DECKS_OPENCODE2_BIN to the binary.";

/** The one manager for this process. */
export const opencode2Manager = new Opencode2Manager();
