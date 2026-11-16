import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { createMcp, type McpSession } from "@decks/sdk/mcp";
import VERBS from "@decks/sdk/verbs.json" with { type: "json" };
import type { App } from "../../app.ts";
import { actsAsPerson, type Principal } from "../../auth/principal.ts";
import { runVerb } from "../../calls/run.ts";

/**
 * Decks as an MCP server at a web address: `POST /api/mcp` (and `/mcp`), for a client that is not on
 * this machine or cannot start a program (the relay, `packages/sdk/mcp/server.mjs`, is for those that can).
 *
 * The door is the same (`packages/sdk/mcp/core.mjs`): tools, things to read, skills, the brief. A
 * request carries a harness token as every request does (`Authorization: Bearer`), so who may connect
 * is who holds one. A session opened with the person's token joins the canvas as an agent of its
 * own, as the relay's does (`Registry.attach`), keyed by the client's name and the token, so the same
 * connection comes back as the same agent; its calls are then made as that agent, here in the server
 * with no second request. A session opened with an agent's or an app's token calls as that.
 *
 * Streamable HTTP, answers only: each POST is answered with JSON, and there is no stream from the
 * server (GET says so), which the protocol allows. A session is `Mcp-Session-Id`, kept in memory for
 * a day's idleness; one the server no longer has (it restarted) is answered 404, and the client
 * opens another.
 */

const IDLE_MS = 24 * 3_600_000;

interface Session {
	mcp: McpSession;
	/** Who the session's calls are made as: the token's own principal, or the agent it joined as. */
	principal: Principal;
	/** The token the session was opened with: another token cannot use it. */
	tokenId: string | undefined;
	used: number;
}

/** One MCP door, answered at `/mcp` on each router given: the sessions are the door's, whichever address a request came by. */
export function registerMcp(routers: Router[], deps: { app: App }): void {
	const { app } = deps;
	const sessions = new Map<string, Session>();
	const sweep = setInterval(() => {
		for (const [id, session] of sessions) if (Date.now() - session.used > IDLE_MS) sessions.delete(id);
	}, 600_000);
	sweep.unref();

	/** A session for whoever the request is: its calls run here, as its principal. */
	const open = (req: Request): Session => {
		const session: Session = { mcp: undefined as never, principal: req.principal!, tokenId: req.tokenId, used: Date.now() };
		session.mcp = createMcp({
			verbs: VERBS,
			...(typeof req.query.tools === "string" ? { tools: req.query.tools } : {}),
			// What waits for an agent rides on its tools' answers; the person has no inbox.
			get news() {
				return session.principal.kind === "agent";
			},
			call: async (name, args) => {
				const { answer } = await runVerb(app, session.principal, {}, name, args, req.socket.remoteAddress, session.tokenId ? { tokenId: session.tokenId } : {});
				if (!answer.ok) throw Object.assign(new Error(answer.error ?? `${name} failed.`), { notes: answer.notes ?? [] });
				return { value: answer.value, notes: answer.notes ?? [], ...(answer.images ? { images: answer.images } : {}) };
			},
			joined: async (client) => {
				if (!actsAsPerson(session.principal)) return undefined;
				const label = client?.title || client?.name || "MCP client";
				const { agent, made } = app.agents.attach({ key: `${client?.name ?? "mcp"}:web:${session.tokenId ?? "token"}`, client: label, name: label });
				if (made && !agent.seat.stageName()) {
					try {
						const latest = app.agents.latestCanvas(agent.workspace, agent.id);
						if (latest) agent.seat.openStage(latest);
						else agent.seat.newStage?.(agent.chat().name, { provisional: true });
					} catch {
						/* it has a canvas once it draws */
					}
					app.publishStages();
				}
				session.principal = { kind: "agent", id: agent.id };
				const canvas = agent.seat.stageName();
				return `You are on this deck as "${agent.chat().name}"${canvas ? `, and your home canvas is "${canvas}"` : ""}. ${made ? "This is your first time here: say who you are with decks_agent_update." : "You have been here before: your name, your cards and your mail are as you left them."} You have no disk in common with the deck: write files with decks_file_write.`;
			},
		});
		return session;
	};

	const post = async (req: Request, res: Response) => {
		if (!req.principal || req.principal.kind === "canvas") {
			res.status(403).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "MCP is opened with a harness token: the person's, an agent's or an app's. A canvas pass does not open it." } });
			return;
		}
		const body = req.body as unknown;
		const messages = Array.isArray(body) ? body : [body];
		const asked = req.header("mcp-session-id");
		const opening = messages.some((message) => (message as { method?: unknown } | null)?.method === "initialize");
		let session: Session | undefined;
		if (opening) {
			session = open(req);
			const id = randomUUID();
			sessions.set(id, session);
			res.setHeader("Mcp-Session-Id", id);
		} else if (asked) {
			session = sessions.get(asked);
			// Gone (the server restarted, or a day passed), or another token's: the client opens a new one.
			if (!session || session.tokenId !== req.tokenId) {
				res.status(404).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "That MCP session is not here any more. Start a new one with initialize." } });
				return;
			}
		} else {
			// A client that keeps no session: each request stands alone, as the token's own principal.
			session = open(req);
		}
		session.used = Date.now();
		const answers = [];
		for (const message of messages) {
			const answer = await session.mcp.handle(message);
			if (answer) answers.push(answer);
		}
		if (answers.length === 0) {
			res.status(202).end();
			return;
		}
		res.json(Array.isArray(body) ? answers : answers[0]);
	};

	for (const router of routers) {
		router.post("/mcp", (req, res, next) => void post(req, res).catch(next));
		// No stream from the server: the protocol's way of saying so.
		router.get("/mcp", (_req, res) => void res.status(405).set("Allow", "POST, DELETE").end());
		router.delete("/mcp", (req, res) => {
			const id = req.header("mcp-session-id");
			const session = id ? sessions.get(id) : undefined;
			if (id && session && session.tokenId === req.tokenId) sessions.delete(id);
			res.status(200).end();
		});
	}
}
