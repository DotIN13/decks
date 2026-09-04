import type { AgentState } from "@decks/protocol";
import type { SoundChoice } from "./sound.ts";

/**
 * What the app interrupts you for, and the rules about when.
 *
 * The whole policy, with no DOM and no `AudioContext` in it, so the questions worth arguing
 * about can be argued about in `alerts.test.ts` rather than by opening a browser and waiting
 * for an agent to finish: does a state change count as finishing, does a sound play while
 * you are watching, does a notification fire while you are watching, and what does the tab
 * say when several things have piled up.
 *
 * ### Three kinds, and they are the app's own words
 *
 * opencode's notification context has three too — turn complete, permission asked, error —
 * and the parallel is not a coincidence, because a coding agent has exactly three moments
 * worth a noise. But this app already had names for its agent states long before it had
 * sounds (`chrome/agent-order.ts` derives `waiting` / `done` / `working` / `idle` and prints
 * them in the hover card), so the kinds are named after those rather than after opencode's:
 *
 * - **`done`** — an agent stopped working. `agent-order` calls the unread version of this
 *   `done` and rings it green; this is the moment it turns green.
 * - **`ask`** — an agent wants an answer and has stopped until it gets one: a dialog over the
 *   input bar, or the `waiting` state. The one kind that is genuinely blocking.
 * - **`problem`** — something failed. A notice at `error`, or the socket's `error` message.
 *
 * ### Sound and notification are different questions
 *
 * A **sound** plays whether or not you are looking at the tab. That is the point of it: the
 * common case for "Claude finished" is somebody in the room with the screen, not somebody in
 * another application, and a cue that goes quiet exactly when you are there to hear it is a
 * cue that only ever fires when it is too late to be useful.
 *
 * A **notification** is suppressed while the page is visible and focused, because an OS
 * banner over a window you are already reading is telling you something you can see. This is
 * the same split opencode makes in `entry.tsx` (`const inView = …; if (inView) return`), and
 * it is the right one.
 */

export type AlertKind = "done" | "ask" | "problem";

export const ALERT_KINDS: AlertKind[] = ["done", "ask", "problem"];

/** How each kind is described in Settings. The wording is the feature's documentation. */
export const ALERT_LABELS: Record<AlertKind, { label: string; note: string }> = {
	done: { label: "An agent finishes", note: "It stopped working and left you something to read." },
	ask: { label: "An agent asks you something", note: "A question over the input bar. Nothing moves until you answer." },
	problem: { label: "Something goes wrong", note: "A turn failed, or the deck refused an edit." },
};

export interface AlertPrefs {
	/** 0 to 1. Applied on top of each cue's own balance — see `play` in `sound.ts`. */
	volume: number;
	sound: Record<AlertKind, SoundChoice>;
	notify: Record<AlertKind, boolean>;
}

/**
 * The defaults, and the one that is off.
 *
 * Sounds are on for all three, because the cues are short and the events are rare — an agent
 * finishes a handful of times an hour, not a handful of times a minute.
 *
 * **`problem` does not raise a banner.** A failure is already the loudest thing on screen:
 * it puts a red notice in the corner, and usually the agent stops, which fires `done` a
 * moment later anyway. A banner as well is the same fact three times. opencode reaches the
 * same default (`notifications.errors: false`) from the same direction.
 *
 * The cues are picked so that the three are distinguishable *without* being learned: `ask`
 * is the only one that does not resolve, and `problem` is the only one that falls.
 */
export const DEFAULT_PREFS: AlertPrefs = {
	volume: 0.7,
	sound: { done: "chime", ask: "knock", problem: "drop" },
	notify: { done: true, ask: true, problem: false },
};

const KEY = "decks.alerts";

/**
 * Read the saved preferences, filling in anything missing from the defaults.
 *
 * Merged field by field rather than `{...DEFAULT_PREFS, ...saved}`, because the two nested
 * records would be replaced wholesale by a spread — so a blob written before a fourth kind
 * existed would leave that kind undefined, and `undefined` is not the same as "off". The
 * same arithmetic makes an old or hand-edited value harmless: anything that is not a number
 * or not a known choice falls back rather than throwing on the way to the first paint.
 */
export function loadPrefs(read: () => string | null = () => safeGet(KEY)): AlertPrefs {
	let saved: unknown;
	try {
		saved = JSON.parse(read() ?? "");
	} catch {
		return DEFAULT_PREFS;
	}
	if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
	const blob = saved as Partial<AlertPrefs>;
	const volume = typeof blob.volume === "number" && blob.volume >= 0 && blob.volume <= 1 ? blob.volume : DEFAULT_PREFS.volume;
	const sound = {} as Record<AlertKind, SoundChoice>;
	const notify = {} as Record<AlertKind, boolean>;
	for (const kind of ALERT_KINDS) {
		const choice = blob.sound?.[kind];
		sound[kind] = typeof choice === "string" ? (choice as SoundChoice) : DEFAULT_PREFS.sound[kind];
		const flag = blob.notify?.[kind];
		notify[kind] = typeof flag === "boolean" ? flag : DEFAULT_PREFS.notify[kind];
	}
	return { volume, sound, notify };
}

export function savePrefs(prefs: AlertPrefs): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs));
	} catch {
		/* private browsing: the settings hold for this tab and are forgotten with it */
	}
}

function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

// --- what counts as an event -------------------------------------------------------

/**
 * Did this state change mean the agent *finished*?
 *
 * "Arrived at idle from somewhere else", which is narrower than "is idle" in the two ways
 * that matter. A reconnection replays every agent's state (`session.ts` answers `agent.state`
 * on subscribe), so treating the value as the event would ring the whole deck at once every
 * time a laptop woke up; and an agent that was already idle and is told so again has not
 * done anything.
 *
 * `undefined` for the previous state is the first thing this browser ever heard about the
 * agent, and that is never an event — see the reconnection case above.
 */
export function finished(previous: AgentState | undefined, next: AgentState): boolean {
	if (next !== "idle") return false;
	return previous !== undefined && previous !== "idle";
}

/** The same shape for `waiting`: it has to be an arrival, not a restatement. */
export function startedAsking(previous: AgentState | undefined, next: AgentState): boolean {
	if (next !== "waiting") return false;
	return previous !== "waiting";
}

// --- whether to act ----------------------------------------------------------------

/** Whether the person is demonstrably in front of this tab right now. */
export interface Presence {
	visible: boolean;
	focused: boolean;
}

export function inView(presence: Presence): boolean {
	return presence.visible && presence.focused;
}

/** Sound plays regardless of presence — the argument is in this file's header. */
export function shouldSound(kind: AlertKind, prefs: AlertPrefs): boolean {
	return prefs.volume > 0 && prefs.sound[kind] !== "none";
}

/** A banner only for something you cannot already see. */
export function shouldNotify(kind: AlertKind, prefs: AlertPrefs, presence: Presence): boolean {
	if (!prefs.notify[kind]) return false;
	return !inView(presence);
}

// --- the tab itself ----------------------------------------------------------------

/** The name in the tab strip, with a count when things have piled up behind it. */
export const BASE_TITLE = "Decks";

/**
 * `Decks`, `(1) Decks`, `(9+) Decks`.
 *
 * Leading rather than trailing, because a tab strip with eight tabs in it shows about twelve
 * characters and they are the first twelve. Capped at nine for the same reason: `(23)` and
 * `(9+)` say the same thing to somebody glancing at a 120px tab, and one of them is shorter.
 */
export function tabTitle(unattended: number, base = BASE_TITLE): string {
	if (unattended <= 0) return base;
	return `(${unattended > 9 ? "9+" : unattended}) ${base}`;
}
