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

/**
 * One thing typing `/` in the composer completes to.
 *
 * Named the way the runtime types it — capital ``L`` in "login", no leading slash —
 * and described by the backend that serves it, so the menu and the machine never
 * drift apart. `arg` is an example of what a command takes after its own name,
 * shown as a placeholder when the command is inserted.
 */
export interface SlashCommand {
	/** E.g. "login" — typed and sent as "/login". */
	name: string;
	/** One line on what it does, for the menu. */
	hint?: string;
	/** An example argument, e.g. "[notes]" for "/compact [notes]". */
	arg?: string;
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
	/** What `/` completes to in the composer, supplied by the backend. */
	commands: SlashCommand[];
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

/**
 * One Claude subscription this install can use.
 *
 * Several can be signed in at once, one is active, and reaching a rate limit moves the
 * active one along (`claude/accounts.ts`). No credentials cross this wire — an account is a
 * handle, an identity read back out of the CLI, and whether it is currently spent.
 */
export interface ClaudeAccount {
	id: string;
	email?: string;
	orgName?: string;
	/** `Claude Pro`, `Claude Max`, … as the CLI words it. */
	plan?: string;
	/** The CLI's own `~/.claude` login, which Decks can use but must not delete. */
	isDefault?: true;
	/** Signed in and usable. False for a row the CLI reports as signed out. */
	signedIn: boolean;
	/** Epoch ms when its limit is expected to lift, if it is known to be spent. */
	limitedUntil?: number;
	/** Which window ran out — `five_hour`, `seven_day`, … */
	limitType?: string;
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
	 * Retype a run of text, addressed by where it *is* rather than by a name.
	 *
	 * `id` is the component and `path` is the element-child indices walked into from it —
	 * `[]` is the component itself, `[0]` its first element child. One address, not two:
	 * the path is meaningless without the component, so the pair cannot disagree with
	 * itself the way an id plus an independent name could.
	 *
	 * `before` is the text the browser was showing, and it is what makes a *derived*
	 * address safe to use. A path is only correct against the file the DOM was built from,
	 * and the two can come apart: the agent rewrites a board while a frame is pinned to the
	 * revision it loaded (§7), and the same indices then point at an element the user never
	 * saw. The server compares and refuses.
	 *
	 * It is the third guard, not the first — which is why it almost never fires. A patch
	 * carries the revision it was composed against and a stale one is refused outright, and
	 * a board the agent rewrote reloads the frame, which abandons the edit in progress. What
	 * is left is the window between those two: a rev this client legitimately holds, against
	 * a DOM that has not caught up yet. Nothing but the content check can see that, and what
	 * it prevents is the only genuinely unacceptable outcome here — the user's words written
	 * silently into a component they were not looking at.
	 *
	 * **It replaces `data-edit`**, a name the author wrote on every editable run, which
	 * was the address for a while and is gone. A name is a fine address and a poor
	 * *gate*: nothing was editable unless an agent had thought to name it, so a board
	 * written without the convention had no retypeable text at all and the app could only
	 * say "ask the agent for a data-edit on it". It also had to be unique per board, which
	 * `duplicate` paid for by minting fresh names for every run inside a copy.
	 *
	 * The reason the name won the first time no longer holds. A path was rejected because
	 * it addressed nothing inside a `[data-md]` panel, whose DOM `board.js` draws and the
	 * file does not contain — and rendered panels are now edited as their whole *source*,
	 * addressed as one component. So a path is only ever resolved where the file's tree
	 * really is the DOM's, which is the condition it always needed.
	 */
	| { op: "text"; id: string; path: number[]; before: string; text: string }
	/**
	 * Retype a run of words that has marks in it, addressed the same way.
	 *
	 * The same address as `text` and a different payload: `html` is the element's new
	 * *inner HTML*, because a run like `See <a href="…">the doc</a>, then <b>ship it</b>` has
	 * no plain-text form. `text` would flatten it and throw the link and the bold away,
	 * which is why an element with markup in it used to be refused outright.
	 *
	 * So the browser makes the element `contenteditable` and the user treats the marks like
	 * text: select across a `<b>`, delete it, type through it. What comes back is whatever
	 * the engine produced, and `boards/inline-html.ts` decides what a board file may hold —
	 * a phrasing-content allowlist, attributes filtered, split marks merged, empty ones
	 * dropped, non-breaking spaces returned to spaces, everything else unwrapped to its
	 * words. That runs on the *server*: the rule about what a file may contain belongs with
	 * the file, so there is one implementation of it and a client that is buggy or is not
	 * this app cannot write markup a board should not hold.
	 *
	 * `before` is the element's text as the browser had it, not its HTML — the same race
	 * guard as `text` uses, and compared as text on both sides because two serialisations of
	 * one document differ in ways that mean nothing (`<br>` against `<br />`) and agree
	 * about words.
	 */
	| { op: "html"; id: string; path: number[]; before: string; html: string }
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
 * The tags a run of words may be made of, shared because both sides ask about them.
 *
 * HTML's phrasing content, minus everything interactive, embedded, or capable of running
 * something. Two questions are answered from this one list, and they have to agree:
 *
 * - **The browser** decides what to make `contenteditable`, and draws the underline that
 *   says so, from "does this element contain anything that is not on this list".
 * - **The server** decides what a `html` patch may write into a board file, from the same
 *   question asked of the parse tree, and unwraps anything else to its words
 *   (`boards/inline-html.ts`).
 *
 * A tag on one list and not the other would be an affordance that promises a refusal, or a
 * refusal for something the app just offered — which is exactly the failure the old
 * `data-edit` underline was designed around. So there is one list, here, next to the other
 * piece of board vocabulary both sides share.
 */
export const INLINE_TAGS = [
	"a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd",
	"mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
] as const;

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
	| { id: string; method: "custom"; lines: WidgetLine[] }
	/**
	 * A question with reasons attached, which `select` cannot carry.
	 *
	 * Claude Code's `AskUserQuestion` is the caller: two to four options, each with a
	 * sentence saying what choosing it would mean, and that sentence is the part worth
	 * reading — "Hybrid" and "All utilities" are indistinguishable without it. `select`
	 * has bare strings and no room to put one.
	 *
	 * The answer is `{ value }` in both shapes: for `multiple`, the picked labels joined
	 * with ", ", which is the format the tool's own output specifies for a multi-select.
	 * `other` adds a free-text escape, because a question with four answers and no way to
	 * say "none of those" is a question that traps you.
	 */
	| {
			id: string;
			method: "choose";
			title: string;
			message?: string;
			options: { label: string; description?: string }[];
			multiple?: boolean;
			other?: boolean;
	  }
	/**
	 * Sign-in: a URL to open, and the code the browser hands back.
	 *
	 * Claude Code's OAuth flow is a paste-the-code flow — it prints a URL and then waits
	 * on stdin — so a login dialog that only said "done" could never finish one. The
	 * answer is the code (`{ value }`); `{ confirmed: true }` is the app closing the
	 * dialog itself because the credentials landed without one.
	 */
	| { id: string; method: "login"; title: string; message: string; url: string; placeholder?: string }
	/** Informational figures, dismissed with OK. */
	| { id: string; method: "usage"; title: string; rows: { label: string; value: string }[] };

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
	/**
	 * A new, empty board, put on the canvas.
	 *
	 * The server has been able to write one from a template since agents needed it; this is
	 * the same call reached from a button, because "I want somewhere to put this" is a thing
	 * a person has as often as an agent does, and asking for it in words was the only way.
	 *
	 * No title. A board named by a dialog before it has anything on it is a naming decision
	 * taken at the worst possible moment — it arrives as `Untitled`, and its heading is a
	 * field you can retype like any other.
	 *
	 * `kind` is a template name and the server owns the list (`boards/templates.ts` validates
	 * it); it is a bare `string` here because the protocol package cannot depend on the
	 * server, and an unknown one falls back to `blank` rather than failing — the worst
	 * outcome of a typo should be an empty board.
	 */
	| { type: "board.create"; kind?: string }
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
	/** Ask the focused agent's runtime for its usage, in a modal. */
	| { type: "agent.usage"; id: string }
	| { type: "stage.result"; result: StageResult }
	| { type: "extension.ui.answer"; answer: ExtensionUiAnswer }
	/** Read the account list — the settings panel asking on open. */
	| { type: "claude.accounts" }
	/** Sign in to another Claude account, which adds it to the list. */
	| { type: "claude.accounts.add" }
	/** Use this one from now on, chosen by hand. */
	| { type: "claude.accounts.use"; id: string }
	/** Forget one, and its credentials. Refused for the CLI's own login. */
	| { type: "claude.accounts.forget"; id: string }
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
	| { type: "models"; agentId: string; models: ModelOption[] }
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
	/**
	 * Words for the input bar, put there by the deck rather than typed.
	 *
	 * One sender: a rewind. The usual reason to rewind is to say the thing differently, so
	 * the message that was rewound comes back in the composer to be edited — which is where
	 * it was always meant to go (the server has passed `editorText` back since rewinding
	 * existed) and where it never went, so it was announced in a notice instead and the
	 * whole message sat in a toast.
	 */
	| { type: "composer.draft"; text: string }
	/** The install's Claude subscriptions, and which one is in force. */
	| { type: "claude.accounts"; accounts: ClaudeAccount[]; active: string }
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
