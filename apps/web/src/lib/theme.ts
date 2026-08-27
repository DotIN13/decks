import { createSignal } from "solid-js";

export type Scheme = "light" | "dark";

/**
 * The colour scheme, and handing it to the boards.
 *
 * This is the first thing the same-origin decision (DESIGN §4) buys: the app can
 * reach into a board's document and set `data-theme` on it, so a dark shell does
 * not sit around three white pages. No bridge, no message, no cooperation needed
 * from the board — three lines, because the frame is ours.
 *
 * A board that names its own theme keeps it. `board.js` writes `data-theme` only
 * when the board's `<meta>` asked for one, so the presence of the attribute is
 * exactly the question "did the author decide this?" and the answer is respected.
 */
const KEY = "decks.scheme";

function initial(): Scheme {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === "light" || saved === "dark") return saved;
	} catch {
		/* private browsing: fall through to the system preference */
	}
	return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const [scheme, setSchemeSignal] = createSignal<Scheme>(initial());
export { scheme };

export function setScheme(next: Scheme): void {
	setSchemeSignal(next);
	document.documentElement.dataset.colorScheme = next;
	try {
		localStorage.setItem(KEY, next);
	} catch {
		/* as above */
	}
	paintAll();
}

export function toggleScheme(): void {
	setScheme(scheme() === "dark" ? "light" : "dark");
}

/** Give one board frame the app's scheme, unless the board chose for itself. */
export function paintFrame(frame: HTMLIFrameElement | null | undefined): void {
	if (!frame) return;
	try {
		const root = frame.contentDocument?.documentElement;
		if (!root) return;
		if (root.dataset.theme && root.dataset.deckPainted !== "true") return;
		root.dataset.theme = scheme();
		root.dataset.deckPainted = "true";
	} catch {
		// Only reachable if a board is ever served cross-origin. Then it keeps its
		// own scheme, which is a cosmetic loss and not worth a warning in the log.
	}
}

export function paintAll(): void {
	for (const frame of document.querySelectorAll("iframe")) paintFrame(frame as HTMLIFrameElement);
}

// Follow the system while nothing has been chosen explicitly.
matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
	try {
		if (localStorage.getItem(KEY)) return;
	} catch {
		/* as above */
	}
	setScheme(event.matches ? "light" : "dark");
});

document.documentElement.dataset.colorScheme = scheme();
