import { opencode2Executable, opencode2Folders } from "./install.ts";
import { decksServerEnv } from "../decks-env.ts";
import { SharedServer, type ServerChild, type SpawnServer } from "../shared-server.ts";

/**
 * One `opencode serve` (OpenCode 2) for every OpenCode 2 agent on the deck.
 *
 * The same design as opencode 1's `opencode/manager.ts`, and the same counting
 * (`runtimes/shared-server.ts`): the server is **reference counted** (the first agent brings it up,
 * the last one out stops it), its **start is memoised** (two agents starting at once share one
 * spawn) and it holds **one secret per lifetime**, minted fresh each time it starts. What is
 * this file's own is every detail the two servers differ in: the listening line, how a caller
 * proves itself, which folders it is given and how its config arrives.
 *
 * That secret does two jobs here. It is OpenCode 2's server password (`OPENCODE_PASSWORD`,
 * HTTP Basic as user `opencode`), so only Decks can drive the server; and it is the token
 * Decks' own tools send back to Decks (`DECKS_OPENCODE_SECRET`), so only this server's tools can
 * reach the canvas.
 */

/** What the shared server is told about at spawn. Built by the first agent to acquire. */
interface Opencode2ServerSpec {
	/** The server's working directory: the deck. */
	cwd: string;
	/** Where Decks' tools call back: Decks' own `/api/stage/eval`. */
	decksUrl: string;
	/** Decks' own port, for the `decks` command in every session's shell. */
	decksPort?: number;
	/**
	 * The inline config, `OPENCODE_CONFIG_CONTENT`. Decks' plugin and skills go here, by
	 * absolute path, on top of the person's own OpenCode 2 config. Nothing per agent: this is
	 * server-wide, and a model or mode written here would reach every chat.
	 */
	config: { plugins?: string[]; skills?: string[] };
}

interface Opencode2ServerHandle {
	/** The URL the server announced. */
	url: string;
	/** The server's secret: its password, and the token its tools carry back to Decks. */
	secret: string;
	/** Give up this claim; the last claim out stops the server. Safe to call twice. */
	release(): void;
}

/** How the server process is started, overridable for tests. */
interface Opencode2ManagerOptions {
	spawn?: SpawnServer;
	/** The environment the server is started from; the process's own by default. */
	env?: NodeJS.ProcessEnv;
}

/** The slice of a child process the manager touches. */
export type Opencode2Child = ServerChild;

export class Opencode2Manager extends SharedServer<Opencode2ServerSpec> {
	protected readonly program = {
		name: "OpenCode 2",
		command: "opencode2",
		// What OpenCode 2 prints when it is listening: `server listening on http://127.0.0.1:41713`.
		listening: /server listening on\s+(https?:\/\/\S+)/,
		startWithinSeconds: 60,
		notInstalled: NOT_INSTALLED,
	};
	private readonly baseEnv: NodeJS.ProcessEnv;

	constructor(options: Opencode2ManagerOptions = {}) {
		super(options.spawn);
		this.baseEnv = options.env ?? process.env;
	}

	async acquire(spec: Opencode2ServerSpec): Promise<Opencode2ServerHandle> {
		return this.claim(spec);
	}

	protected executable(): string | undefined {
		return opencode2Executable();
	}

	/** The environment the server is started with: Decks' secret, its folders, its config. */
	environment(spec: Opencode2ServerSpec, secret: string): NodeJS.ProcessEnv {
		const folders = opencode2Folders(this.baseEnv.HOME, this.baseEnv).env;
		/*
		 * What the commands an agent runs should see instead. The folder settings are for OpenCode
		 * 2 alone: an agent's `pip` or `gh` inheriting `XDG_CACHE_HOME` would quietly use a cache
		 * of OpenCode's. So the original values travel with the server, and Decks' plugin
		 * (`runtime/opencode2/plugin`) puts them back on every shell command, with `null` for one
		 * that was not set at all. The server's password goes the same way: a command has no
		 * business holding the key to the server that runs it.
		 */
		const restore: Record<string, string | null> = { OPENCODE_PASSWORD: null };
		for (const name of Object.keys(folders)) restore[name] = this.baseEnv[name] ?? null;
		return {
			...this.baseEnv,
			...folders,
			DECKS_OPENCODE2_RESTORE: JSON.stringify(restore),
			OPENCODE_PASSWORD: secret,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(spec.config),
			// Decks decides which OpenCode 2 runs; an update in the background would change it
			// under a running deck.
			OPENCODE_DISABLE_AUTOUPDATE: "1",
			DECKS_STAGE_URL: spec.decksUrl,
			DECKS_OPENCODE_SECRET: secret,
			// The `decks` command and where Decks is, for every session's shell; the plugin trades the
			// session for its agent's token (`runtimes/decks-env.ts`).
			...(spec.decksPort ? decksServerEnv(spec.decksPort, this.baseEnv.PATH) : {}),
		};
	}
}

export const NOT_INSTALLED = "OpenCode 2 is not installed. Install it to ~/.opencode2/bin/opencode2, put opencode2 on PATH, or set DECKS_OPENCODE2_BIN to the binary.";

/** The one manager for this process. */
export const opencode2Manager = new Opencode2Manager();
