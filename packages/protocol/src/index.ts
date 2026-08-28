/**
 * Every shape that crosses between the server and the browser, and nothing else.
 *
 * Both sides import this package, so a change here is a change both sides are
 * forced to agree with — which is the point of it being its own package rather
 * than a folder in one of them.
 */

// --- the deck ------------------------------------------------------------------

/** A directory the deck declares readable, so an embed can reach outside it. */
export interface Root {
	path: string;
	writable: boolean;
	/** Resolved and checked at load; a root that is not there is listed, not dropped. */
	exists: boolean;
}

/**
 * One board, as the browser needs it.
 *
 * `x`/`y` come from `deck.json` — where a board sits is a property of the
 * arrangement. `w`/`h` come from the board's own `<meta name="board">`, or from
 * measuring the document when it says nothing: how big a page is, is a property
 * of the page.
 */
export interface Board {
	/** Deck-relative, forward slashes on every platform: "boards/plan.html". */
	path: string;
	title: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * Bumped whenever the file changes. Two jobs: it busts the frame's cache, and
	 * a patch carries the rev it was composed against so a stale write is refused
	 * rather than applied (§6.5).
	 */
	rev: number;
	/** `<meta name="poster">`, deck-relative. A cheap rail image for a heavy board. */
	poster?: string;
	/** Agent ids holding this board in context. */
	inContext: string[];
	/** Agent id, or "you". Drawn as a fading tint on the board's edge. */
	lastWrittenBy?: string;
}

export interface DeckState {
	/** Absolute path of the open deck. */
	path: string;
	name: string;
	boards: Board[];
	roots: Root[];
}

// --- the chats -----------------------------------------------------------------

export type AgentState = "idle" | "thinking" | "streaming" | "tool" | "waiting";

/**
 * Which runtime is behind an agent.
 *
 * Fixed for an agent's life: a live session cannot change the process it is talking to,
 * and pretending otherwise would mean silently starting a new conversation.
 */
export type AgentKind = "pi" | "claude";

/**
 * How much an agent asks before acting.
 *
 * Claude Code's four permission modes, under its own names. Pi has none — permissions
 * there are an extension's business (DESIGN §6.8) — so `capabilities.modes` says which of
 * these an agent actually offers and the composer shows the control only when it does.
 */
export type AgentMode = "manual" | "acceptEdits" | "plan" | "auto";

/** What an agent's runtime can do, where runtimes differ. */
export interface AgentCapabilities {
	/** Empty for a runtime with no notion of asking first. */
	modes: AgentMode[];
}

/** One row in the chat list: an agent, as a messaging app would draw it. */
export interface AgentChat {
	id: string;
	/** The agent named itself, through `stage.me.setName`. */
	name: string;
	/** `/api/avatar/<id>?rev=N`, if it drew one. */
	avatar?: string;
	/** A subagent is a chat too, tagged with the parent it reports to. */
	parentId?: string;
	state: AgentState;
	lastLine?: string;
	lastAt?: number;
	unread: number;
	contextCount: number;
	kind: AgentKind;
	capabilities: AgentCapabilities;
	/** Absent when the runtime has no modes. */
	mode?: AgentMode;
}

export interface Identity {
	name: string;
	avatar?: string;
	/** Assigned on creation, used for cursors and board-edge tints. */
	color: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** A model the user may pick, as the picker needs it. */
export interface ModelOption {
	provider: string;
	model: string;
	label: string;
	/** Whether the model has thinking levels worth offering. */
	reasoning: boolean;
}

export interface AgentModel {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

/** What the agent has spent, sampled at the moments that move it. */
export interface AgentUsage {
	/** Tokens in the context now, or null before the first reply comes back. */
	contextTokens: number | null;
	contextWindow: number;
	cost: number;
}

// --- the transcript ------------------------------------------------------------

export type ChatItem =
	| { kind: "user"; id: string; text: string; at: number; entryId?: string }
	| { kind: "assistant"; id: string; text: string; at: number; thinking?: string; streaming?: boolean }
	| { kind: "tool"; id: string; name: string; title: string; args?: unknown; result?: string; images?: number; state: "running" | "done" | "error" }
	| { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string; at: number };

/** The tool's own rendering hint: how the chip reads before you expand it. */
export interface ToolSummary {
	name: string;
	title: string;
}

// --- editing -------------------------------------------------------------------

export type ComponentKind = "sticky" | "card" | "text" | "arrow" | "image" | "embed" | "panel";

export interface Rect {
	left: number;
	top: number;
	width?: number;
	height?: number;
}

/**
 * A user edit, declarative so the server can apply it to the file itself.
 *
 * The browser mutates the frame's DOM optimistically and sends one of these; the
 * file is the artifact, so the optimistic mutation is a preview of a write and a
 * refused write re-syncs it.
 */
export type BoardPatch =
	| { op: "insert"; kind: ComponentKind; id: string; at: Rect; text?: string; embed?: string }
	| { op: "update"; id: string; style?: Partial<Rect>; class?: string; attrs?: Record<string, string> }
	| { op: "text"; id: string; text: string }
	| { op: "remove"; id: string }
	| { op: "order"; id: string; to: "front" | "back" };

/** What the agent is told the user changed, and what `stage.edits()` returns. */
export interface UserEdit {
	path: string;
	at: number;
	summary: string;
	ids: string[];
}

// --- the stage -----------------------------------------------------------------

export interface Camera {
	x: number;
	y: number;
	zoom: number;
}

/**
 * The server asking the browser to do something to the stage, and awaiting it.
 *
 * Reads that the server can answer itself never become one of these; this is only
 * for what only the browser knows or only the browser can do.
 */
export interface StageCall {
	id: string;
	op: "show" | "camera" | "move" | "highlight" | "reload" | "cursor" | "toast" | "read";
	args: unknown;
}

export type StageResult = { id: string; value?: unknown; error?: string };

// --- extension UI (Pi's dialog surface, serialised) -----------------------------

export interface WidgetSpan {
	text: string;
	role?: string;
	bold?: boolean;
}
export type WidgetLine = WidgetSpan[];

export type ExtensionUiPrompt =
	| { id: string; method: "select"; title: string; options: string[] }
	| { id: string; method: "confirm"; title: string; message: string }
	| { id: string; method: "input"; title: string; placeholder?: string }
	| { id: string; method: "editor"; title: string; prefill?: string }
	| { id: string; method: "custom"; lines: WidgetLine[] };

export type ExtensionUiAnswer =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

// --- the wire ------------------------------------------------------------------

export type ClientMessage =
	| { type: "deck.open"; path: string }
	| { type: "board.move"; path: string; x: number; y: number }
	| { type: "board.patch"; path: string; rev: number; patches: BoardPatch[] }
	| { type: "board.undo"; path: string }
	/** Put a board on the canvas / take it off again. The context is untouched either way. */
	| { type: "board.play"; path: string }
	| { type: "board.hide"; path: string }
	| { type: "board.comment"; path: string; id: string; text: string }
	| { type: "camera.set"; camera: Camera }
	| { type: "agent.create"; parentId?: string; kind?: AgentKind }
	| { type: "agent.focus"; id: string }
	| { type: "agent.prompt"; id: string; text: string }
	| { type: "agent.abort"; id: string }
	| { type: "agent.setModel"; id: string; provider: string; model: string; thinking?: ThinkingLevel }
	| { type: "agent.thinking"; id: string; thinking: ThinkingLevel }
	| { type: "agent.setMode"; id: string; mode: AgentMode }
	| { type: "stage.result"; result: StageResult }
	| { type: "extension.ui.answer"; answer: ExtensionUiAnswer }
	| { type: "rewind.preview"; id: string; entryId: string | null }
	| { type: "rewind.to"; id: string; entryId: string }
	| { type: "fork.from"; id: string; entryId: string }
	/** Write the boards back to how they were at that point. Deliberate, never implied. */
	| { type: "boards.restore"; id: string; entryId: string };

export type ServerMessage =
	| { type: "deck.state"; deck: DeckState }
	| { type: "board.changed"; path: string; rev: number; board?: Board; removed?: boolean }
	| { type: "board.patched"; path: string; rev: number; refused?: string }
	| {
			type: "agents";
			chats: AgentChat[];
			focused?: string;
			/** What `+` hands a new agent, from `DECKS_BACKEND`. */
			defaultKind: AgentKind;
	  }
	| { type: "agent.state"; id: string; state: AgentState }
	| { type: "agent.identity"; id: string; identity: Identity }
	| { type: "agent.model"; id: string; model?: AgentModel }
	| { type: "agent.usage"; id: string; usage: AgentUsage }
	| { type: "models"; models: ModelOption[] }
	| { type: "timeline.preview"; agentId: string; entryId: string | null; boards: Record<string, string> }
	| { type: "chat.history"; agentId: string; items: ChatItem[] }
	| { type: "chat.item"; agentId: string; item: ChatItem }
	| { type: "chat.delta"; agentId: string; itemId: string; delta: string; field?: "text" | "thinking" }
	/**
	 * What the focused agent is holding, and what of it is on the canvas.
	 *
	 * Two sets, because they answer different questions: `boards` is the context — what
	 * the agent is working from, which the rail lists — and `inPlay` is the subset it has
	 * put on the canvas for the user to look at now.
	 */
	| { type: "context.changed"; agentId: string; boards: string[]; inPlay: string[] }
	| { type: "stage.call"; call: StageCall }
	| { type: "extension.ui.prompt"; prompt: ExtensionUiPrompt }
	| { type: "extension.ui.prompt.closed"; id: string }
	| { type: "notice"; level: "info" | "warn" | "error"; text: string }
	| { type: "error"; text: string };

/** Where the API lives, so the browser does not hard-code it in three places. */
export const API_PREFIX = "/api";
