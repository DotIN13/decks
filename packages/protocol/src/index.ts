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
	/**
	 * What this board is, as a file — `component`, `flow` or `slides` (`deck/kinds.ts`).
	 *
	 * On the wire because the browser needs it before the frame has loaded: which editor a
	 * board admits, whether its height is measured or fixed, and whether ← → mean anything
	 * are all decided from this, and asking the frame would mean deciding them a beat late.
	 */
	format: "component" | "flow" | "slides";
	/**
	 * How the frame has to be *given* this board, when the file is not a document already.
	 *
	 * Absent for a component board and for a flow board: both are complete documents this
	 * app wrote. Present for a file that has to be rendered *into* one — `content`, which is
	 * a `.md` or a deck in either dialect — and for `foreign`, an HTML page from somewhere
	 * else, which gets a document too and is put in a sandboxed frame inside it because it
	 * may carry scripts.
	 *
	 * On the wire because the browser sizes on it: a sandboxed page cannot be measured from
	 * outside, so that one board keeps a stored height where every other flow board reports
	 * its own.
	 */
	shell?: "content" | "foreign";
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
	/**
	 * How much room the board's components actually take, as the canvas last measured it.
	 *
	 * Present only when a browser has looked at *this* revision, because a measurement of
	 * an older document is worse than none: it is a number, and a number gets believed.
	 * The pair with it is `clipped` — content past the edge of the board, which renders
	 * without complaint and is invisible until somebody notices the missing paragraph.
	 */
	content?: { w: number; h: number };
	/** Content reaching past `w`/`h`. Derived from `content`, and absent when that is. */
	clipped?: boolean;
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
 *
 * Four now. Pi runs in this process; the other three are somebody else's program, reached
 * through that program's own SDK — Claude Code's, opencode's HTTP server, and
 * antigravity's Python one. What differs between them is `capabilities`, not a method that
 * throws.
 */
export type AgentKind = "pi" | "claude" | "opencode" | "antigravity";

/**
 * The same four, as a value.
 *
 * A union type cannot be iterated, and both sides need to: the server maps each kind to a
 * backend class, the browser draws a row per kind in the new-agent menu. Written once here
 * so a fifth runtime is one edit rather than three that drift.
 */
export const AGENT_KINDS: readonly AgentKind[] = ["claude", "pi", "opencode", "antigravity"];

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
	/**
	 * Who answers it, for the badge at the end of the row.
	 *
	 * `deck` is one Decks interprets itself and the runtime never sees — `/login` drives
	 * the CLI's `auth login` through the dock's dialogs, `/cost` opens the usage panel.
	 * Everything else is handed to the runtime as a prompt and answered there: `runtime`
	 * is its own built-in, `skill` a skill it found, `prompt` a saved prompt, `extension`
	 * an extension's. Absent means unlabelled rather than unknown.
	 */
	source?: "deck" | "runtime" | "skill" | "prompt" | "extension";
	/**
	 * Other names that reach the same command, so the menu finds it by either.
	 *
	 * Claude declares these (`/cost` and `/stats` both resolve to `/usage`); they are
	 * searched but not listed, because a menu that draws every alias as its own row is
	 * three rows for one command.
	 */
	aliases?: string[];
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
	/**
	 * What the agent says it is doing, in its own words: `["panel-css", "measuring"]`.
	 *
	 * Set through `stage.me.setTags`, which **replaces** the list rather than adding to it —
	 * an `addTag` is never un-called, so every agent would accumulate its whole history and
	 * the list would stop meaning "what it is up to". Slugged, deduped and capped by
	 * `cleanTags` on the way in, so a row can draw them without measuring anything.
	 *
	 * Here rather than on `AgentChat` because a tag is the same kind of fact as a name: the
	 * agent chose it about itself, and `agent.identity` is already broadcast on change and
	 * replayed on connect. A tag is not something the *runtime* knows.
	 */
	tags?: string[];
	/**
	 * Tags **you** put on an agent, which the agent cannot see or overwrite.
	 *
	 * A separate field, not a shared list, and that is the whole point: `setTags` replaces,
	 * so one list would mean the agent's next call silently deleted yours. Drawn differently
	 * from the agent's own — see `.tag[data-mine]` in `styles/panel.css`.
	 */
	userTags?: string[];
}

/**
 * One Claude subscription this install can use.
 *
 * Several can be signed in at once and **each conversation spends one of them, by hand**
 * (`claude/accounts.ts`). No credentials cross this wire — an account is a handle and an
 * identity read back out of the CLI.
 *
 * There is deliberately no "spent until" on this row. Decks used to remember a refusal and
 * move the conversation on by itself, and a remembered limit is a claim about a
 * subscription that only the last refusal knows and that nothing ever re-checks. What a
 * limit produces now is a sentence in the conversation that ran out, naming the window and
 * when it lifts; moving to another subscription is a press in the model picker.
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
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The thinking scale, lowest effort first.
 *
 * The order is the whole reason this array exists rather than a `Set`: "nearest" is only
 * a question you can answer about a *scale*, and the union type has no order of its own.
 * Kept in step with `ThinkingLevel` — the `satisfies` below is what makes a level added
 * here and forgotten in the array a type error rather than a chip that quietly never
 * appears. In the protocol rather than in either app because `nearestLevel` is a question
 * both sides ask: the model picker picks a level for a model, and a runtime maps a picked
 * level onto the levels that model actually offers.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];

/** Where the app lands when nothing has been chosen, and what an unknown level is read as. */
export const DEFAULT_THINKING: ThinkingLevel = "medium";

/**
 * Keep the user's intent when moving to something that does not offer the current level:
 * take the nearest one it does, rather than silently resetting.
 *
 * The alternative — the one this replaces — is to send no level at all and let the
 * runtime fall back to its default, which turns "I want this model to think hard" into
 * "I want this model", silently, at the moment you were thinking about the model and not
 * about the level. Somebody who has asked for `max` and moves to something that stops at
 * `high` means `high`; nobody means `medium` by it.
 *
 * Ties go to whichever level `supported` lists first, which is why `supported` should be
 * in scale order too: between two equally distant neighbours the lower-effort one is the
 * cheaper mistake.
 */
export function nearestLevel(wanted: ThinkingLevel | undefined, supported: readonly ThinkingLevel[]): ThinkingLevel | undefined {
	// Something with no scale has no answer to give, and `undefined` is how the caller
	// says "send no level" rather than "send off" — those are different requests.
	if (supported.length === 0) return undefined;
	if (wanted && supported.includes(wanted)) return wanted;

	const asked = wanted ? THINKING_LEVELS.indexOf(wanted) : -1;
	const from = asked === -1 ? THINKING_LEVELS.indexOf(DEFAULT_THINKING) : asked;
	const distance = (level: ThinkingLevel) => Math.abs(THINKING_LEVELS.indexOf(level) - from);
	return supported.reduce((best, level) => (distance(level) < distance(best) ? level : best));
}

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

/**
 * Everything the usage panel draws: the plan, the spend, and what has been driving it.
 *
 * `AgentUsage` above is the *glance* — three numbers, cheap, emitted after every turn and
 * drawn as a ring. This is the thing you open, and it is a different question in three
 * parts: how close is this account to a limit, what has this conversation cost, and what
 * kind of work has been spending it.
 *
 * Read on demand and never cached across openings: two of the three parts are running
 * totals and the third is a countdown, so figures from an hour ago labelled as usage are
 * worse than no figures.
 *
 * **A narrowing, deliberately.** The Claude CLI answers a control request whose payload is
 * already wider than its own typings — codenamed buckets that are all null, an undocumented
 * `limits[]` — so the server reads whatever is there and publishes these fields. A bucket
 * appearing or being renamed upstream changes one mapping function rather than the panel.
 */
export interface UsageReport {
	/** Which runtime answered, because what it can answer depends on that. */
	kind: AgentKind;
	/** `pro`, `max`, `team` — or null on an API key, a 3P provider, or a runtime without plans. */
	subscription: string | null;
	/**
	 * The account these limits belong to.
	 *
	 * An install can have several Claude subscriptions signed in at once
	 * (`claude/accounts.ts`), so "42% of the 5-hour window" is a reading with no subject
	 * until this says whose. Null when the install has no account store — the CLI's own
	 * login, or a pi agent.
	 */
	account: string | null;
	/**
	 * The windows, fullest first, or empty when the account has none to report.
	 *
	 * Empty and `null` are different answers and the panel says so: a runtime or an account
	 * with no plan windows has nothing to be near the end of, which is not a request that
	 * failed.
	 */
	limits: PlanLimit[] | null;
	/** What this conversation has run up. */
	session: SessionSpend;
	/**
	 * What has been driving the usage, as the CLI's own scan reports it.
	 *
	 * Approximate by construction — it is this machine's transcripts, so it misses other
	 * devices and claude.ai entirely — and null when the runtime does not collect it.
	 */
	behaviors: { day: UsageWindow; week: UsageWindow } | null;
}

export interface PlanLimit {
	/** Stable enough to key a list on: `five_hour`, `weekly:opus`. */
	key: string;
	label: string;
	/** 0–100, or null when the window is known but its share is not. */
	percent: number | null;
	/** ISO 8601. Null for a window with no scheduled reset. */
	resetsAt: string | null;
}

/** Tokens, the four ways they are counted and priced. */
export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * What one conversation has spent.
 *
 * The totals are always there; the breakdown and the four wall-clock figures are not. A
 * runtime that only keeps a running total sends `models: []` and nulls rather than zeros —
 * "this runtime does not count it" and "it counted zero" are different claims, and a panel
 * that draws them the same way is inventing the first one.
 */
export interface SessionSpend {
	costUsd: number;
	tokens: TokenCounts;
	/** Per model, dearest first. Empty when the runtime keeps only totals. */
	models: ModelSpend[];
	/** Wall clock and API time in milliseconds, or null when the runtime does not count them. */
	durationMs: number | null;
	apiDurationMs: number | null;
	linesAdded: number | null;
	linesRemoved: number | null;
}

export interface ModelSpend {
	model: string;
	tokens: TokenCounts;
	costUsd: number;
}

/** One time window of the runtime's own usage scan. */
export interface UsageWindow {
	requests: number;
	sessions: number;
	/** Overlapping characteristics, so these do not sum to 100. */
	behaviors: { key: string; percent: number; count: number }[];
	agents: UsageShare[];
	skills: UsageShare[];
	plugins: UsageShare[];
	mcpServers: UsageShare[];
}

export interface UsageShare {
	name: string;
	percent: number;
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
	 * Replace a **flow or slides** board's whole file.
	 *
	 * The other ops here address components inside a document, because that is what a
	 * component board is. A markdown file has no components: it is one run of text, and the
	 * editable unit is the file. So this op carries the file.
	 *
	 * Exact by construction, which is the point — there is no serialiser to reorder bytes
	 * nobody touched. That matters more here than anywhere else in this list, because these
	 * files are read back by agents: a board that rewrites itself on every human edit is a
	 * board the agent stops recognising. Refused for a component board, where the
	 * byte-range splicing above is the whole design.
	 */
	| { op: "source"; text: string }
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
	/**
	 * How big the canvas is, in CSS pixels, when the browser is the one reporting.
	 *
	 * Not world units and not divided by the zoom: it is the room a board has on screen,
	 * which is what an agent choosing a board size actually needs. It is the window *minus
	 * the chrome standing beside it* (`web/lib/insets.ts`) rather than `innerWidth`, because
	 * a panel that covers a third of the window is not room a board can use.
	 *
	 * Optional because most cameras are computed — `fitInto`, `zoomAbout` and every rewind
	 * make one — and only a reading taken from a live browser can know this. An agent that
	 * has never had one reported is told nothing rather than told a default.
	 */
	width?: number;
	height?: number;
}

/**
 * The server asking the browser to do something to the stage, and awaiting it.
 *
 * Reads that the server can answer itself never become one of these; this is only
 * for what only the browser knows or only the browser can do.
 */
export interface StageCall {
	id: string;
	/**
	 * Which agent asked.
	 *
	 * The canvas is *per conversation* — it draws the focused agent's in-play set and
	 * nothing else — so the browser has to know whose `show` it is carrying out. Without
	 * this it could not tell, and an agent you were not watching flew your camera to a board
	 * that is not on your canvas at all.
	 */
	agentId: string;
	/** `annotate` is the newest: bubbles with arrows, drawn on the canvas and never written
	 *  to a board file. See `canvas/annotations.ts`. */
	op: "show" | "camera" | "move" | "highlight" | "reload" | "cursor" | "annotate" | "toast" | "read";
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
	| { id: string; method: "login"; title: string; message: string; url: string; placeholder?: string };
/*
 * There was a `usage` method here: a title and a list of pre-formatted `label: value`
 * strings, which both backends filled in and the dock drew as a card above the input bar.
 * It is gone, and what replaced it is `UsageReport` — structured, read on demand, and drawn
 * by a panel that can put a meter next to a window and a countdown under it. A runtime
 * formatting its own numbers into strings is a runtime deciding how they are drawn, which
 * is how "42% (148000 / 200000 tokens)" ended up being the whole of what the app knew.
 */

export type ExtensionUiAnswer =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

// --- your own Chrome, shared with the deck ---------------------------------------

/**
 * What the deck knows about the browser the user shared with it (`server/web/bridge.ts`).
 *
 * The extension in the user's Chrome dials the server and attaches to one tab; this is the
 * state of that connection, broadcast whenever it changes and drawn by the `data-live="web"`
 * board (`lib/live-web.js`). Nothing in it is a picture: the tab is on the user's own screen,
 * so the board is a status card — which tab, whether it is connected, what the agent did.
 */
export interface WebStatus {
	/** A pairing code exists, so the extension can be told where to connect. */
	paired: boolean;
	/** An extension is connected and at least one tab is attached. */
	connected: boolean;
	/** The tab the agent drives — the first attached one. */
	tab?: { title: string; url: string };
	/** Every attached tab, for a card that lists them. */
	tabs: Array<{ title: string; url: string }>;
	/** The last few things the agent did, newest last. */
	actions: WebAction[];
	/** A submit the agent is waiting for the user to allow. */
	pending?: { id: string; text: string };
	/** Why the last connection ended, if it did. */
	closed?: string;
}

export interface WebAction {
	at: number;
	text: string;
	ok: boolean;
}

// --- the wire ------------------------------------------------------------------

export type ClientMessage =
	| { type: "deck.open"; path: string }
	| { type: "board.move"; path: string; x: number; y: number }
	| { type: "board.patch"; path: string; rev: number; patches: BoardPatch[] }
	/**
	 * How much room this board's content takes, measured in the frame that is showing it.
	 *
	 * The browser is the only thing that can answer this — it is the only place the board
	 * is laid out — so the reading travels the other way from most of this file. It
	 * carries the `rev` it was taken at, because a measurement of a document that has
	 * since been rewritten is not a measurement of anything.
	 */
	| { type: "board.extent"; path: string; rev: number; w: number; h: number }
	| { type: "board.undo"; path: string }
	/** Put a board on the canvas / take it off again. The context is untouched either way. */
	/**
	 * Put a live view of one agent's conversation on the canvas.
	 *
	 * The board it makes never changes as the conversation grows — its turns arrive in the
	 * browser, from a transcript this app already holds (`canvas/live-chat.ts`). Asking
	 * twice for the same agent lands on the board that already exists.
	 */
	| { type: "agent.mirror"; agentId: string }
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
	 *
	 * `format` is what the board *is as a file* — `component`, `flow` or `slides` — and it
	 * is a different question from `kind`, which is the shape it starts with. An `answer`
	 * can be written as component HTML or as markdown, so one field could not mean both.
	 *
	 * **The extension is not on the wire, deliberately.** The server derives it from the
	 * format (`.html`, `.md`, `.slides.html`), because a board's format is read back out of
	 * its filename — so a caller that could name the file could ask for a slide deck and be
	 * handed a flow board, correctly, with nothing to say why. Absent means `component`,
	 * which is what every board was before formats existed.
	 */
	| { type: "board.create"; kind?: string; format?: string }
	/**
	 * Delete a board's file from the deck.
	 *
	 * The one message in this protocol that destroys something a person wrote, so it is worth
	 * being exact about what it is not. It is **not** `board.hide`, which takes a board off
	 * the canvas and leaves the agent holding it; and it is not the opposite of
	 * `board.create`, which is only ever "a new file appeared". This unlinks the HTML.
	 *
	 * What survives is the content-addressed copy in `.decks/revisions` — every version the
	 * server has seen of that path, including the last one, is still on disk under its sha.
	 * That is a recovery of last resort rather than an undo: nothing in the app puts a
	 * deleted board back, and the arrangement in `deck.json` goes with it.
	 */
	| { type: "board.delete"; path: string }
	| { type: "board.comment"; path: string; id: string; text: string }
	/**
	 * Where the browser is looking, and which conversation's view that is.
	 *
	 * The camera belongs to the conversation, so the server keeps one reading per agent and
	 * `stage.camera()` answers "where is my canvas looking" rather than "where is the user
	 * looking" — which is what it always claimed to mean.
	 */
	| { type: "camera.set"; camera: Camera; agentId?: string }
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
	/**
	 * Your own tags on an agent, from the customise popup. Replaces the list.
	 *
	 * Separate from `stage.me.setTags`, which is the agent's, and stored in a separate field —
	 * the two never write to each other.
	 */
	| { type: "agent.tags"; id: string; tags: string[] }
	| { type: "agent.prompt"; id: string; text: string }
	| { type: "agent.abort"; id: string }
	| { type: "agent.setModel"; id: string; provider: string; model: string; thinking?: ThinkingLevel }
	| { type: "agent.thinking"; id: string; thinking: ThinkingLevel }
	| { type: "agent.setMode"; id: string; mode: AgentMode }
	/**
	 * Read this agent's full usage report — the panel, not the ring.
	 *
	 * A request rather than a subscription: it costs a control round trip to the runtime,
	 * and the only moment it is worth one is when somebody has the panel open.
	 */
	| { type: "agent.report"; id: string }
	/**
	 * Reach back past the rows the browser was given (DESIGN §6.2).
	 *
	 * `before` is the oldest row it holds; the answer is the `limit` rows before that one,
	 * in reading order. It is a *cursor* rather than a page number because the transcript
	 * grows at the other end while a reader is scrolling back through it, and an index into
	 * it would name a different row every turn.
	 */
	| { type: "chat.earlier"; agentId: string; before: string; limit?: number }
	| { type: "stage.result"; result: StageResult }
	| { type: "extension.ui.answer"; answer: ExtensionUiAnswer }
	/** Read the account list — the settings panel asking on open. */
	| { type: "claude.accounts" }
	/** Sign in to another Claude account, which adds it to the list. */
	| { type: "claude.accounts.add" }
	/** Use this one from now on, chosen by hand. */
	/**
	 * Spend this subscription: for one agent when `agentId` is given, and otherwise as the
	 * default a new agent starts on. Never both — moving every unassigned agent is the
	 * surprise the per-agent choice exists to remove.
	 */
	/**
	 * Put **one conversation** on a subscription. There is no machine-wide switch.
	 *
	 * `agentId` is required, and that is the whole design in one field. It used to be
	 * optional — omitting it moved the install default — and a settings panel that changed
	 * what the *next* agent would spend, while every open conversation carried on as before,
	 * was a control that appeared to do something and did not. Switching is now where the
	 * model and the thinking level are: in the picker, for the conversation in front of you.
	 */
	| { type: "claude.accounts.use"; id: string; agentId: string }
	/** Forget one, and its credentials. Refused for the CLI's own login. */
	| { type: "claude.accounts.forget"; id: string }
	| { type: "rewind.preview"; id: string; entryId: string | null }
	| { type: "rewind.to"; id: string; entryId: string }
	| { type: "fork.from"; id: string; entryId: string }
	/** Write the boards back to how they were at that point. Deliberate, never implied. */
	| { type: "boards.restore"; id: string; entryId: string }
	/** The user's answer to a submit the agent asked leave for (`WebStatus.pending`). */
	| { type: "web.answer"; id: string; ok: boolean }
	/** Detach from the shared tab — the Stop button on the status board. */
	| { type: "web.stop" }
	/** Make (or find) the status board and put it on the canvas. */
	| { type: "web.board" }
	/** A fresh pairing code; the extension has to be paired again. Answered with `web.status`. */
	| { type: "web.repair" };

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
	/**
	 * The answer to `agent.report`, or why there is not one.
	 *
	 * `error` rather than a silent absence: the panel has a refresh button, and a button
	 * that does nothing and says nothing is worse than one that reports a failure.
	 *
	 * `show` is the agent's side of the same panel — `/cost`, which nobody typed into a
	 * browser — so the reading arrives with the instruction to open it. Requests the
	 * browser made carry no flag: it already has the panel open.
	 */
	| { type: "agent.report"; id: string; report?: UsageReport; error?: string; show?: true }
	| { type: "models"; agentId: string; models: ModelOption[] }
	| { type: "timeline.preview"; agentId: string; entryId: string | null; boards: Record<string, string> }
	/**
	 * The conversation as the browser should open it: the tail, and whether there is more.
	 *
	 * `more` is what stops a chat offering to fetch messages it has never had. A session
	 * keeps the last few hundred rows in memory and archives what falls out of that window
	 * (`agents/store.ts`), so "is there anything before the oldest row you are being given"
	 * is a question only the server can answer — and it is asked once, here, rather than by
	 * a request that comes back empty.
	 */
	| { type: "chat.history"; agentId: string; items: ChatItem[]; more?: boolean }
	/**
	 * A page of older conversation, in reading order, answering `chat.earlier`.
	 *
	 * `before` is the row the page was asked for, echoed back: two pages can be in flight
	 * when a reader keeps scrolling, and a browser that cannot tell them apart prepends the
	 * same page twice. `more` says whether anything remains before this page.
	 */
	| { type: "chat.earlier"; agentId: string; before: string; items: ChatItem[]; more: boolean }
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
	/**
	 * A question an agent is waiting on, and **which agent is waiting**.
	 *
	 * `agentId` was missing, and its absence was not harmless: the dialog is drawn over the
	 * input bar whichever conversation you are in, so a background agent's question arrived
	 * on top of somebody else's transcript with nothing able to say whose it was — the frame
	 * did not carry it. The `ask` notification had to attribute the question to whoever
	 * happened to be focused, which is right most of the time and silently wrong the rest.
	 *
	 * With the id, the question belongs to a conversation: it is drawn when you are in that
	 * conversation and the agent list says "Wants you" when you are not.
	 */
	| { type: "extension.ui.prompt"; agentId: string; prompt: ExtensionUiPrompt }
	| { type: "extension.ui.prompt.closed"; agentId: string; id: string }
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
	/**
	 * The install's Claude subscriptions, which one a new agent starts on, and who is on what.
	 *
	 * `active` is the **default for a new agent**, not the account every agent uses: each one
	 * records its own (`AgentRecord.account`). `spending` is that mapping, agent id to account
	 * id, because with three agents on three subscriptions one "active" row no longer answers
	 * the question the panel exists to answer.
	 */
	| { type: "claude.accounts"; accounts: ClaudeAccount[]; active: string; spending?: Record<string, string> }
	/** One agent moved to a different subscription — by hand, or because a limit moved it. */
	| { type: "agent.account"; id: string; account: string }
	/** The shared browser's state, on connect and whenever it changes (`WebStatus`). */
	| { type: "web.status"; status: WebStatus; code?: string }
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
