import { VERB_BY_NAME } from "@decks/api";
import type { Request } from "express";
import type { Principal } from "../auth/principal.ts";
import { appTool, conversationForApp } from "./app-caller.ts";
import type { CallsHost } from "./host.ts";
import { personAgent } from "./person.ts";
import type { StageCallResult, StageTool } from "./tool.ts";

/**
 * Who is calling, as the thing a call runs through: made from the token's principal
 * (`auth/principal.ts`), once per call, here and nowhere else.
 *
 * - the person, or a front end paired to act for them: the person's tool, on the canvas on screen
 *   and beside the agent they are talking to;
 * - an agent: its own tool;
 * - an app: the tool of the conversation on screen, under the app's name, once the person has let it;
 * - a canvas frame: the person's tool, on its one canvas.
 */
export type Caller = { tool: StageTool; announce?: (verb: string, answer: StageCallResult) => void; on?: { stage?: string }; /** The person's name for the edit this call makes (`X-Decks-Edit`). */ edit?: string } | { error: string; status: number };

/** The caller a request is: its token's principal, as the tool its calls run through. */
export async function callerOf(app: CallsHost, req: Pick<Request, "headers"> & { principal?: Principal }): Promise<Caller> {
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
			// An agent that works outside Decks is here while it calls, and what it changes is said in its conversation.
			agent.inbox.touch();
			return { tool: agent.stageTool(), ...(agent.inbox.outsideKey ? { announce: (name: string, answer: StageCallResult) => {
						if (answer.ok && VERB_BY_NAME.get(name)?.effect === "change" && name !== "agent.news") agent.inbox.noteAct(actLine(name, answer));
					},
				}
				: {}) };
		}
		case "app":
			return appCaller(app, principal.name);
		case "canvas":
			return canvasCaller(app, principal, header("x-decks-edit")?.slice(0, 80));
		default:
			return { status: 401, error: "Say who is calling with a token: Authorization: Bearer <token>. An agent's shell and an app's server have DECKS_TOKEN; a terminal gets one with decks login." };
	}
}

/** One changing call by an outside agent, as a line in its conversation: the command, and the card or item it named. */
function actLine(name: string, answer: StageCallResult): string {
	const value = answer.value as { path?: unknown; card?: unknown; id?: unknown; name?: unknown; deleted?: unknown } | undefined;
	const what = value && typeof value === "object" ? [value.path, value.card, value.name, value.deleted, value.id].find((one) => typeof one === "string") : undefined;
	return `decks ${name.replace(/\./g, " ")}${what ? `: ${what}` : ""}`;
}

/**
 * The canvas frame: the person, on its one canvas. Its calls are the person's own edits (the edit's
 * name comes back in `made`, as a tab's do), made on that canvas whatever the call names, which
 * `refusedForCanvas` has already held to it.
 */
function canvasCaller(app: CallsHost, principal: Extract<Principal, { kind: "canvas" }>, edit: string | undefined): Caller {
	const agent = personAgent({ agents: app.agents, pens: app.stage.pens }, { stage: principal.canvas });
	return { tool: agent.personTool(), on: { stage: principal.canvas }, ...(edit ? { edit } : {}) };
}

/**
 * An app's calls: once the person has let it, it acts for the conversation on screen, under the
 * app's own name, and each call is noted in that conversation, as an app's stage code always was.
 */
async function appCaller(app: CallsHost, name: string): Promise<Caller> {
	if (!app.apps.exists(name)) return { status: 404, error: `There is no app called ${name}.` };
	// Trusted under `apps/<name>` as it always was, so an "Always allow" given before still holds.
	const key = `apps/${name}`;
	if (!app.appTrust.allows(key) && !app.appsAllowedOnce.has(key)) {
		const answer = await conversationForApp(app, name).bridge.choose({
			title: "Let this app use the stage?",
			message: `The app ${name} wants to call stage verbs: write cards, move the canvas, message agents.`,
			options: [
				{ label: "Allow until Decks restarts" },
				{ label: "Always allow this app", description: `Remember ${name}, and stop asking` },
				{ label: "No", description: "Refuse its calls" },
			],
		});
		if (answer === "Always allow this app") app.appTrust.allow(key);
		else if (answer === "Allow until Decks restarts") app.appsAllowedOnce.add(key);
		else return { status: 403, error: `The person did not let ${name} use the stage.` };
	}
	const { tool, conversation } = appTool(app, name);
	return {
		tool,
		announce: (verb, answer) => {
			if (answer.ok) conversation.translator.notice("info", `app ${name} called ${verb}`);
			else conversation.translator.notice("error", `app ${name} called ${verb} and failed: ${answer.error}`);
		},
	};
}
