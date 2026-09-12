import type { AgentModel, AgentState, AgentUsage, ChatItem, ExtensionUiPrompt, ModelOption } from "@decks/protocol";
import type { AgentView } from "../camera/agent-view.ts";

/**
 * Everything the browser keeps about one agent, in one record.
 *
 * Before this there were fifteen structures keyed by the same agent id — eleven fields of
 * the store and four maps beside it — and each one was added the same way: something leaked
 * between conversations, and the fix was to key one more thing. The store's own comments
 * record two of those. On `dialogs`: a background agent's question "was drawn over whichever
 * conversation you happened to be in". On `previews`: "previewing Ada's history and switching
 * left her past revisions rendered into Bo's canvas".
 *
 * A scope is instantiated, not keyed. That is the one idea worth taking from opencode's
 * `packages/app`, where state is created per server and per directory rather than stored in
 * maps indexed by them.
 *
 * ### Two halves, deliberately
 *
 * **Drawn** state goes in the store, so a component re-renders when it changes.
 * **Scratch** state does not: `view` parks a camera, `historyHeld` and `historyAsked` guard a
 * request, `lastState` detects the transition that rings the "finished" banner. None of them
 * is drawn, and putting them in the store would re-render the app on every agent state
 * change for the sake of a set membership test. They were plain `Map`s and `Set`s before
 * this for exactly that reason, and they stay plain here.
 *
 * ### Why the record must be created before it is written
 *
 * Solid's store **throws** on a nested write whose parent is missing —
 * `set("agents", id, "transcript", …)` with no `agents[id]` raises
 * `Cannot read properties of undefined`, for plain values and function updaters alike
 * (measured, not assumed). That is the safe failure: a forgotten `ensure` is a loud error at
 * the moment it happens, not data quietly dropped. Every write here goes through `ensure`
 * so the question cannot arise.
 */

/** The part that is drawn, and therefore lives in the store. */
export interface AgentRecord {
	/** The conversation, oldest first. */
	transcript: ChatItem[];
	/** Whether the server holds anything older than the oldest row here. */
	moreHistory: boolean;
	/** The models this agent's runtime offers — one list per agent, not per app. */
	models: ModelOption[];
	/** The model and thinking level it is on. */
	model?: AgentModel;
	/** Its context and cost meter. */
	usage?: AgentUsage;
	/** The question it is waiting on, if any. Drawn only in its own conversation. */
	dialog?: ExtensionUiPrompt;
	/** A point in its past being previewed, and the revisions to render while it is. */
	preview?: { entryId: string; boards: Record<string, string> };
	/** The Claude subscription it spends. */
	spending?: string;
	/**
	 * The boards it has put on the canvas.
	 *
	 * Here, while `contexts` — the boards it merely *holds* — stays in the store for now.
	 * The difference is not about the data: every use of this one narrows to a single agent
	 * before reading it, while `contexts` is handed whole to `panelSections`, which indexes
	 * it itself. Moving that means changing a signature, which is its own change.
	 */
	inPlay: string[];
}

/** The part that is never drawn, and therefore must not be reactive. */
export interface AgentScratch {
	/** Where its canvas was when you last left it (`camera/agent-view.ts`). */
	view?: AgentView;
	/** Its history has arrived and is held. */
	historyHeld: boolean;
	/** Its history has been asked for and has not arrived. */
	historyAsked: boolean;
	/** The state it was in last, so a transition can be told from a repeat. */
	lastState?: AgentState;
}

export const emptyAgent = (): AgentRecord => ({ transcript: [], moreHistory: false, models: [], inPlay: [] });

const emptyScratch = (): AgentScratch => ({ historyHeld: false, historyAsked: false });

/**
 * The scratch side: a plain map, with the same lifetime as the drawn side.
 *
 * A factory rather than a module singleton, so a test can have its own — the shape opencode
 * uses for `createServerSession`, and the reason that store has a test file at all.
 */
export function createAgentScratch() {
	const held = new Map<string, AgentScratch>();
	return {
		/** The scratch for an agent, created on first ask. */
		of(id: string): AgentScratch {
			let found = held.get(id);
			if (!found) {
				found = emptyScratch();
				held.set(id, found);
			}
			return found;
		},
		/** Read without creating — for the guards, which ask about agents that may be gone. */
		peek: (id: string): AgentScratch | undefined => held.get(id),
		forget: (id: string) => void held.delete(id),
		/**
		 * Drop what a dead connection was asked.
		 *
		 * Only the two history flags: a reconnect means nothing that was asked for is coming,
		 * but the camera you parked and the state an agent was last in are still true.
		 *
		 * Not to be confused with `forgetAskedResults` in `chat/tool-results.ts`, which is
		 * about tool output and is called beside this one on the same reconnect.
		 */
		forgetAsked() {
			for (const scratch of held.values()) {
				scratch.historyHeld = false;
				scratch.historyAsked = false;
			}
		},
		size: () => held.size,
	};
}

export type AgentScratchStore = ReturnType<typeof createAgentScratch>;
