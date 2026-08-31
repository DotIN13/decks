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
	/**
	 * Restored from a previous run and not yet resumed.
	 *
	 * The conversation is readable and the boards it held are known, but no runtime is
	 * running behind it — the first prompt starts one. Drawn differently because the
	 * distinction is real: a dormant chat cannot be aborted, has no model to report and
	 * will take a moment longer to answer.
	 */
	dormant?: true;
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

export type ComponentKind = "sticky" | "card" | "text" | "image" | "embed";

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
	/** `attrs` carries whatever else the new component needs named — a dropped PDF's `data-pages`. */
	| { op: "insert"; kind: ComponentKind; id: string; at: Rect; text?: string; embed?: string; attrs?: Record<string, string> }
	/** `null` in `attrs` *removes* the attribute, which is how a tone goes back to the default. */
	| { op: "update"; id: string; style?: Partial<Rect>; class?: string; attrs?: Record<string, string | null> }
	/**
	 * Retype an editable run, addressed by the `data-edit` its author wrote on it.
	 *
	 * There is no component id here on purpose. A `data-edit` is unique within a board,
	 * so naming the component as well would be a second address that can disagree with
	 * the first — and the server has to resolve the element anyway to say which
	 * component the edit landed in, which is what the summary and `ids` report.
	 *
	 * It replaces an index `path` into the component's element children, which existed
	 * only because nothing in a board named its editable runs. Indices were computed
	 * from the DOM and resolved against the file, so they addressed one thing in a
	 * hand-written component and nothing at all in a rendered one — a `[data-md]`
	 * panel's headings exist only in what `board.js` drew. An authored id is the same
	 * name on both sides of the wire, and a board that does not carry one simply has no
	 * retypeable text: there is no fallback, because a fallback would be the index path
	 * again with its refusals moved later.
	 *
	 * The run may be the whole of a `[data-md]` or `[data-mermaid]` component, which is
	 * how markdown became editable: its editable unit is its source, in one editor,
	 * rather than a rendered block that is not in the file at all.
	 */
	| { op: "text"; edit: string; text: string }
	| { op: "remove"; id: string }
	/**
	 * A copy of a component, offset, with a name derived from the original's.
	 *
	 * Its own op rather than an `insert` composed by the browser, because a card is a
	 * heading and a paragraph and a list: the only copy that keeps that is a copy of
	 * the source bytes, and only the server has those. The one op here that is not
	 * idempotent — applying it twice means two copies, which is what it says.
	 */
	| { op: "duplicate"; id: string; offset?: { x: number; y: number } }
	/**
	 * Rename a component.
	 *
	 * Its own op rather than `attrs: { "data-id": … }`, because a name is not an
	 * attribute like the others: it has to be a name a board can use, it has to be one
	 * nothing else has, and the op has to answer with it. An id is how an agent refers
	 * to a component, so the new name is in the summary it is told and in the ids the
	 * patch reports (§6.5) — an agent holding the old one hears that it changed.
	 */
	| { op: "rename"; id: string; to: string }
	| { op: "order"; id: string; to: "front" | "back" };

/**
 * The five component classes that mean the same thing — a box with prose in it —
 * and so can be swapped for one another by the inspector (§6.5).
 *
 * This list is `board.css`'s, not this build's — the editor can only offer what the
 * stylesheet already styles. That used to be a harder constraint than it is: `lib/` is
 * copied into a deck, and the copy was once made at `Deck.create` and never touched
 * again, so a class invented here was an unstyled box in every deck that already
 * existed. Opening a deck now brings its `lib/` up to this build (`deck/lib-sync.ts`),
 * so adding to this list means adding to `board.css` in the same commit and no longer
 * means waiting a release. What has not changed: the list and the stylesheet are one
 * decision, and a class in one and not the other is a control that does nothing.
 * `kpi`, `table` and `chip`
 * are deliberately absent — their CSS styles children the other five do not have,
 * so swapping one in produces a component whose content no longer fits it.
 */
export const BOX_CLASSES = ["text", "sticky", "card", "callout"] as const;
export type BoxClass = (typeof BOX_CLASSES)[number];

/**
 * `data-tone` as `board.css` reads it, and a callout is the only component that reads
 * it — absent means the accent. Same reasoning as `BOX_CLASSES`: this is the
 * stylesheet's list, and it stops where the stylesheet stops.
 */
export const CALLOUT_TONES = ["warn", "danger", "ok"] as const;

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
	/**
	 * Take an agent off the list.
	 *
	 * The row goes; the conversation does not. Its transcript is a session file on disk
	 * (`~/.pi/agent/sessions/…` or Claude's own store), so this closes a chat rather than
	 * destroying its history.
	 */
	| { type: "agent.remove"; id: string }
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
	/** An agent is off the list; anything the browser kept for it can go. */
	| { type: "agent.removed"; id: string }
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

// --- files dropped in from outside ---------------------------------------------

/**
 * The most bytes one dropped file may be, known to both sides.
 *
 * The browser needs it to refuse a 400MB video before spending a minute sending
 * it; the server needs it because a limit only the client enforces is not a
 * limit. 32MB is a photograph or a long PDF and not a video, which is the kind
 * of thing a board is for.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Where a dropped file landed, as `POST /api/upload` answers.
 *
 * `path` is deck-relative — the same currency `stage.newBoard` and the file
 * picker deal in — so the caller turns it into a board-relative `data-embed`
 * itself rather than the server guessing which board asked.
 */
export interface UploadedAsset {
	path: string;
	name: string;
	bytes: number;
	/** True when an identical file was already there and this one was not written. */
	reused: boolean;
}
