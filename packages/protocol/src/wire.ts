/** The frames. Everything that changes state is one of these, and nothing else crosses. */

import type { BoardPatch } from "./boards.ts";
import type {
	AgentChat,
	AgentKind,
	AgentMode,
	AgentModel,
	AgentState,
	ClaudeAccount,
	Identity,
	ModelOption,
	RuntimeInfo,
	ThinkingLevel,
} from "./chat.ts";
import type { Board, DeckState } from "./deck.ts";
import type { ExtensionUiAnswer, ExtensionUiPrompt } from "./extension-ui.ts";
import type { StageCall, StageResult, Camera } from "./stage.ts";
import type { ChatItem } from "./transcript.ts";
import type { AgentUsage, UsageReport } from "./usage.ts";
import type { WebStatus } from "./web.ts";
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
	/**
	 * A new board. `title`, `size` and `at` are for a board made to hold something — a file
	 * dropped on empty canvas — and `request` asks for a `board.created` naming its path.
	 */
	| { type: "board.create"; kind?: string; format?: string; title?: string; size?: { w?: number; h?: number }; at?: { x: number; y: number }; request?: string }
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
	/**
	 * A conversation's history, asked for when it is shown — by opening it, or by a mirror
	 * board of it. It used to be part of the greeting, for every chat at once: 8.2 MB on the
	 * live deck, with the one on screen greeted last. Answered to the asker alone.
	 */
	| { type: "chat.open"; agentId: string }
	/** The whole output of one tool call whose `result` arrived as a preview (`full` set). */
	| { type: "chat.tool"; agentId: string; itemId: string }
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
	/**
	 * What this install can run, and what to call it — sent on connect, and whenever a
	 * client asks.
	 *
	 * A property of the machine, not of the deck, and it travels beside `deck.state` rather
	 * than inside it because the deck is a directory and this is what is installed.
	 */
	| { type: "runtimes"; list: RuntimeInfo[] }
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
	/** Answering `chat.tool`: the whole output, or empty when the call is no longer anywhere. */
	| { type: "chat.tool"; agentId: string; itemId: string; result: string }
	/** Answering a `board.create` that carried a `request`: the path the new board was given. */
	| { type: "board.created"; request: string; path: string }
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
