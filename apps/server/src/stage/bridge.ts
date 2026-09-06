import { randomBytes } from "node:crypto";
import type { StageTool } from "./tool.ts";

/**
 * The canvas tool, for a runtime that is not in this process (DESIGN §6.3).
 *
 * Pi takes a tool definition and Claude takes an in-process MCP server, so for both of
 * them the tool *is* a function call in this Node process. opencode and antigravity are
 * somebody else's program: opencode registers a TypeScript tool that runs inside its own
 * Bun runtime, antigravity registers a Python function inside its SDK's process. Neither
 * can reach a closure here.
 *
 * So the tool body they register is four lines of HTTP, and this is the other end of it:
 * one route, one identity per caller, and the same `StageTool` the in-process runtimes
 * get. The wording, the guidelines and the `stage` object stay in `stage/tool.ts`, which
 * is the whole point — a fifth runtime should not be a fifth description of what a board
 * is for.
 *
 * Two callers, two identity schemes, and the route answers both.
 *
 * **Antigravity keeps a token per agent.** One agent, one Python sidecar, so the token is
 * still minted when the agent starts, handed into that agent's environment, and forgotten
 * when the agent is disposed. This is the original design and it still holds wherever a
 * runtime owns a process per agent.
 *
 * **opencode has one shared process, so it gets a server token and a session id.** With
 * everything in one Bun process there is no per-agent environment to put a token in; the
 * tool instead sends back the `context.sessionID` opencode handed it, and Decks — which
 * created that session — knows which agent it belongs to. A single server token in the
 * process environment proves the caller is the process Decks spawned, and the session
 * registration below names whose agent it acts for. Nothing else authenticates: the
 * endpoint is on the same loopback server the browser talks to, and either identity is by
 * construction the process Decks spawned.
 */
export class StageBridge {
	private readonly byToken = new Map<string, { agentId: string; tool: StageTool }>();
	private readonly byAgent = new Map<string, string>();
	/** One opencode session, resolved from the id its tool sends back. */
	private readonly bySession = new Map<string, { agentId: string; tool: StageTool }>();
	/**
	 * The single token the shared opencode server holds (`opencode/manager.ts`).
	 *
	 * Told to the bridge by the first agent to bring the server up, and replaced for every
	 * server lifetime: a dead server's token stops validating the moment its successor's
	 * is installed, so a session id from the old process cannot be replayed against the
	 * new one.
	 */
	private serverToken: string | undefined;

	/**
	 * Mint this agent's token, or return the one it already has.
	 *
	 * Stable across a restart of the agent's runtime — a rewind reopens the session and
	 * would otherwise leave the tool holding a token nobody answers. This is the
	 * per-agent scheme, which antigravity still uses; opencode's identity has moved to
	 * the session registration below.
	 */
	issue(agentId: string, tool: StageTool): string {
		const existing = this.byAgent.get(agentId);
		if (existing) {
			this.byToken.set(existing, { agentId, tool });
			return existing;
		}
		const token = randomBytes(24).toString("base64url");
		this.byAgent.set(agentId, token);
		this.byToken.set(token, { agentId, tool });
		return token;
	}

	/** The agent is gone: its token stops working before its runtime has finished dying. */
	revoke(agentId: string): void {
		const token = this.byAgent.get(agentId);
		if (!token) return;
		this.byAgent.delete(agentId);
		this.byToken.delete(token);
	}

	/** Replace the shared server's token — called whenever a server is raised. */
	setServerToken(token: string): void {
		this.serverToken = token;
	}

	/**
	 * Bind an opencode session to the agent that created it.
	 *
	 * Badged with the agent id for the same reason `byToken` carries it: a caller that
	 * wants to know who a call speaks for can ask, and the answer is the agent's, not a
	 * guess about it.
	 */
	registerSession(sessionId: string, agentId: string, tool: StageTool): void {
		this.bySession.set(sessionId, { agentId, tool });
	}

	/** The session (and its agent) is gone, so it stops answering. */
	unregisterSession(sessionId: string | undefined): void {
		if (!sessionId) return;
		this.bySession.delete(sessionId);
	}

	/**
	 * Run code as the agent that identity belongs to.
	 *
	 * An unknown identity is not an error the model should see a stack trace for — it is a
	 * tool call from a process that has outlived its agent, or from a session that was
	 * replaced, which happens when a runtime is slow to exit. It answers as a failed tool
	 * call and says why.
	 */
	async run(token: string | undefined, code: string, sessionID?: string): Promise<{ text: string; isError: boolean }> {
		if (typeof code !== "string" || code.trim() === "") return { text: "No code to run.", isError: true };
		if (sessionID !== undefined) {
			// opencode's path: the session id names the agent, the server token proves the
			// caller is the process Decks spawned. A session id with anything but that token
			// is refused the same way a bad per-agent token is — the identity did not hold.
			if (typeof sessionID !== "string" || sessionID === "") return { text: "The canvas call did not say which opencode session it came from.", isError: true };
			if (this.serverToken === undefined || token !== this.serverToken) return { text: "This canvas token is not valid any more — the agent it belonged to has gone.", isError: true };
			const held = this.bySession.get(sessionID);
			if (!held) return { text: "This opencode session is not registered to a live Decks agent any more.", isError: true };
			return held.tool.run(code);
		}
		const held = token ? this.byToken.get(token) : undefined;
		if (!held) return { text: "This canvas token is not valid any more — the agent it belonged to has gone.", isError: true };
		return held.tool.run(code);
	}

	/** Which agent a token speaks for, for a caller that wants to say so. */
	agentOf(token: string | undefined): string | undefined {
		return token ? this.byToken.get(token)?.agentId : undefined;
	}
}