import { createSignal } from "solid-js";

/**
 * The floating panels, and whether each one is there.
 *
 * Two of them now — the agents and the focused agent's canvases — where there used to be
 * one holding both, and each has a button of its own in the title bar. That split is the
 * design: an agent list and a set of boards are two different questions, and a panel
 * answering both is one you open for half a reason and then close.
 *
 * **Proximity is gone.** This used to copy Stage Manager: a sliver at the edge, and a cursor
 * approaching that edge brought the panel in. A good trick for a panel that hid itself, and
 * the wrong one for a panel that is now the *only* place an agent's state is shown — a
 * surface you rely on should not come and go with where the cursor happens to be, and a
 * button that disagrees with the screen is worse than no button. A panel you asked for stays
 * until you say otherwise; that is also what pinning was for, so pinning went with it.
 *
 * Persisted per browser, because a panel you opened deliberately and lost to a reload is a
 * panel you have to keep re-opening, and the whole point of a toggle is that it holds.
 *
 * The panels and the conversation are **mutually exclusive** on a screen too narrow to hold
 * them beside the canvas — 200px of rail and 340px of bubbles on a 390px phone is two
 * surfaces and no canvas. That rule lives in `App`, which is the only place that knows about
 * all three; `NARROW` is exported for it.
 */

/**
 * Below this the panels and the conversation cannot share the screen with the canvas, so
 * they take turns.
 *
 * A width, unusually — most of the decisions about chrome here ask `(hover: none)` instead —
 * because this one really is about how many pixels there are.
 */
export const NARROW = 760;

/** Whether this pointer can hover, asked once: a device does not change its mind. */
export function canHover(): boolean {
	try {
		return !window.matchMedia("(hover: none)").matches;
	} catch {
		// No matchMedia at all is old enough to be a desktop browser.
		return true;
	}
}

/** Which panel. Named for what it holds rather than which edge it is on. */
export type PanelName = "agents" | "context";

export interface Panel {
	open: () => boolean;
	set: (open: boolean) => void;
	toggle: () => void;
}

const KEY = (name: PanelName) => `decks.panel.${name}`;

/**
 * Away on a fresh browser, both of them.
 *
 * The canvas is the work and the chrome is not, so nothing covers a board until it is asked
 * for. The buttons are in the title bar rather than behind a gesture, so "away" is not the
 * same as "hidden" — which is what it was when the only way in was to guess that the left
 * edge was live.
 */
function stored(name: PanelName): boolean {
	try {
		return localStorage.getItem(KEY(name)) === "open";
	} catch {
		return false;
	}
}

function createPanel(name: PanelName): Panel {
	const [open, setOpen] = createSignal(stored(name));
	const set = (next: boolean) => {
		setOpen(next);
		try {
			localStorage.setItem(KEY(name), next ? "open" : "away");
		} catch {
			/* private browsing: the choice just does not persist */
		}
	};
	return { open, set, toggle: () => set(!open()) };
}

export function createPanels(): Record<PanelName, Panel> {
	return { agents: createPanel("agents"), context: createPanel("context") };
}
