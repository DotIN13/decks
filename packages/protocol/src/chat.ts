/** An agent as the chat list draws it: its runtime, its identity, and what it can do. */
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
