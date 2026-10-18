import { checkArgs, signature, VERB_BY_NAME, VERBS } from "@decks/api";
import express, { type Request, type Response } from "express";
import type { App } from "../app.ts";
import type { DeckAgent } from "../agents/session.ts";
import { callerTool, conversationFor } from "../stage/caller-run.ts";
import type { StageCallResult, StageTool } from "../stage/tool.ts";

/**
 * `/api/v1`: every verb in the table (`@decks/api`) as a route, and the one way in for the SDK in
 * all three of its forms — the TypeScript client, the `decks` command and the MCP server.
 *
 * `POST /api/v1/<verb>` with `{ "args": [...] }` calls the verb for whoever the request names and
 * answers `{ ok, value, notes }`. The arguments are checked against the table before any handler
 * sees them, so a wrong call is answered with the verb's signature rather than a stack trace.
 * `GET /api/v1` lists the verbs, which is what `decks --help` prints.
 *
 * Who is calling is said, not proven, for now: `X-Decks-Agent` names an agent by id or name (the
 * `decks` command sends `DECKS_AGENT`, which Decks puts in each agent's shell), and `X-Decks-App`
 * names an app, which acts for the conversation on screen once the person has let it. Requests
 * from another site still need the pairing token (`http.ts`), as every `/api` route does.
 */

/** The answer to one call, as the SDK reads it. */
export interface VerbAnswer extends StageCallResult {}

export function verbRoutes(app: App): express.Router {
	const router = express.Router();
	/** Apps the person let call verbs with "Allow once": remembered until the server restarts. */
	const allowedOnce = new Set<string>();

	router.get("/", (_req, res) => {
		res.set("cache-control", "no-store").json({
			verbs: VERBS.map((verb) => ({ name: verb.name, group: verb.group, effect: verb.effect, summary: verb.summary, signature: signature(verb) })),
		});
	});

	router.post("/:verb", async (req: Request, res: Response) => {
		const name = String(req.params.verb ?? "");
		const verb = VERB_BY_NAME.get(name);
		if (!verb) {
			res.status(404).json({ ok: false, error: `There is no verb called ${name}. GET /api/v1 lists them.`, notes: [] });
			return;
		}
		const body = (req.body ?? {}) as { args?: unknown; agent?: unknown; app?: unknown };
		const args = body.args === undefined ? [] : body.args;
		if (!Array.isArray(args)) {
			res.status(400).json({ ok: false, error: `Send the arguments as a list: { "args": [...] }. ${signature(verb)}`, notes: [] });
			return;
		}
		const problem = checkArgs(verb, args);
		if (problem) {
			res.status(400).json({ ok: false, error: problem, notes: [] });
			return;
		}

		const caller = await callerOf(app, req, body, allowedOnce);
		if ("error" in caller) {
			res.status(caller.status).json({ ok: false, error: caller.error, notes: [] });
			return;
		}
		const answer = await caller.tool.call(name, args);
		if (caller.announce) caller.announce(name, answer);
		res.status(answer.ok ? 200 : 422).json(answer satisfies VerbAnswer);
	});

	return router;
}

type Caller = { tool: StageTool; announce?: (verb: string, answer: StageCallResult) => void } | { error: string; status: number };

/** The stage tool a request acts through: an agent's own, or an app's on the conversation on screen. */
async function callerOf(app: App, req: Request, body: { agent?: unknown; app?: unknown }, allowedOnce: Set<string>): Promise<Caller> {
	const header = (key: string) => {
		const value = req.headers[key];
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	};
	const appName = header("x-decks-app") ?? (typeof body.app === "string" ? body.app : undefined);
	if (appName) return appCaller(app, appName, allowedOnce);

	const named = header("x-decks-agent") ?? (typeof body.agent === "string" ? body.agent : undefined);
	if (!named) {
		return {
			status: 400,
			error: "Say who is calling: an agent with the X-Decks-Agent header (the decks command sends DECKS_AGENT), or an app with X-Decks-App.",
		};
	}
	const agent = agentNamed(app, named);
	if (!agent) return { status: 404, error: `There is no agent called ${named}. GET /api/v1/agents needs a caller too; DECKS_AGENT is set in each agent's shell.` };
	return { tool: agent.stageTool() };
}

/** An agent by id, or by name when exactly one has it. */
function agentNamed(app: App, named: string): DeckAgent | undefined {
	const byId = app.agents.get(named);
	if (byId) return byId;
	const lower = named.toLowerCase();
	const matches = app.agents.all().filter((one) => one.name.toLowerCase() === lower);
	return matches.length === 1 ? matches[0] : undefined;
}

/**
 * An app's calls: once the person has let it, it acts for the conversation on screen, under the
 * app's own name, and each call is noted in that conversation, as an app's stage code always was.
 */
async function appCaller(app: App, name: string, allowedOnce: Set<string>): Promise<Caller> {
	if (!app.apps.exists(name)) return { status: 404, error: `There is no app called ${name}.` };
	const key = `apps/${name}`;
	const board = app.apps.state(name).board;
	if (!app.evalTrust.allows(key) && !allowedOnce.has(key)) {
		const answer = await conversationFor(app, { board }).bridge.choose({
			title: "Let this app use the stage?",
			message: `The app ${name} wants to call stage verbs: write boards, move the canvas, message agents.`,
			options: [
				{ label: "Allow until Decks restarts" },
				{ label: "Always allow this app", description: `Remember ${name}, and stop asking` },
				{ label: "No", description: "Refuse its calls" },
			],
		});
		if (answer === "Always allow this app") app.evalTrust.allow(key);
		else if (answer === "Allow until Decks restarts") allowedOnce.add(key);
		else return { status: 403, error: `The person did not let ${name} use the stage.` };
	}
	const { tool, focused } = callerTool(
		{ agents: app.agents, cameras: app.cameras, boards: app.boards, stage: app.stage, port: app.port },
		{ board, name: `app ${name}`, mayCreate: true },
	);
	return {
		tool,
		announce: (verb, answer) => {
			if (answer.ok) focused.translator.notice("info", `app ${name} called ${verb}`);
			else focused.translator.notice("error", `app ${name} called ${verb} and failed: ${answer.error}`);
		},
	};
}
