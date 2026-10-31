import type { DeckAgent } from "../agents/session.ts";
import type { Registry } from "../agents/registry.ts";
import type { BoardService } from "../boards/service.ts";
import type { Cameras } from "../deck/cameras.ts";
import { boardActor } from "./caller-actor.ts";
import type { StageService } from "./service.ts";
import { createStageTool, type StageTool } from "./tool.ts";

/**
 * Verbs called by something that is not an agent: a board's button, or an app.
 *
 * Both get the stage object an agent gets, acting for **the conversation on their canvas** under
 * a name of their own (`stage/caller-actor.ts`). Each verb they call is announced in that
 * conversation (`verbs/router.ts`): a thing that starts on its own and says nothing reads as a
 * fault, and an agent reading the chat later needs to know a press or an app did something. Their
 * code runs in their own page or process; the server only answers the verbs.
 */
export interface CallerRun {
	agents: Registry;
	cameras: Cameras;
	boards: BoardService;
	stage: StageService;
	port: number;
}

export interface CallerSpec {
	/** The board the actor is: a board's own path, or an app's name as `app:<name>` (`appActor`). */
	board: string;
	/** What cursors and notices call it, as in `board plan.html` or `app polls`. */
	name: string;
	/**
	 * Whether `send({ name, kind }, …)` may make an agent. An app may: it has the whole stage API,
	 * as the person decided when they let it. A board's button may not (`caller-actor.ts`).
	 */
	mayCreate?: boolean;
	/** The canvas the press came from, when the browser names it. */
	stage?: string;
}

/** An app's actor's path: what its cursors, notices and conversation are keyed by. */
export const appActor = (name: string) => `app:${name}`;

/**
 * Whether a canvas holds what an actor is: its board, or for an app (`app:<name>`) an item showing it.
 * Top-level items only, as a canvas places its boards.
 */
export function canvasHolds(pens: StageService["pens"], canvas: string | undefined, board: string): boolean {
	if (!pens || !canvas) return false;
	try {
		if (!board.startsWith("app:")) return pens.boards(canvas).some((one) => one.path === board);
		const name = board.slice(4);
		return (pens.get(canvas).doc.children ?? []).some((node) => node.type === "browser" && (node.metadata as { type?: unknown; name?: unknown } | undefined)?.type === "decks.app" && (node.metadata as { name?: unknown }).name === name);
	} catch {
		return false;
	}
}

/**
 * The conversation a run acts for: one on the board's own canvas. That is the canvas the press came
 * from when the browser names it, or else one holding the board, the agent on screen first; only a
 * board on no agent's canvas falls back to the focused conversation, minted if nobody has spoken yet.
 * Never simply the last agent any browser touched, which may be on another canvas entirely.
 */
export function conversationFor(context: Pick<CallerRun, "agents"> & { stage?: Pick<StageService, "pens"> }, on: { board: string; stage?: string }): DeckAgent {
	const looking = context.agents.looking();
	const all = looking ? [looking, ...context.agents.all().filter((one) => one !== looking)] : [...context.agents.all()];
	if (on.stage) {
		const there = all.find((one) => one.stageName() === on.stage);
		if (there) return there;
	}
	// An app is on a canvas by an item, not in anyone's context: the conversation on a canvas showing it.
	if (on.board.startsWith("app:")) return all.find((one) => canvasHolds(context.stage?.pens, one.stageName(), on.board)) ?? context.agents.focused();
	return all.find((one) => one.inPlay.includes(on.board)) ?? context.agents.focused();
}

/**
 * The stage tool a board or an app acts through: the conversation it acts for (`conversationFor`),
 * under its own name; `/api/v1/<verb>` calls one verb on it at a time (`verbs/router.ts`).
 */
export function callerTool(context: CallerRun, spec: CallerSpec): { tool: StageTool; focused: DeckAgent } {
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
		deliver: (fromId: string, target: string, spec: Parameters<Registry["deliver"]>[2]) => context.agents.deliver(fromId, target, spec),
		// The board's canvas: the one the press came from, else the conversation's when it holds the board, else any that does.
		here: () => {
			if (spec.stage) return spec.stage;
			if (focused.inPlay.includes(spec.board) || canvasHolds(context.stage.pens, focused.stageName?.(), spec.board)) return focused.stageName?.();
			const pens = context.stage.pens;
			return pens?.names().find((name) => canvasHolds(pens, name, spec.board)) ?? focused.stageName?.();
		},
		...(spec.mayCreate ? { create: (fromId: string, made: Parameters<Registry["createFor"]>[1]) => context.agents.createFor(fromId, made) } : {}),
		recordRevision: (board: string) => context.boards.recordRevision(board),
		boardPathOf: (file: string) => context.boards.boardPathOf(file),
	};
	const actor = boardActor({ path: spec.board, name: spec.name, conversation });
	return { tool: createStageTool({ stage: context.stage, agent: actor, port: context.port }), focused };
}
