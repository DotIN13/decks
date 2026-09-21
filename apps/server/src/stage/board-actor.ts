import type { AgentKind, AgentState, Camera, Identity } from "@decks/protocol";
import type { QueuedWork, SendSpec, StageAgentHooks } from "./tool.ts";

/**
 * The stage object a *board* is when it runs its own code.
 *
 * `stage/eval.ts` takes any stage object, and this is the one a board gets: the same API an
 * agent has, with two questions answered rather than inherited.
 *
 * **Whose canvas is it.** Every canvas verb is keyed by a conversation (`service.show(id)`)
 * and the browser defers an op whose id is not the conversation on screen
 * (`canvas/stage-ops.ts`). A board is not a conversation, so `id` is **the focused
 * conversation's**: a click on a board moves the canvas the person is looking at, which is
 * the whole point of a board being able to show something. The board's own name and colour
 * stay its own, so a cursor or a notice says which board did it.
 *
 * **Who it is.** `identity()` is the board's, never a real agent's. That is what keeps
 * `stage.me.setName` from renaming a colleague: a board may call it (the snippet is the
 * board's own words) and it changes only the label used for the rest of that run.
 *
 * Everything that is *about the conversation* — what it holds, what is on its canvas, where
 * its boards sit, its queue, the agent list — is delegated. A board acting on the canvas is
 * acting for the conversation in front of it, which is also what makes the delegation
 * legible: the board's changes appear in the chat the user is reading.
 *
 * A board hands work over with `stage.send`, which queues it and returns: a board's run is
 * abandoned by `runEval` at 20 seconds, so nothing here can wait for an answer either.
 */
export interface BoardConversation {
	/** The focused conversation's id, which is what the canvas verbs are keyed by. */
	id: string;
	context(): string[];
	inPlay(): string[];
	setInPlay(paths: string[]): void;
	positions?(): Record<string, { x: number; y: number }>;
	setPosition?(path: string, x: number, y: number): void;
	camera(): Camera;
	/** This conversation's own queue, which `stage.queue()` answers with. */
	queue(): QueuedWork[];
	agents(): Array<{
		id: string;
		name: string;
		state: AgentState;
		context: string[];
		holding: number;
		kind: AgentKind;
		tags: string[];
		workspace?: string;
		queued?: number;
	}>;
	send(fromId: string, target: string, spec: SendSpec): { queued: true; position: number };
	recordRevision(path: string): string | undefined;
	boardPathOf(file: string): string | undefined;
}

/** A grey that is no agent's: a board is not in the colour rotation. */
const BOARD_COLOR = "#8a8f98";

/** The name a board goes by in a cursor label or a sentence: its file's name. */
function boardName(path: string): string {
	return `board ${path.split("/").filter(Boolean).pop() ?? path}`;
}

export function boardActor(options: { path: string; conversation: BoardConversation }): StageAgentHooks {
	const { path, conversation } = options;
	let identity: Identity = { name: boardName(path), color: BOARD_COLOR };

	return {
		id: conversation.id,
		identity: () => identity,
		context: () => conversation.context(),
		inPlay: () => conversation.inPlay(),
		setInPlay: (paths) => conversation.setInPlay(paths),
		...(conversation.positions ? { positions: () => conversation.positions!() } : {}),
		...(conversation.setPosition ? { setPosition: (board: string, x: number, y: number) => conversation.setPosition!(board, x, y) } : {}),
		/*
		 * The four identity writers change only this run's label.
		 *
		 * `setTags` and `setWorkspace` answer with what they stored, which is nothing: a board
		 * has no row in the chat list to carry either, and pretending otherwise would be a
		 * board editing the user's panel.
		 */
		rename: (name) => {
			const clean = name.trim().slice(0, 40);
			if (clean) identity = { ...identity, name: clean };
		},
		setAvatar: (url) => {
			identity = { ...identity, avatar: url };
		},
		setTags: () => [],
		setWorkspace: () => null,
		agents: () => conversation.agents(),
		camera: () => conversation.camera(),
		// The sender is the conversation, because a queue's reply has to find somebody to
		// land in and a board has no inbox of its own.
		send: (target, spec) => conversation.send(conversation.id, target, spec),
		queue: () => conversation.queue(),
		recordRevision: (board) => conversation.recordRevision(board),
		boardPathOf: (file) => conversation.boardPathOf(file),
	};
}
