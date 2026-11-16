import type { AgentState } from "../state/types/index.ts";
import { isSound, SILENT, type SoundChoice } from "./sound.ts";

/**
 * What the app interrupts you for, and the rules about when.
 */

export type AlertKind = "done" | "ask" | "problem";

export const ALERT_KINDS: AlertKind[] = ["done", "ask", "problem"];

/** How each kind is described in Settings. The wording is the feature's documentation. */
export const ALERT_LABELS: Record<AlertKind, { label: string; note: string }> = {
	done: { label: "An agent finishes", note: "It left you something to read." },
	ask: { label: "An agent asks you something", note: "It waits until you answer." },
	problem: { label: "Something goes wrong", note: "A turn failed, or an edit was refused." },
};

export interface AlertPrefs {
	/** 0 to 1. Applied on top of each cue's own balance: see `play` in `sound.ts`. */
	volume: number;
	sound: Record<AlertKind, SoundChoice>;
	notify: Record<AlertKind, boolean>;
}

/**
 * The defaults, and the one that is off.
 */
export const DEFAULT_PREFS: AlertPrefs = {
	volume: 0.65,
	/*
	 * opencode's own three, kept rather than re-chosen: `staplebops-01` for a finished turn,
	 * `staplebops-02` for a question, `nope-03` for a failure.
	 */
	sound: { done: "staplebops-01", ask: "staplebops-02", problem: "nope-03" },
	notify: { done: true, ask: true, problem: false },
};

const KEY = "decks.alerts";

/**
 * Read the saved preferences, filling in anything missing from the defaults.
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
		/*
		 * Checked against the set this build actually has, not merely "is a string".
		 */
		const choice = blob.sound?.[kind];
		sound[kind] = isSound(choice) ? choice : DEFAULT_PREFS.sound[kind];
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

/** Sound plays regardless of presence: only the volume and each kind's own setting decide. */
export function shouldSound(kind: AlertKind, prefs: AlertPrefs): boolean {
	return prefs.volume > 0 && prefs.sound[kind] !== SILENT;
}

/** A banner only for something you cannot already see. */
export function shouldNotify(kind: AlertKind, prefs: AlertPrefs, presence: Presence): boolean {
	if (!prefs.notify[kind]) return false;
	return !inView(presence);
}

// --- the tab itself ----------------------------------------------------------------

/** The name in the tab strip, with a count when things have piled up behind it. */
const BASE_TITLE = "Decks";

/**
 * `Decks`, `(1) Decks`, `(9+) Decks`.
 */
export function tabTitle(unattended: number, base = BASE_TITLE): string {
	if (unattended <= 0) return base;
	return `(${unattended > 9 ? "9+" : unattended}) ${base}`;
}
