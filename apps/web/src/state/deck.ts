import { AGENT_KINDS, type AgentChat, type AgentKind, type Board, type Camera, type Canvas, type ClaudeAccount, type DeckSettings, type DeckState, type Identity, type RuntimeInfo, type Schedule, type ServerMessage, type Task, type WebStatus } from "@decks/protocol";
import { createStore } from "solid-js/store";
import { trackZoneWith } from "../lib/time.ts";
import { emptyAgent, type AgentRecord } from "./agent.ts";

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
 * what they read. The memos — `focusedChat`, `transcript`, `busy`, `stageBoards` — stay in
 * `App.tsx`: a memo is a computation and
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
		 * What each agent is doing to which board, from `agent.act`: the cursor and the editing
		 * marks the canvas draws for an agent at work (`canvas/acts.ts`). One per agent, the
		 * latest; a finished one lingers long enough to be seen and is then dropped.
		 */
		acts: Record<string, Extract<ServerMessage, { type: "agent.act" }> | undefined>;
		/**
		 * What this install can run, and what each runtime is called, from the greeting.
		 *
		 * Empty until the first frame arrives, which is why `runtimes` below has a fallback.
		 */
		runtimes: RuntimeInfo[];
		/** The Claude subscriptions this install can use (`chat/Settings.tsx`). */
		accounts: ClaudeAccount[];
		/**
		 * The dashboard's second half: tasks and schedules, from the `tasks` frame.
		 *
		 * Two lists because they are two kinds of thing — one is a row with a state, the
		 * other a row with a next firing — and one frame because they are one pipeline.
		 */
		tasks: Task[];
		schedules: Schedule[];
		/**
		 * Every canvas in the deck, from the `canvases` frame.
		 *
		 * A canvas is what holds the boards, so this is what the dashboard's cards are drawn
		 * from and what the stage reads its arrows and groups out of. A handful of rows, sent
		 * whole, unlike the boards.
		 */
		canvases: Canvas[];
		/** The canvas this browser is looking at. The server keeps the same answer per socket. */
		canvas?: string;
		/**
		 * The last board an agent put up on the canvas on screen without moving the view, and
		 * the view that frames it. Drawn as a chip with a Go button; `at` lets it expire.
		 */
		arrival?: { agentId: string; path: string; camera: Camera; at: number };
		/** The deck's own settings, kept by the server, and the zone its machine is on. */
		settings: DeckSettings;
		machineZone: string;
		/**
		 * Which of them a **new** agent starts on. `default` is the CLI's own login.
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
		acts: {} as Record<string, Extract<ServerMessage, { type: "agent.act" }> | undefined>,
		defaultKind: "pi" as AgentKind,
		runtimes: [] as RuntimeInfo[],
		accounts: [] as ClaudeAccount[],
		tasks: [] as Task[],
		schedules: [] as Schedule[],
		canvases: [] as Canvas[],
		settings: {} as DeckSettings,
		machineZone: "",
		activeAccount: "default",
	});
}

/** The app's one deck, built by the factory above. */
export const [state, setState] = createDeck();

// A time drawn anywhere is drawn again when the deck's timezone changes: `lib/time.ts`
// reads this on every format, and stays free of Solid itself.
trackZoneWith(() => void state.settings.timezone);

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
	state.runtimes.length > 0 ? state.runtimes : AGENT_KINDS.map((kind) => ({ kind, label: kind, available: true, capabilities: { modes: [] }, commands: [], models: [] }));

/**
 * One runtime, by the kind a chat says it is on.
 *
 * Three things a chat needs to draw its composer are the runtime's and not its own: the
 * modes it offers, the `/` commands it answers and the models it can be moved to. They used
 * to arrive on every chat row, which is the same catalogue thirty-four times on a deck of
 * thirty-four chats. Undefined before the first `runtimes` frame, which every reader here
 * already has a fallback for.
 *
 * Read each of the three with `?.` even though the type says they are there. A server that
 * has not been restarted since a deploy answers with the older shape, and for the minute
 * that lasts a composer with no mode control beats one that throws.
 */
export const runtimeFor = (kind: AgentKind | undefined): RuntimeInfo | undefined =>
	kind ? runtimes().find((runtime) => runtime.kind === kind) : undefined;

/**
 * The record for an agent, created if this is the first thing said about it.
 *
 * Every write into `state.agents` goes through here first, and it is not a nicety: Solid's
 * store **throws** on a nested write whose parent is missing — `setState("agents", id,
 * "model", …)` with no `agents[id]` raises `Cannot read properties of undefined`, for plain
 * values and function updaters alike (measured). There is no single moment an agent first
 * appears — `agent.identity`, `models`, `chat.history`, `context.changed` and four others
 * all write into whichever field arrives first — so the alternative is remembering, twenty
 * times, something the compiler cannot check.
 *
 * Here rather than in the component because eleven of those writes are in the frame switch
 * (`app/frames.ts`), which is not a component and has no business being handed a store write.
 */
export const ensureAgent = (id: string): void => {
	if (!state.agents[id]) setState("agents", id, emptyAgent());
};

/** The canvas this browser is looking at, if the server has said and it still exists. */
export const focusedCanvas = (): Canvas | undefined => state.canvases.find((canvas) => canvas.id === state.canvas);

/** Whether a canvas has something on it nobody has looked at: the dashboard's mark. */
export const isNews = (canvas: Canvas): boolean => canvas.changedAt > (canvas.openedAt ?? 0);

/** What to call an agent in a sentence, without the sentence being about an id. */
export const nameOf = (id: string | undefined): string => (id ? (state.identities[id]?.name ?? "An agent") : "An agent");

/** The focused agent's question, if it has one. */
export const dialog = () => (state.focused ? state.agents[state.focused]?.dialog : undefined);

/* Clearing is always the focused agent's: it is the only one drawn, so it is the only
   one there is anything to dismiss. */
export const clearDialog = () => state.focused && state.agents[state.focused] && setState("agents", state.focused, "dialog", undefined);
export const clearPreview = () => state.focused && state.agents[state.focused] && setState("agents", state.focused, "preview", undefined);

/** The focused agent's preview, if it is looking at its own past. */
export const preview = () => (state.focused ? state.agents[state.focused]?.preview : undefined);
