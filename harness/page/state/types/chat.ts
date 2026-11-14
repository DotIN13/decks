import type { AgentChat, AgentKind, AgentMode, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks-next/protocol";
/** An agent as the chat list draws it: its runtime, its identity, and what it can do. */



/**
 * The same four, as a value.
 *
 * A union type cannot be iterated, and both sides need to: the server maps each kind to a
 * backend class, the browser draws a row per kind in the new-agent menu. Written once here
 * so a fifth runtime is one edit rather than three that drift.
 */
export const AGENT_KINDS: readonly AgentKind[] = ["claude", "pi", "opencode", "opencode2", "antigravity"];

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


/** What an agent's runtime can do, where runtimes differ. */
export interface AgentCapabilities {
	/** Empty for a runtime with no notion of asking first. */
	modes: AgentMode[];
}






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


