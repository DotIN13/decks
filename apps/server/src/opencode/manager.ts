import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { opencodeConfigDir, opencodeExecutable } from "./install.ts";
/**
 * One `opencode serve` for every opencode agent on the deck (DESIGN §6.1, "the server").
 *
 * The alternative — the way this started — is a whole server per agent, and it is the
 * thing this file exists to replace. A server per agent is simple to reason about (each
 * one has its agent's environment on it) but it is also a Bun process, a port and a
 * config load per chat, for zero isolation between them: every agent's server already
 * says untrusted things to the same deck. One server, many sessions — sessions are the
 * unit opencode itself isolates by — is the shape the product wants, and it is the shape
 * the event layer was already built for (`events.ts` filters everything by sessionID).
 *
 * Three things decide how the server is run.
 *
 * **It is reference counted.** A module-level manager, because the count is a property of
 * the process rather than of any agent: the first opencode agent to start brings the
 * server up, later agents reuse it, and the last one to go tears it down. An agent that
 * never existed must not cost one.
 *
 * **The start is memoised.** Two agents can begin at the same moment — a subagent is
 * spawned mid-turn while the parent is still starting — and the naive version of "start
 * if nobody is running" stares at a promise's worth of time where both of them think they
 * are first. Memoising the start promise makes the second acquirer wait on the first
 * spawn and then share it, which is the whole point of the exercise.
 *
 * **The server carries ONE token.** The canvas tool used to authenticate with a token
 * minted per agent and placed in that agent's own process environment. With one process
 * there is no per-agent environment to put anything in; instead the tool sends
 * `context.sessionID`, which Decks created and therefore knows, and this server's single
 * token proves the caller is the process Decks spawned. That token is minted per server
 * lifetime, so a server that dies and comes back cannot be called with the old one.
 */

/** What the shared server is told about at spawn. Built by the first agent to acquire. */
export interface OpencodeServerSpec {
	/**
	 * The server's working directory — the deck. Sessions created in it land in the
	 * deck's project, which is where the tool's `directory` points as well.
	 */
	cwd: string;
	/** Where the canvas tool calls back: Decks' own `/api/stage/eval`, on this process's port. */
	stageUrl: string;
	/**
	 * The configuration `OPENCODE_CONFIG_CONTENT` carries. What it deliberately does *not*
	 * carry is anything per agent — a permission posture, a model — because this config is
	 * server-wide and a model or mode written here would leak across every chat. The
	 * deck's briefing is the one thing every agent on a deck shares, so it stays.
	 */
	config: { instructions?: string[] };
}

export interface OpencodeServerHandle {
	/** The URL the server announced, which is not guessed — see `startServer`. */
	url: string;
	/** The single token the shared server authenticates with; the tool sends it every call. */
	token: string;
	/**
	 * Give up this claim; the last claim out stops the server.
	 *
	 * Bound to the server it was made against — a claim from a server that died and was
	 * replaced stops being releasable the moment the next one is up, so an old agent's
	 * late release cannot stop a server it never held. Safe to call twice.
	 */
	release(): void;
}

/**
 * How the server process is started, overridable for tests.
 *
 * The real manager spawns opencode with an explicit environment, for the same reason the
 * per-agent version did: `createOpencodeServer` inherits `process.env` wholesale, and the
 * token has to be *on this process* and no other. A test fakes the child, writes the
 * listening line itself, and so exercises the counting and the death handling without
 * owning a Bun process.
 */
export interface OpencodeManagerOptions {
	spawn?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => OpencodeChild;
}

/** The slice of a child process the manager touches, so a test can fake exactly that. */
export interface OpencodeChild {
	stdout?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	stderr?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	kill(): boolean;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null) => void): unknown;
}

export class OpencodeManager {
	private readonly spawnImpl: (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => OpencodeChild;
	private process: OpencodeChild | undefined;
	/** The token the current server holds; replaced for every server lifetime. */
	private token = "";
	private refcount = 0;
	/**
	 * The in-flight (or settled) start promise. Memoised once and cleared on a failure, a
	 * death, or a teardown, so the next acquirer after any of those raises a new server.
	 */
	private starting: Promise<string> | undefined;
	/** The agents holding the current server, so a death reaches every one of them. */
	private readonly exitListeners = new Set<() => void>();
	/** Set on exit; cleared by the next acquire, which starts a fresh server. */
	private dead = false;

	constructor(options: OpencodeManagerOptions = {}) {
		this.spawnImpl = options.spawn ?? ((argv, env, cwd) => spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as OpencodeChild);
	}

	/**
	 * A claim on the shared server: the first call starts it, concurrent calls share the
	 * same spawn, and the returned handle's `release` is the claim given back.
	 */
	async acquire(spec: OpencodeServerSpec): Promise<OpencodeServerHandle> {
		this.refcount += 1;
		if (!this.starting) {
			// A fresh server is a fresh token. Minted here, synchronously, because the
			// spawn below has to carry it and the handle has to hand it back.
			this.token = randomBytes(24).toString("base64url");
			this.dead = false;
			const started = this.startServer(spec);
			this.starting = started.catch((error) => {
				// A server that never came up holds nobody's claim. The count and the memo
				// both reset, so the next acquirer starts from zero and tries again.
				this.refcount = 0;
				this.starting = undefined;
				throw error;
			});
		}
		const url = await this.starting;
		const token = this.token;
		let released = false;
		return {
			url,
			token,
			release: () => {
				if (released) return;
				released = true;
				// A claim against an older server — one that died and was replaced — does
				// not touch the count that now belongs to the newer one. The token is the
				// epoch's mark: it is minted fresh on every server, so an old handle's token
				// can never equal the current one.
				if (token !== this.token) return;
				if (this.refcount > 0) this.refcount -= 1;
				if (this.refcount === 0 && !this.dead && this.process) this.teardown();
			},
		};
	}

	/**
	 * Hear about the death of the server *this agent holds*.
	 *
	 * A process exit below is broadcast to everyone who registered, because a dead server
	 * is every opencode agent's problem at once — the streams all break at the same
	 * moment, and an agent whose turn happened not to be mid-stream must still be told
	 * before it waits forever. The listener is unregistered by calling the returned
	 * function.
	 */
	onExit(listener: () => void): () => void {
		this.exitListeners.add(listener);
		return () => {
			this.exitListeners.delete(listener);
		};
	}

	/** Whether the current server is up, for a caller deciding how to read a failure. */
	alive(): boolean {
		return this.process !== undefined && !this.dead;
	}

	private startServer(spec: OpencodeServerSpec): Promise<string> {
		return new Promise((accept, refuse) => {
			const executable = opencodeExecutable();
			if (!executable) {
				refuse(new Error("opencode is not installed. Put it on PATH, or set DECKS_OPENCODE_BIN to the binary."));
				return;
			}
			const env: NodeJS.ProcessEnv = {
				...process.env,
				OPENCODE_CONFIG_CONTENT: JSON.stringify(spec.config),
				// Where the canvas tool comes from: `runtime/opencode/tools/stage_eval.ts`,
				// loaded on top of whatever the user's own config says.
				OPENCODE_CONFIG_DIR: opencodeConfigDir(),
				// …and what that tool calls back with. One token for the whole server, and
				// the session id does the rest of the naming.
				DECKS_STAGE_URL: spec.stageUrl,
				DECKS_STAGE_TOKEN: this.token,
			};
			let child: OpencodeChild;
			try {
				child = this.spawnImpl([executable, "serve", "--hostname=127.0.0.1", "--port=0"], env, spec.cwd);
			} catch (error) {
				refuse(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			this.process = child;

			/*
			 * The URL is read back from the process's own first line rather than assumed:
			 * `--port 0` means "pick one", so the server chooses and the manager listens.
			 * A port we chose for it would have been a race between two decks on one
			 * machine; a port it chose is nobody's problem but its own.
			 */
			let output = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill();
				refuse(new Error(`opencode did not start within 30s. It said: ${output.trim().slice(-300) || "nothing"}`));
			}, 30_000);
			const read = (chunk: Buffer) => {
				output += chunk.toString();
				const match = /opencode server listening on\s+(https?:\/\/\S+)/.exec(output);
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
					// Died before announcing itself: the acquire fails, and the memo is
					// cleared by the acquire's catch so a retry can happen.
					settled = true;
					clearTimeout(timer);
					refuse(new Error(`opencode exited with ${code}: ${output.trim().slice(-300)}`));
					return;
				}
				this.died(code, child);
			});
		});
	}

	/** Tear down the current server because nobody claims it. */
	private teardown(): void {
		this.process?.kill();
		this.process = undefined;
		this.starting = undefined;
		// The exit event follows, and `died` treats it as the old epoch — see below — so
		// nothing here clears the listeners: an agent that released mid-start is disposed
		// and has already unregistered.
	}

	/**
	 * The server this agent is holding is gone.
	 *
	 * The exit event arrives with the child it belongs to, and only a death of the server
	 * *currently* held is a death: a server that was torn down and whose process is still
	 * settling its last breath must not clobber the state of the next one an eager agent
	 * already raised.
	 */
	private died(code: number | null, child: OpencodeChild): void {
		if (this.process !== child || this.dead) return;
		this.dead = true;
		this.process = undefined;
		this.starting = undefined;
		// The epoch is over: every claim held against that server is void, and a release
		// from one of its agents must not be able to stop a server that came after it.
		this.refcount = 0;
		const listeners = [...this.exitListeners];
		this.exitListeners.clear();
		for (const listener of listeners) listener();
	}
}

/** The deck's manager: one per process, shared by every opencode agent. */
export const opencodeManager = new OpencodeManager();