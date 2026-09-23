/** An agent as the chat list draws it: its runtime, its identity, and what it can do. */
import type { AgentUsage } from "./usage.ts";

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
 * One runtime, as a browser can understand it.
 *
 * The client used to know four runtime names and nothing else about them — not what to call
 * them in a menu, and not whether the machine could run them. So the `+` menu said "New
 * claude agent" and offered Antigravity on a machine with no `agy` on it, and the first
 * prompt was where you found out. Both facts are the server's, and this is how they travel.
 *
 * **Everything true of the runtime rather than of a conversation belongs here.** The three
 * below used to ride on every chat row, which meant a deck of thirty-four chats greeted a
 * browser with thirty-four copies of a model catalogue and of a slash-command list: 96 KB of
 * a 444 KB greeting, carrying eight KB of distinct facts. A chat says which runtime it is on
 * and the browser looks the rest up here.
 */
export interface RuntimeInfo {
	kind: AgentKind;
	/** What a person calls it. Distinct from `kind`, which is an id. */
	label: string;
	/** Whether it can start here — a `PATH` lookup or a file check, never a spawn. */
	available: boolean;
	/** Why not, in a sentence for the person who has to fix it. Absent when available. */
	reason?: string;
	/** What its agents can do, where runtimes differ. Declared by the runtime, never per session. */
	capabilities: AgentCapabilities;
	/**
	 * What `/` completes to on a chat of this runtime.
	 *
	 * The list a dormant chat offers. A *running* session can discover more — a project's
	 * own commands, a skill the CLI found — and says so on its own row (`AgentChat.commands`).
	 */
	commands: SlashCommand[];
	/**
	 * The models it last offered on this deck. Empty until it has run here once.
	 *
	 * Remembered per runtime rather than asked of a backend (`agents/store.ts`), which is what
	 * lets a restored deck draw a model picker with nothing running.
	 */
	models: ModelOption[];
}

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

/**
 * One row in the chat list: an agent, as a messaging app would draw it — and everything
 * else a browser knows about that agent.
 *
 * **The row is the whole chat, not a summary of it.** The greeting used to send this list
 * and then seven more messages per chat — its identity, its state, the boards it holds, its
 * model, its catalogue, its account, its reading — which on a deck of thirty-four chats is
 * 233 messages behind one. Every one of them was a separate change to the browser's state,
 * and a change is a redraw: the page was blocked for seventeen seconds applying a greeting
 * the server had finished sending in 120 milliseconds. The facts are per chat and had to
 * travel; the envelopes did not.
 *
 * Each of these is still broadcast on its own when it *changes* (`agent.identity`,
 * `context.changed`, `agent.model`…). That is what makes a reconnect an ordinary refresh
 * rather than a second code path: the list is the same facts, all at once.
 */
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
	kind: AgentKind;
	/**
	 * What `/` completes to, when this session offers more than its runtime does.
	 *
	 * Absent on a dormant chat, and on a running one that found nothing extra: the list to
	 * draw is then `RuntimeInfo.commands` for its `kind`. Present when a started session has
	 * discovered its own — a project's commands, a skill the CLI found — which is the only
	 * case where two chats on one runtime have different menus.
	 */
	commands?: SlashCommand[];
	/** Absent when the runtime has no modes. */
	mode?: AgentMode;
	/**
	 * What the agent says about itself: its colour, its tags, the workspace it works in.
	 *
	 * `name` and `avatar` above are the same two fields again, because they are what the row
	 * draws and every reader of a row asks for them by that name. The rest of an identity is
	 * read by the canvas, the cursors and the panel's grouping.
	 */
	identity: Identity;
	/** The boards it holds — its reading. */
	boards: string[];
	/** The boards it has put on its stage, a subset of the above. */
	inPlay: string[];
	/** The model and thinking level it is on, live from a running runtime or as last recorded. */
	model?: AgentModel;
	/** The Claude subscription it spends, when it is on one of its own. */
	account?: string;
	/** Its context and cost meter, as of its last turn. */
	usage?: AgentUsage;
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
	/**
	 * The workspace this agent works in, as a slug: `"political-llm"`.
	 *
	 * Set through `stage.me.setWorkspace`, and by you from the row's customise popup; **one
	 * field, both writers, last write wins.** Tags needed two fields because a list can hold
	 * two truths — the agent's and yours — but a workspace is a location, and an agent in two
	 * locations is a contradiction rather than a richer answer.
	 *
	 * A slug rather than a label, for the reason `agents/tags.ts` gives: `"Political LLM"` and
	 * `political-llm` have to be the same group or "who else is on this" has no answer.
	 *
	 * Here and not on `AgentChat` because it is the same kind of fact as a name: the agent
	 * chose it about itself, and `agent.identity` already carries it to every browser and
	 * through every restart.
	 */
	workspace?: string;
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
