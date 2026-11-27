import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * One server process shared by every agent of a runtime on the deck, counted by its claims.
 *
 * opencode and OpenCode 2 both run this way (`opencode/manager.ts`, `opencode2/manager.ts`):
 * one `serve` process, a session per agent inside it. The two used to carry their own copy of
 * the counting below, and the copies had begun to drift; what differs between them (the
 * binary, its environment, the line it prints when listening) is all a subclass says.
 *
 * Three things decide how the server is run.
 *
 * **It is reference counted.** A module-level manager, because the count is a property of
 * the process rather than of any agent: the first agent to start brings the server up, later
 * agents reuse it, and the last one to go tears it down. An agent that never existed must not
 * cost one.
 *
 * **The start is memoised.** Two agents can begin at the same moment (a subagent is spawned
 * mid-turn while the parent is still starting), and the naive version of "start if nobody is
 * running" stares at a promise's worth of time where both of them think they are first.
 * Memoising the start promise makes the second acquirer wait on the first spawn and then share
 * it.
 *
 * **The server carries ONE secret per lifetime.** Decks' tools prove they come from the process
 * Decks spawned by sending it, and a server that dies and comes back is minted a new one, so it
 * cannot be called with the old one. The secret is also the epoch's mark for releases: an old
 * claim's secret never equals the current one.
 */

/** The slice of a child process the manager touches, so a test can fake exactly that. */
export interface ServerChild {
	stdout?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	stderr?: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
	kill(): boolean;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null) => void): unknown;
}

/** How the server process is started; a test passes its own and fakes the child. */
export type SpawnServer = (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => ServerChild;

/** A claim on the shared server, as the base hands it to its subclass. */
interface ServerClaim {
	/** The URL the server announced, read from its own output, never guessed. */
	url: string;
	/** The secret minted for this server's lifetime. */
	secret: string;
	/**
	 * Give up this claim; the last claim out stops the server.
	 *
	 * Bound to the server it was made against: a claim from a server that died and was replaced
	 * stops being releasable the moment the next one is up, so an old agent's late release cannot
	 * stop a server it never held. Safe to call twice.
	 */
	release(): void;
}

/** What a runtime's server is, in the words its failures are said in. */
interface ServerProgram {
	/** What the person calls it in an error: `opencode`, `OpenCode 2`. */
	name: string;
	/** The binary's name, as a placeholder in argv when a test's spawn needs none. */
	command: string;
	/** The line the server prints once it listens; the first group is its URL. */
	listening: RegExp;
	/** How long the server has to say so before the start is given up. */
	startWithinSeconds: number;
	/** The refusal when there is no binary to run. */
	notInstalled: string;
}

export abstract class SharedServer<Spec extends { cwd: string }> {
	protected abstract readonly program: ServerProgram;
	private readonly spawnImpl: SpawnServer;
	/**
	 * Whether the caller brought its own `spawn`.
	 *
	 * It decides one thing: whether the binary has to exist. A manager that launches the server
	 * itself cannot start without one, but one built with its own `spawn` runs whatever that
	 * function says and never touches the path, which is what lets the counting, the memoised
	 * start and the death broadcast be tested on a machine with nothing installed (CI).
	 */
	private readonly launchesItself: boolean;
	private process: ServerChild | undefined;
	/** The secret the current server holds; replaced for every server lifetime. */
	private secret = "";
	private refcount = 0;
	/**
	 * The in-flight (or settled) start promise. Memoised once and cleared on a failure, a death,
	 * or a teardown, so the next acquirer after any of those raises a new server.
	 */
	private starting: Promise<string> | undefined;
	/** The agents holding the current server, so a death reaches every one of them. */
	private readonly exitListeners = new Set<() => void>();
	/** Set on exit; cleared by the next acquire, which starts a fresh server. */
	private dead = false;

	constructor(spawnServer?: SpawnServer) {
		this.launchesItself = spawnServer === undefined;
		this.spawnImpl = spawnServer ?? ((argv, env, cwd) => spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as ServerChild);
	}

	/** The binary to run, or undefined when there is none. */
	protected abstract executable(): string | undefined;
	/** The environment the server starts with, carrying this lifetime's secret. */
	protected abstract environment(spec: Spec, secret: string): NodeJS.ProcessEnv;

	/**
	 * A claim on the shared server: the first call starts it, concurrent calls share the same
	 * spawn, and the claim's `release` gives it back.
	 */
	protected async claim(spec: Spec): Promise<ServerClaim> {
		this.refcount += 1;
		if (!this.starting) {
			// A fresh server is a fresh secret. Minted here, synchronously, because the spawn
			// below has to carry it and the claim has to hand it back.
			this.secret = randomBytes(24).toString("base64url");
			this.dead = false;
			this.starting = this.startServer(spec).catch((error) => {
				// A server that never came up holds nobody's claim. The count and the memo both
				// reset, so the next acquirer starts from zero and tries again.
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
				// A claim against an older server does not touch the count that now belongs to
				// the newer one: the secret is minted per lifetime, so an old one never matches.
				if (secret !== this.secret) return;
				if (this.refcount > 0) this.refcount -= 1;
				if (this.refcount === 0 && !this.dead && this.process) this.teardown();
			},
		};
	}

	/**
	 * Hear about the death of the server this agent holds.
	 *
	 * A process exit is broadcast to everyone who registered, because a dead server is every
	 * agent's problem at once: the streams all break at the same moment, and an agent whose turn
	 * happened not to be mid-stream must still be told before it waits forever. Answers the
	 * function that unregisters the listener.
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

	private startServer(spec: Spec): Promise<string> {
		const { name, command, listening, startWithinSeconds, notInstalled } = this.program;
		return new Promise((accept, refuse) => {
			const executable = this.executable();
			if (!executable && this.launchesItself) {
				refuse(new Error(notInstalled));
				return;
			}
			let child: ServerChild;
			try {
				// The name is a placeholder when there is no binary: an injected `spawn` ignores it,
				// and the real `spawn` cannot get here without one.
				child = this.spawnImpl([executable ?? command, "serve", "--hostname=127.0.0.1", "--port=0"], this.environment(spec, this.secret), spec.cwd);
			} catch (error) {
				refuse(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			this.process = child;

			/*
			 * The URL is read back from the process's own line rather than assumed: `--port=0`
			 * means "pick one", so the server chooses and the manager listens. A port we chose for
			 * it would be a race between two decks on one machine.
			 */
			let output = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill();
				refuse(new Error(`${name} did not start within ${startWithinSeconds}s. It said: ${output.trim().slice(-300) || "nothing"}`));
			}, startWithinSeconds * 1000);
			const read = (chunk: Buffer) => {
				output += chunk.toString();
				const match = listening.exec(output);
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
					// Died before announcing itself: the acquire fails, and the memo is cleared by
					// the acquire's catch so a retry can happen.
					settled = true;
					clearTimeout(timer);
					refuse(new Error(`${name} exited with ${code}: ${output.trim().slice(-300)}`));
					return;
				}
				this.died(child);
			});
		});
	}

	/**
	 * Tear down the current server because nobody claims it. The exit event follows, and `died`
	 * treats it as the old epoch, so nothing here clears the listeners: an agent that released
	 * mid-start is disposed and has already unregistered.
	 */
	private teardown(): void {
		this.process?.kill();
		this.process = undefined;
		this.starting = undefined;
	}

	/**
	 * The server the agents are holding is gone.
	 *
	 * Only a death of the server *currently* held is a death: a server that was torn down and
	 * whose process is still settling its last breath must not clobber the state of the next one
	 * an eager agent already raised.
	 */
	private died(child: ServerChild): void {
		if (this.process !== child || this.dead) return;
		this.dead = true;
		this.process = undefined;
		this.starting = undefined;
		// The epoch is over: every claim held against that server is void, and a release from one
		// of its agents must not be able to stop a server that came after it.
		this.refcount = 0;
		const listeners = [...this.exitListeners];
		this.exitListeners.clear();
		for (const listener of listeners) listener();
	}
}
