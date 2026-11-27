import { opencodeConfigDir } from "@decks/runtime";
import { opencodeExecutable } from "./install.ts";
import { decksServerEnv } from "../decks-env.ts";
import { SharedServer, type ServerChild, type SpawnServer } from "../shared-server.ts";
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
 * How it is counted, memoised and given one token per lifetime is `runtimes/shared-server.ts`,
 * shared with OpenCode 2. The token matters most here: Decks' tools used to authenticate with
 * a token minted per agent and placed in that agent's own process environment. With one
 * process there is no per-agent environment to put anything in; instead the tool sends
 * `context.sessionID`, which Decks created and therefore knows, and the server's single
 * token proves the caller is the process Decks spawned.
 */

/** What the shared server is told about at spawn. Built by the first agent to acquire. */
export interface OpencodeServerSpec {
	/**
	 * The server's working directory — the deck. Sessions created in it land in the
	 * deck's project, which is where the tool's `directory` points as well.
	 */
	cwd: string;
	/** Decks' own address on this process's port, which the Google Docs tools call back to (`/api/gdocs/call`). */
	decksUrl: string;
	/** Decks' own port, for the `decks` command in every session's shell (`runtimes/decks-env.ts`). */
	decksPort?: number;
	/**
	 * The configuration `OPENCODE_CONFIG_CONTENT` carries. What it deliberately does *not*
	 * carry is anything per agent — a permission posture, a model — because this config is
	 * server-wide and a model or mode written here would leak across every chat. The
	 * deck's briefing is the one thing every agent on a deck shares, so it stays.
	 */
	config: { instructions?: string[] };
}

interface OpencodeServerHandle {
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
interface OpencodeManagerOptions {
	spawn?: SpawnServer;
}

/** The slice of a child process the manager touches, so a test can fake exactly that. */
export type OpencodeChild = ServerChild;

export class OpencodeManager extends SharedServer<OpencodeServerSpec> {
	protected readonly program = {
		name: "opencode",
		command: "opencode",
		listening: /opencode server listening on\s+(https?:\/\/\S+)/,
		startWithinSeconds: 30,
		notInstalled: "opencode is not installed. Put it on PATH, or set DECKS_OPENCODE_BIN to the binary.",
	};

	constructor(options: OpencodeManagerOptions = {}) {
		super(options.spawn);
	}

	/**
	 * A claim on the shared server: the first call starts it, concurrent calls share the
	 * same spawn, and the returned handle's `release` is the claim given back.
	 */
	async acquire(spec: OpencodeServerSpec): Promise<OpencodeServerHandle> {
		const { url, secret, release } = await this.claim(spec);
		return { url, token: secret, release };
	}

	protected executable(): string | undefined {
		return opencodeExecutable();
	}

	protected environment(spec: OpencodeServerSpec, token: string): NodeJS.ProcessEnv {
		return {
			...process.env,
			OPENCODE_CONFIG_CONTENT: JSON.stringify(spec.config),
			// Where Decks' tools and plugin come from: `runtime/opencode/`, loaded on top of
			// whatever the user's own config says.
			OPENCODE_CONFIG_DIR: opencodeConfigDir(),
			// …and what the Google Docs tools call back with. One token for the whole server,
			// and the session id does the rest of the naming.
			DECKS_CANVAS_URL: spec.decksUrl,
			DECKS_OPENCODE_SECRET: token,
			// The `decks` command and where Decks is, for every session's shell; the plugin in
			// `runtime/opencode/plugin/` trades the session for its agent's token (`runtimes/decks-env.ts`).
			...(spec.decksPort ? decksServerEnv(spec.decksPort) : {}),
		};
	}
}

/** The deck's manager: one per process, shared by every opencode agent. */
export const opencodeManager = new OpencodeManager();
