import { randomBytes } from "node:crypto";

/**
 * Who a call from another process speaks for (DESIGN §6.3).
 *
 * opencode and antigravity are somebody else's program, so what they send back to Decks names
 * its agent by something Decks handed them: their Google Docs tools send a token, and opencode's
 * shell sends the session (`DECKS_SESSION`) so a `decks` command reaches its own agent
 * (`verbs/router.ts`).
 *
 * **Antigravity keeps a token per agent.** One agent, one process, so the token is minted when
 * the agent starts, handed into that agent's environment, and forgotten when it is disposed.
 *
 * **opencode has one shared process, so it gets a server token and a session id.** With
 * everything in one process there is no per-agent environment to put a token in; Decks, which
 * created each session, knows which agent it belongs to, and a single server token in the
 * process environment proves the caller is the process Decks spawned.
 */
export class StageBridge {
	private readonly byToken = new Map<string, { agentId: string }>();
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

	/**
	 * Mint this agent's token, or return the one it already has.
	 *
	 * Stable across a restart of the agent's runtime — a rewind reopens the session and
	 * would otherwise leave the tool holding a token nobody answers. This is the
	 * per-agent scheme, which antigravity still uses; opencode's identity has moved to
	 * the session registration below.
	 */
	issue(agentId: string): string {
		const existing = this.byAgent.get(agentId);
		if (existing) {
			this.byToken.set(existing, { agentId });
			return existing;
		}
		const token = randomBytes(24).toString("base64url");
		this.byAgent.set(agentId, token);
		this.byToken.set(token, { agentId });
		return token;
	}

	/** The agent is gone: its token stops working before its runtime has finished dying. */
	revoke(agentId: string): void {
		const token = this.byAgent.get(agentId);
		if (!token) return;
		this.byAgent.delete(agentId);
		this.byToken.delete(token);
	}

	/** Replace a shared server's token — called whenever that server is raised. */
	setServerToken(token: string, server = "opencode"): void {
		this.serverTokens.set(server, token);
	}

	/**
	 * Bind an opencode session to the agent that created it.
	 *
	 * Badged with the agent id for the same reason `byToken` carries it: a caller that
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

	/** The agent an opencode session was made for: what a `decks` command's `DECKS_SESSION` names. */
	agentOfSession(sessionID: string | undefined): string | undefined {
		return sessionID ? this.bySession.get(sessionID)?.agentId : undefined;
	}

	/** Which agent a token speaks for, for a caller that wants to say so. */
	agentOf(token: string | undefined): string | undefined {
		return token ? this.byToken.get(token)?.agentId : undefined;
	}
}