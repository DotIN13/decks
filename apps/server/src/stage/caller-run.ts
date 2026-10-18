import type { DeckAgent } from "../agents/session.ts";
import type { Registry } from "../agents/registry.ts";
import type { BoardService } from "../boards/service.ts";
import type { Cameras } from "../deck/cameras.ts";
import { boardActor } from "./board-actor.ts";
import { runEval, safeJson, type EvalOutcome } from "./eval.ts";
import type { StageService } from "./service.ts";
import { createStageTool, type StageTool } from "./tool.ts";

/**
 * Stage code run by something that is not an agent: a board's button, or an app.
 *
 * Both get the stage object an agent gets, acting for **the focused conversation** — the one the
 * person is reading — under a name of their own (`stage/board-actor.ts`). Both are announced in
 * that conversation, one notice per run, whether it worked or not: a thing that starts on its own
 * and says nothing reads as a fault, and an agent reading the chat later needs to know a press or
 * an app did something.
 *
 * What differs is where the code comes from and who decided it may run, and that stays with the
 * caller: a board's code is read from its file (`wire/boards.ts`), an app's arrives on a request
 * from its server or its page (`http.ts`), and each is trusted once by the person.
 */
export interface CallerRun {
	agents: Registry;
	cameras: Cameras;
	boards: BoardService;
	stage: StageService;
	port: number;
}

export interface CallerRunSpec {
	/** The board the actor is: a board's own path, or an app's board (`boards/apps/<name>.html`). */
	board: string;
	/** What cursors and notices call it, as in `board plan.html` or `app polls`. */
	name: string;
	code: string;
	/** Names added to the code's scope; `event` for both callers. */
	scope?: Record<string, unknown>;
	/** How the notice says what ran, as in `ran "save"`. */
	what: string;
	/**
	 * Whether `stage.send({ name, kind }, …)` may make an agent. An app may: it has the whole stage
	 * API, as the person decided when they let it run. A board's button may not (`board-actor.ts`).
	 */
	mayCreate?: boolean;
	/** The canvas the press came from, when the browser names it. */
	stage?: string;
}

/**
 * The conversation a run acts for: one on the board's own canvas. That is the canvas the press came
 * from when the browser names it, or else one holding the board, the agent on screen first; only a
 * board on no agent's canvas falls back to the focused conversation, minted if nobody has spoken yet.
 * Never simply the last agent any browser touched, which may be on another canvas entirely.
 */
export function conversationFor(context: Pick<CallerRun, "agents">, on: { board: string; stage?: string }): DeckAgent {
	const looking = context.agents.looking();
	const all = looking ? [looking, ...context.agents.all().filter((one) => one !== looking)] : [...context.agents.all()];
	if (on.stage) {
		const there = all.find((one) => one.stageName() === on.stage);
		if (there) return there;
	}
	return all.find((one) => one.inPlay.includes(on.board)) ?? context.agents.focused();
}

/**
 * The stage tool a board or an app acts through: the conversation it acts for (`conversationFor`),
 * under its own name. `runAsCaller` runs code against its `stage`; `/api/v1/<verb>` calls one verb
 * on it for an app (`verbs/router.ts`).
 */
export function callerTool(context: CallerRun, spec: Omit<CallerRunSpec, "code" | "scope" | "what">): { tool: StageTool; focused: DeckAgent } {
	const focused = conversationFor(context, { board: spec.board, ...(spec.stage ? { stage: spec.stage } : {}) });
	const conversation = {
		id: focused.id,
		context: () => [...focused.context],
		inPlay: () => [...focused.inPlay],
		setInPlay: (paths: string[], at?: Record<string, { x: number; y: number }>) => focused.setInPlay(paths, { place: true, ...(at ? { at } : {}) }),
		positions: () => focused.positions(),
		setPosition: (board: string, x: number, y: number) => focused.setPosition(board, x, y),
		camera: () => context.cameras.answer(focused.id, focused.stageName?.()),
		queue: () => focused.queue(),
		agents: () => context.agents.summaries(),
		send: (fromId: string, target: string, spec: Parameters<Registry["send"]>[2]) => context.agents.send(fromId, target, spec),
		...(spec.mayCreate ? { create: (fromId: string, made: Parameters<Registry["createFor"]>[1]) => context.agents.createFor(fromId, made) } : {}),
		recordRevision: (board: string) => context.boards.recordRevision(board),
		boardPathOf: (file: string) => context.boards.boardPathOf(file),
	};
	const actor = boardActor({ path: spec.board, name: spec.name, conversation });
	return { tool: createStageTool({ stage: context.stage, agent: actor, port: context.port }), focused };
}

export async function runAsCaller(context: CallerRun, spec: CallerRunSpec): Promise<EvalOutcome> {
	const { tool, focused } = callerTool(context, spec);
	const outcome = await runEval(spec.code, tool.stage, { scope: spec.scope ?? {} });

	// The first line of the code is in the notice because that is what makes it checkable.
	const first = spec.code.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
	const said = first.length > 80 ? `${first.slice(0, 80)}…` : first;
	if (outcome.error) focused.translator.notice("error", `${spec.name} ${spec.what} and failed: ${outcome.error}`);
	else {
		const returned = outcome.value === undefined ? "" : ` → ${safeJson(outcome.value).replace(/\s+/g, " ").slice(0, 200)}`;
		focused.translator.notice("info", `${spec.name} ${spec.what}: ${said}${returned}`);
	}
	return outcome;
}
