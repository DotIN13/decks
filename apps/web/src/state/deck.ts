import { AGENT_KINDS, type AgentChat, type AgentKind, type Board, type ClaudeAccount, type DeckState, type Identity, type RuntimeInfo, type WebStatus } from "@decks/protocol";
import { createStore } from "solid-js/store";
import type { AgentRecord } from "./agent.ts";

/**
 * The server's view of the world, as one store.
 *
 * Layer 0, with `selection` and `socket`. It imports `agent` for the record type and
 * nothing else; every module above imports this one.
 *
 * **One store, not three.** Splitting it by reader was considered and measured against:
 * the fields do not cluster. `focused` is read by eight of the file's ten regions and
 * `boards` by seven, and almost every other field is read by the socket switch *and* the
 * render body and nowhere else. Three stores would be three imports in the same two places.
 *
 * ### What is here and what is not
 *
 * The four derived below are plain functions, so they need no owner and live here beside
 * what they read. The six that are `createMemo` — `focusedChat`, `transcript`, `busy`,
 * `held`, `contextBoards`, `stageBoards` — stay in `App.tsx`: a memo is a computation and
 * needs a reactive owner, which module scope does not have. They read this store by import
 * instead of by closure, which is the only thing that changed for them.
 *
 * `dialog`, `preview` and the two clears reach into `state.agents`, so they are arguably
 * `agent`'s rather than the deck's. They are here because the store is here; moving them
 * would make `agent` import `deck`, which the graph allows but which should be a decision
 * rather than a side-effect of where the store happened to land.
 */

/** A line in the notice strip: something the app has to say, briefly. */
export interface Notice {
	id: number;
	level: "info" | "warn" | "error";
	text: string;
}

function createDeck() {
	return createStore<{
		deck?: DeckState;
		boards: Board[];
		notices: Notice[];
		/** One entry per agent, so switching chats (M5) is a lookup and not a fetch. */
		chats: AgentChat[];
		focused?: string;
		identities: Record<string, Identity>;
		/**
		 * Everything else the browser keeps per agent, one record each (`state/agent.ts`).
		 *
		 * Nine fields used to sit here as nine parallel `Record<string, …>` maps, and every
		 * one of them was added the same way — something leaked between conversations, and
		 * the fix was to key one more thing. Two of those are worth keeping in writing.
		 *
		 * There was one `dialog`, so a background agent's question was drawn over whichever
		 * conversation you happened to be in, and the card could not say whose it was. And
		 * `timeline.preview` always carried an `agentId` that the browser threw away, so
		 * previewing Ada's history and switching left her past revisions rendered into Bo's
		 * canvas, read-only, with nothing saying whose they were.
		 *
		 * A record is created before it is written and dropped whole when the agent goes —
		 * which is also how four fields stopped leaking on removal, since the old teardown
		 * cleared seven of the eleven maps by hand and missed the rest.
		 */
		agents: Record<string, AgentRecord | undefined>;
		/** The user's shared Chrome, from `web.status`; the status board draws it (`live-web.js`). */
		web?: { status: WebStatus; code?: string };
		/**
		 * Boards each agent is holding, from `context.changed`.
		 *
		 * Still a map, unlike the nine that moved: this one is handed *whole* to
		 * `panelSections`, which indexes it itself. Moving it means changing that signature.
		 */
		contexts: Record<string, string[]>;
		/** Reload counters from `stage.reload`, per board. */
		nonces: Record<string, number>;
		defaultKind: AgentKind;
		cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
		/**
		 * What this install can run, and what each runtime is called, from the greeting.
		 *
		 * Empty until the first frame arrives, which is why `runtimes` below has a fallback.
		 */
		runtimes: RuntimeInfo[];
		/** The Claude subscriptions this install can use (`chat/Settings.tsx`). */
		accounts: ClaudeAccount[];
		/**
		 * Which of them a **new** agent starts on. `default` is the CLI's own login.
		 *
		 * Not "which one is spending": each agent records its own, on its own record
		 * (`state/agent.ts`, `spending`). With three agents on three subscriptions one row
		 * cannot answer it.
		 */
		activeAccount: string;
	}>({
		boards: [],
		notices: [],
		chats: [],
		identities: {},
		agents: {} as Record<string, AgentRecord | undefined>,
		contexts: {} as Record<string, string[]>,
		nonces: {} as Record<string, number>,
		defaultKind: "pi" as AgentKind,
		runtimes: [] as RuntimeInfo[],
		accounts: [] as ClaudeAccount[],
		activeAccount: "default",
	});
}

/** The app's one deck, built by the factory above. */
export const [state, setState] = createDeck();

/**
 * What this install can run, in the protocol's order.
 *
 * The server owns this — which runtimes exist, what to call them, and whether the machine
 * can start them — but the menu is drawn before the first frame arrives, so an empty list
 * falls back to the four names the protocol knows, all assumed usable. That is exactly what
 * the menu did before this frame existed; the greeting upgrades it a beat later with the
 * real labels and the real answer.
 */
export const runtimes = (): RuntimeInfo[] =>
	state.runtimes.length > 0 ? state.runtimes : AGENT_KINDS.map((kind) => ({ kind, label: kind, available: true }));

/** The focused agent's question, if it has one. */
export const dialog = () => (state.focused ? state.agents[state.focused]?.dialog : undefined);

/* Clearing is always the focused agent's: it is the only one drawn, so it is the only
   one there is anything to dismiss. */
export const clearDialog = () => state.focused && state.agents[state.focused] && setState("agents", state.focused, "dialog", undefined);
export const clearPreview = () => state.focused && state.agents[state.focused] && setState("agents", state.focused, "preview", undefined);

/** The focused agent's preview, if it is looking at its own past. */
export const preview = () => (state.focused ? state.agents[state.focused]?.preview : undefined);
