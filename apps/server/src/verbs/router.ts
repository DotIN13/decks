import { ALL_VERBS, checkArgs, signature, VERB_BY_NAME } from "@decks/api";
import express, { type Request, type Response } from "express";
import type { App } from "../app.ts";
import { callerTool, conversationFor } from "../stage/caller-run.ts";
import { fromThisMachine } from "../auth/issue.ts";
import type { Principal } from "../auth/principal.ts";
import { personAgent } from "./person.ts";
import { penEditBy } from "../stage/pens.ts";
import { settleStage } from "../wire/deck.ts";
import type { StageCallResult, StageTool } from "../stage/tool.ts";

/**
 * `/api/v1`: every verb in the table (`@decks/api`) as a route, and the one way in for the SDK in
 * all three of its forms — the TypeScript client, the `decks` command and the MCP server.
 *
 * `POST /api/v1/<verb>` with `{ "args": [...] }` calls the verb for whoever the request names and
 * answers `{ ok, value, notes }`. The arguments are checked against the table before any handler
 * sees them, so a wrong call is answered with the verb's signature rather than a stack trace.
 * `GET /api/v1` lists the verbs, which is what `decks --help` prints, and `GET /api/v1/events`
 * streams every change as it is broadcast.
 *
 * Who is calling is the request's token (`auth/guard.ts`), and nothing else: `req.principal`.
 * The person, in a Decks tab or a terminal, and a paired front end acting for them (Studio) call
 * through the person's tool; they may say what they are acting on, as parameters and not as who
 * they are: `X-Decks-Stage`, the canvas on screen, and `X-Decks-Agent`, the agent they are talking
 * to; `X-Decks-Edit` names an edit to the drawing, which comes back in the `made` of the revision
 * that has it. An agent's token calls as that agent, an app's as that app, and a board's as that board: a
 * board's page is handed its own token by the page that framed it (`@decks/canvas/internal/board-host.ts`),
 * and that is the only way a call is a board's. Naming a board in a header makes nobody that board.
 */

/** The answer to one call, as the SDK reads it. */
export interface VerbAnswer extends StageCallResult {}

export function verbRoutes(app: App): express.Router {
	const router = express.Router();
	/** Apps the person let call verbs with "Allow once": remembered until the server restarts. */
	const allowedOnce = new Set<string>();

	router.get("/", (_req, res) => {
		res.set("cache-control", "no-store").json({
			verbs: ALL_VERBS.map((verb) => ({ name: verb.name, group: verb.group, touches: verb.touches, effect: verb.effect, summary: verb.summary, signature: signature(verb), ...(verb.alias ? { alias: verb.alias } : {}) })),
		});
	});

	/**
	 * Every change as it happens, for a client that is not a browser on the socket: the frames Decks
	 * broadcasts (`board.changed`, `stage.pen.delta`, `agent.state`, …), one Server-Sent Event each.
	 * `?types=board.changed,stage.pen.delta` keeps only those. A comment every 25 seconds keeps
	 * proxies from closing a quiet stream.
	 */
	router.get("/events", (req: Request, res: Response) => {
		const wanted = new Set(String(req.query.types ?? "").split(",").map((one) => one.trim()).filter(Boolean));
		// A canvas frame hears its own canvas and nothing else (`onCanvas`).
		const own = req.principal?.kind === "canvas" ? req.principal.canvas : undefined;
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
		res.write(": decks events\n\n");
		if (own !== undefined) app.canvasFrames += 1;
		const stop = app.listen((message) => {
			if (wanted.size && !wanted.has(message.type)) return;
			if (own !== undefined && !onCanvas(app, message, own)) return;
			res.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
		});
		const beat = setInterval(() => res.write(": still here\n\n"), 25_000);
		beat.unref?.();
		req.on("close", () => {
			clearInterval(beat);
			if (own !== undefined) app.canvasFrames -= 1;
			stop();
		});
	});

	/**
	 * A canvas frame's answer to an agent's `decks view …` on its canvas (`stage.call`, which its stream
	 * carries), as a tab answers on the socket. Only a front end showing the canvas answers one.
	 */
	router.post("/stage-result", (req: Request, res: Response) => {
		const kind = req.principal?.kind;
		if (kind !== "canvas" && kind !== "person" && kind !== "site") {
			res.status(403).json({ ok: false, error: "Only a page showing the canvas answers the canvas's calls." });
			return;
		}
		const result = (req.body ?? {}) as { id?: unknown; value?: unknown; error?: unknown };
		if (typeof result.id !== "string") {
			res.status(400).json({ ok: false, error: "Send { id, value } or { id, error }." });
			return;
		}
		const settled = settleStage(app.pendingStage, { id: result.id, value: result.value, ...(typeof result.error === "string" ? { error: result.error } : {}) });
		res.json({ ok: true, settled });
	});

	router.post("/:verb", async (req: Request, res: Response) => {
		const name = String(req.params.verb ?? "");
		const verb = VERB_BY_NAME.get(name);
		if (!verb) {
			res.status(404).json({ ok: false, error: `There is no verb called ${name}. GET /api/v1 lists them.`, notes: [] });
			return;
		}
		const body = (req.body ?? {}) as { args?: unknown };
		const args = body.args === undefined ? [] : body.args;
		if (!Array.isArray(args)) {
			res.status(400).json({ ok: false, error: `Send the arguments as a list: { "args": [...] }. ${signature(verb)}`, notes: [] });
			return;
		}
		if (req.principal?.kind === "canvas") {
			const refused = refusedForCanvas(app, name, Array.isArray(args) ? args : [], req.principal.canvas, req.principal.role);
			if (refused) {
				res.status(403).json({ ok: false, error: refused, notes: [] });
				return;
			}
		}
		const problem = checkArgs(verb, args);
		if (problem) {
			res.status(400).json({ ok: false, error: problem, notes: [] });
			return;
		}

		// A pairing code lets another Decks in, so only someone at the harness's own machine may make one.
		if (name === "pair.code" && !fromThisMachine(req.socket.remoteAddress, req.headers)) {
			res.status(403).json({ ok: false, error: "A pairing code is made only on the harness's own machine: run decks pair code in a shell there.", notes: [] });
			return;
		}
		const caller = await callerOf(app, req, allowedOnce);
		if ("error" in caller) {
			res.status(caller.status).json({ ok: false, error: caller.error, notes: [] });
			return;
		}
		const call = () => caller.tool.call(name, args, caller.on ?? {});
		// The person's name for an edit to the drawing, sent back with the revision that has it (`StagePens`, `penEditBy`).
		const answer = caller.edit ? await penEditBy.run(caller.edit, call) : await call();
		if (caller.announce) caller.announce(name, answer);
		res.status(answer.ok ? 200 : 422).json(answer satisfies VerbAnswer);
	});

	return router;
}

type Caller = { tool: StageTool; announce?: (verb: string, answer: StageCallResult) => void; on?: { stage?: string }; /** The person's name for the edit this call makes (`X-Decks-Edit`). */ edit?: string } | { error: string; status: number };

/** The stage tool a request acts through: the token's principal's (`auth/principal.ts`). */
export async function callerOf(app: App, req: Pick<Request, "headers"> & { principal?: Principal }, allowedOnce: Set<string>): Promise<Caller> {
	const header = (key: string) => {
		const value = req.headers[key];
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	};
	const principal = req.principal;
	switch (principal?.kind) {
		case "person":
		case "site": {
			// The person, clicking in the browser: the canvas on screen and the agent they are talking to.
			const stage = header("x-decks-stage");
			const to = header("x-decks-agent");
			const edit = header("x-decks-edit")?.slice(0, 80);
			const agent = personAgent({ agents: app.agents, pens: app.stage.pens }, { ...(stage ? { stage } : {}), ...(to ? { agent: to } : {}) });
			return { tool: agent.personTool(), on: { ...(stage ? { stage } : {}) }, ...(edit ? { edit } : {}) };
		}
		case "agent": {
			const agent = app.agents.get(principal.id);
			if (!agent) return { status: 401, error: "The agent this token was made for is gone." };
			return { tool: agent.stageTool() };
		}
		case "app":
			return appCaller(app, principal.name, allowedOnce);
		case "board":
			return boardCaller(app, principal.path, principal.stage ?? header("x-decks-stage"), allowedOnce);
		case "page":
			return { status: 403, error: "A ticket opens one page; it calls no verbs." };
		case "canvas":
			return canvasCaller(app, principal, header("x-decks-edit")?.slice(0, 80));
		default:
			return { status: 401, error: "Say who is calling with a token: Authorization: Bearer <token>. An agent's shell and an app's server have DECKS_TOKEN; a terminal gets one with decks login." };
	}
}

/**
 * A board's button: its code runs in the board's own page, with its board's token, and each verb it
 * calls comes here. Once the person has let that board (asked once, by the token's path), it acts for the conversation on the
 * board's canvas under the board's name, as its code always did; it may not make agents.
 */
async function boardCaller(app: App, path: string, stage: string | undefined, allowedOnce: Set<string>): Promise<Caller> {
	if (!app.deck.board(path)) return { status: 404, error: `There is no board at ${path}.` };
	const on = { board: path, ...(stage ? { stage } : {}) };
	if (!app.evalTrust.allows(path) && !allowedOnce.has(path)) {
		const answer = await conversationFor(app, on).bridge.choose({
			title: "Let this board use the stage?",
			message: `${path} has a button whose code calls stage verbs: it can write boards, move the canvas and message agents.`,
			options: [
				{ label: "Allow until Decks restarts" },
				{ label: "Always allow this board", description: `Remember ${path}, and stop asking` },
				{ label: "No", description: "Refuse its calls" },
			],
		});
		if (answer === "Always allow this board") app.evalTrust.allow(path);
		else if (answer === "Allow until Decks restarts") allowedOnce.add(path);
		else return { status: 403, error: `The person did not let ${path} use the stage.` };
	}
	const { tool, focused } = callerTool({ agents: app.agents, cameras: app.cameras, boards: app.boards, stage: app.stage, port: app.port }, { ...on, name: path });
	return {
		tool,
		on: stage ? { stage } : {},
		announce: (verb, answer) => {
			if (answer.ok) focused.translator.notice("info", `${path} called ${verb}`);
			else focused.translator.notice("error", `${path} called ${verb} and failed: ${answer.error}`);
		},
	};
}

/**
 * The calls a canvas frame may make, on its one canvas: reading and changing it, its cards, its
 * frames and files, undo and redo, and the time. Never another canvas, an agent, an app, the
 * person's tab, or anything that reaches past this canvas; a canvas shared to view reads only.
 */
export const CANVAS_FRAME_VERBS = new Set([
	"canvas.read", "canvas.space", "canvas.insert", "canvas.update", "canvas.replace", "canvas.delete", "canvas.move", "canvas.copy",
	"canvas.variables", "canvas.batch", "canvas.step", "canvas.fit", "canvas.save", "canvas.screenshot", "canvas.export", "canvas.rename",
	"card.create", "card.get", "card.canvases", "card.url", "frame.create", "file.url", "here", "now",
]);

/** Why a canvas frame may not make this call, or undefined when it may. */
export function refusedForCanvas(app: Pick<App, "stage">, verb: string, args: readonly unknown[], canvas: string, role: "edit" | "view"): string | undefined {
	if (!CANVAS_FRAME_VERBS.has(verb)) return `${verb} is not the canvas frame's to call: it reaches past this canvas.`;
	if (role === "view" && VERB_BY_NAME.get(verb)?.effect !== "read") return `${canvas} was shared with you to view, so ${verb} is not yours to call on it.`;
	const pens = app.stage.pens;
	for (const arg of args) {
		const asked = arg && typeof arg === "object" && !Array.isArray(arg) ? (arg as { canvas?: unknown }).canvas : undefined;
		if (asked === undefined || asked === null || asked === "") continue;
		const raw = String(asked).trim().replace(/^canvases\//, "").replace(/\/canvas(\.pen)?$/, "");
		if (raw !== canvas && pens?.titleOf(canvas).toLowerCase() !== raw.toLowerCase()) return `The canvas frame for ${canvas} acts on that canvas alone, not on ${String(asked)}.`;
	}
	return undefined;
}

/**
 * The canvas frame: the person, on its one canvas. Its calls are the person's own edits (the edit's
 * name comes back in `made`, as a tab's do), made on that canvas whatever the call names, which
 * `refusedForCanvas` has already held to it.
 */
function canvasCaller(app: App, principal: Extract<Principal, { kind: "canvas" }>, edit: string | undefined): Caller {
	const agent = personAgent({ agents: app.agents, pens: app.stage.pens }, { stage: principal.canvas });
	return { tool: agent.personTool(), on: { stage: principal.canvas }, ...(edit ? { edit } : {}) };
}

/**
 * Whether a broadcast is about one canvas: its drawing (`stage.pen`, `stage.pen.delta`, refusals), its
 * cards and boards (`board.changed` for one on it), and what is said to it alone.
 */
export function onCanvas(app: Pick<App, "stage" | "agents">, message: { type: string; [key: string]: unknown }, canvas: string): boolean {
	/*
	 * An agent's `decks view …` that moves or marks this canvas: the frame showing it answers. Showing
	 * another canvas, and a board's picture, stay the page's.
	 */
	if (message.type === "stage.call") {
		const call = message.call as { op?: string; agentId?: string; args?: { stage?: unknown } } | undefined;
		if (!call || !["show", "camera", "reload", "cursor"].includes(call.op ?? "")) return false;
		const named = typeof call.args?.stage === "string" ? call.args.stage : undefined;
		if (named !== undefined) return named === canvas;
		return !!call.agentId && app.agents.get(call.agentId)?.stageName() === canvas;
	}
	if (message.type === "stage.pen" || message.type === "stage.pen.delta") return message.stage === canvas;
	if (message.type === "board.changed") {
		const board = message.board as { path?: unknown } | undefined;
		const path = typeof board?.path === "string" ? board.path : typeof message.path === "string" ? message.path : undefined;
		if (!path) return false;
		if (path.startsWith(`canvases/${canvas}/`)) return true;
		try {
			return !!app.stage.pens?.boards(canvas).some((one) => one.path === path);
		} catch {
			return false;
		}
	}
	return false;
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
