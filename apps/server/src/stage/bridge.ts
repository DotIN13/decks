import { randomBytes } from "node:crypto";
import type { TokenStore } from "../auth/tokens.ts";

/**
 * Each agent's token, and who a call from another process speaks for (DESIGN §6.3).
 *
 * **Every agent has a token** (`auth/tokens.ts`, an `agent` principal), made when it first starts and
 * taken back when it is disposed: its shell's `decks` command carries it (`DECKS_TOKEN`,
 * `runtimes/decks-env.ts`), and so do its Google Docs tools. Stable across a restart of the agent's
 * runtime, since a rewind reopens the session and the tool on the other side must not be left holding
 * a token nobody answers.
 *
 * **opencode has one shared process, so it also has a server secret and a session id.** With every
 * agent in one process there is no per-agent environment to put a token in when it starts. Decks,
 * which created each session, knows which agent it belongs to; the server's secret proves the caller
 * is the process Decks spawned. Its plugin trades the two for the session's agent token before a shell
 * command runs (`POST /api/tokens/session`, `auth/issue.ts`), and its Google Docs tools send them.
 */
export class StageBridge {
	/** Each agent's token, kept here only so a second start answers the same one. */
	private readonly byAgent = new Map<string, string>();
	/** One opencode session, resolved from the id its tool sends back. */
	private readonly bySession = new Map<string, { agentId: string; server: string }>();
	/**
	 * The token each shared server holds, by server: `opencode` (`opencode/manager.ts`) and
	 * `opencode2` (`opencode2/manager.ts`), which can both be running.
	 *
	 * Told to the bridge by the first agent to bring a server up, and replaced for every
	 * server lifetime: a dead server's token stops validating the moment its successor's
	 * is installed, so a session id from the old process cannot be replayed against the
	 * new one. Per server, because one shared slot let the second server to start
	 * invalidate every tool call from the first.
	 */
	private readonly serverTokens = new Map<string, string>();

	/** The tokens live in the harness's store; without one (a test), in memory alone. */
	constructor(private readonly tokens?: Pick<TokenStore, "issue" | "verify" | "revokeWhere">) {}

	/** Mint this agent's token, or return the one it already has while it still works. */
	issue(agentId: string): string {
		const existing = this.byAgent.get(agentId);
		if (existing && this.agentOf(existing) === agentId) return existing;
		const token = this.tokens ? this.tokens.issue({ kind: "agent", id: agentId }).token : `dk_a_${randomBytes(32).toString("base64url")}`;
		this.byAgent.set(agentId, token);
		return token;
	}

	/** The agent is gone: its token stops working before its runtime has finished dying. */
	revoke(agentId: string): void {
		this.byAgent.delete(agentId);
		this.tokens?.revokeWhere((principal) => principal.kind === "agent" && principal.id === agentId);
	}

	/** Replace a shared server's token — called whenever that server is raised. */
	setServerToken(token: string, server = "opencode"): void {
		this.serverTokens.set(server, token);
	}

	/**
	 * Bind an opencode session to the agent that created it.
	 *
	 * Badged with the agent id: a caller that
	 * wants to know who a call speaks for can ask, and the answer is the agent's, not a
	 * guess about it.
	 */
	registerSession(sessionId: string, agentId: string, server = "opencode"): void {
		this.bySession.set(sessionId, { agentId, server });
	}

	/** Whether a token is the one the server holding this session was given. */
	private sessionHolds(held: { server: string } | undefined, token: string | undefined): boolean {
		const expected = held ? this.serverTokens.get(held.server) : undefined;
		return expected !== undefined && token === expected;
	}

	/** The session (and its agent) is gone, so it stops answering. */
	unregisterSession(sessionId: string | undefined): void {
		if (!sessionId) return;
		this.bySession.delete(sessionId);
	}

	/** Which agent a call speaks for: a per-agent token, or opencode's session with the server's token. */
	agentFor(token: string | undefined, sessionID?: string): string | undefined {
		if (sessionID !== undefined) {
			const held = this.bySession.get(sessionID);
			return this.sessionHolds(held, token) ? held?.agentId : undefined;
		}
		return this.agentOf(token);
	}

	/** Which agent a token speaks for, for a caller that wants to say so. */
	agentOf(token: string | undefined): string | undefined {
		if (!token) return undefined;
		if (!this.tokens) return [...this.byAgent].find(([, held]) => held === token)?.[0];
		const seen = this.tokens.verify(token);
		return seen.ok && seen.principal.kind === "agent" ? seen.principal.id : undefined;
	}
}
