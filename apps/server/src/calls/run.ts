import { checkArgs, PERSON_VERB_BY_NAME, signature, VERB_BY_NAME } from "@decks/api";
import type { ServerMessage } from "@decks/protocol";
import { fromThisMachine } from "../auth/issue.ts";
import { actsAsPerson, type Principal } from "../auth/principal.ts";
import { penEditBy } from "../canvas/pens.ts";
import { callerOf } from "./caller.ts";
import { refusedForCanvas } from "./canvas-frame.ts";
import type { CallsHost } from "./host.ts";
import { personTable, type PersonCall, type PersonHost } from "./person-table.ts";
import { renamedVerb } from "./renamed.ts";
import type { StageCallResult } from "./tool.ts";

/**
 * The one way a call is run, whoever makes it and however it arrives: `POST /api/v1/<verb>`
 * (`connections/routes/v1.ts`), the line's `line.call` (`connections/line.ts`), an MCP tool (`connections/routes/mcp.ts`), the tab
 * socket's old requests and the side routes kept as aliases.
 *
 * Who is calling is the request's token (`auth/guard.ts`), and nothing else. The person, in a Decks
 * tab or a terminal, and a paired front end acting for them (Studio) may say what they are acting
 * on, as parameters and not as who they are: `X-Decks-Stage`, the canvas on screen, and
 * `X-Decks-Agent`, the agent they are talking to; `X-Decks-Edit` names an edit to the drawing, which
 * comes back in the `made` of the revision that has it. An agent's token calls as that agent, an
 * app's pass as that app, and a canvas pass as the person on its one canvas (`caller.ts`). Naming
 * anyone in a header makes nobody them.
 */

/** The answer to one call, as the SDK reads it. */
interface VerbAnswer extends StageCallResult {}

/**
 * One verb called for a principal, as `POST /api/v1/<verb>` and the line's `call` both run it: the verb
 * looked up, its arguments checked against the table, a canvas frame held to its canvas, the caller's
 * tool found for the token, and the answer as the SDK reads it, with the status a request would get.
 * `headers` carry what the caller says it acts on (`X-Decks-Stage`, `X-Decks-Agent`, `X-Decks-Edit`).
 */
export async function runVerb(app: CallsHost & PersonHost, principal: Principal | undefined, headers: Record<string, string | string[] | undefined>, name: string, rawArgs: unknown, remoteAddress?: string, asked?: Partial<Pick<PersonCall, "tell" | "view" | "tokenId">>): Promise<{ status: number; answer: VerbAnswer }> {
	const refuse = (status: number, error: string) => ({ status, answer: { ok: false, error, notes: [] } satisfies VerbAnswer });
	const verb = VERB_BY_NAME.get(name) ?? PERSON_VERB_BY_NAME.get(name);
	if (!verb) return refuse(404, renamedVerb(name) ?? `There is no verb called ${name}. GET /api/v1 lists them.`);
	const args = rawArgs === undefined ? [] : rawArgs;
	if (!Array.isArray(args)) return refuse(400, `Send the arguments as a list: { "args": [...] }. ${signature(verb)}`);
	if (verb.who === "person") {
		// The person's own verbs (`person-table.ts`): the harness answers them itself, for the person or a paired site and nobody else.
		if (!actsAsPerson(principal)) return refuse(403, `${name} is the person's to call, from a Decks page or a paired site.`);
		const problem = checkArgs(verb, args);
		if (problem) return refuse(400, problem);
		const header = (key: string) => {
			const value = headers[key];
			return typeof value === "string" && value.trim() ? value.trim() : undefined;
		};
		const notes: string[] = [];
		const tell = asked?.tell ?? ((message: ServerMessage) => notes.push(JSON.stringify(message)));
		const on = { ...(header("x-decks-stage") ? { stage: header("x-decks-stage") } : {}), ...(header("x-decks-agent") ? { agent: header("x-decks-agent") } : {}), ...(header("x-decks-edit") ? { edit: header("x-decks-edit")!.slice(0, 80) } : {}) };
		try {
			const value = await personTable(app)[name]!(args, { tell, ...(asked?.view ? { view: asked.view } : {}), ...(asked?.tokenId ? { tokenId: asked.tokenId } : {}), on });
			return { status: 200, answer: { ok: true, ...(value !== undefined ? { value } : {}), notes } };
		} catch (error) {
			return { status: 422, answer: { ok: false, error: error instanceof Error ? error.message : String(error), notes } };
		}
	}
	if (principal?.kind === "canvas") {
		const refused = refusedForCanvas(app, name, args, principal.canvas, principal.role);
		if (refused) return refuse(403, refused);
	}
	const problem = checkArgs(verb, args);
	if (problem) return refuse(400, problem);
	// A pairing code lets another Decks in, so only someone at the harness's own machine may make one.
	if (name === "pair.code" && !fromThisMachine(remoteAddress, headers)) return refuse(403, "A pairing code is made only on the harness's own machine: run decks pair code in a shell there.");
	const caller = await callerOf(app, { headers, principal });
	if ("error" in caller) return refuse(caller.status, caller.error);
	const call = () => caller.tool.call(name, args, caller.on ?? {});
	// The person's name for an edit to the drawing, sent back with the revision that has it (`StagePens`, `penEditBy`).
	const answer = caller.edit ? await penEditBy.run(caller.edit, call) : await call();
	if (caller.announce) caller.announce(name, answer);
	return { status: answer.ok ? 200 : 422, answer };
}
