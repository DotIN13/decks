/**
 * Which slide action a keystroke is — on the canvas, and in fullscreen.
 *
 * Its own module for the reason `zoom-keys.ts` is: a key map is exactly the thing that is
 * easy to get subtly wrong in two places, and this one is read from three — the app's own
 * keyboard handler, a board frame forwarding keys out of an iframe, and the fullscreen
 * overlay. One table, one test.
 *
 * ### The keyboard is earned, state by state
 *
 * A deck sitting in the corner of the canvas takes **nothing**. Clicking it is the ask, and
 * only then do the arrows mean slides — otherwise a board nobody is looking at would swallow
 * every arrow key meant for something else.
 *
 * `←` `→` turn out to be free, which was checked rather than assumed: the component editor
 * nudges a selected box with them, but only inside a `selection` branch, and a slides board
 * has no components to select. The two owners are disjoint by construction.
 */
export type SlideAction = "prev" | "next" | "first" | "last" | "present" | "exit";

/** Where the keystroke arrived: a focused deck on the canvas, or the fullscreen overlay. */
export type SlideWhere = "focused" | "fullscreen";

/**
 * `Space` is the difference between the two states, and it is the interesting entry.
 *
 * On the canvas it is held-to-pan — the primary navigation gesture — so taking it there to
 * add a second way to do what `→` already does would be a bad trade. In fullscreen there is
 * no canvas to pan and Space is what a presenter's thumb reaches for.
 */
export function slideKey(
	event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
	where: SlideWhere,
): SlideAction | undefined {
	// A modified key belongs to somebody else: ⌘→ is a word jump, ⌥→ is the window manager,
	// and ⌘+ is the canvas zoom (`zoom-keys.ts`).
	if (event.metaKey || event.ctrlKey || event.altKey) return undefined;

	switch (event.key) {
		case "ArrowRight":
		case "PageDown":
			return "next";
		case "ArrowLeft":
		case "PageUp":
			return "prev";
		case "Home":
			return "first";
		case "End":
			return "last";
		/*
		 * Every physical presentation clicker sends PageUp/PageDown and nothing else — which
		 * is why they are up there beside the arrows rather than treated as an extra. A deck
		 * view that only listens for arrows is a deck you cannot present with a remote in
		 * your hand.
		 */
		case " ":
			// Shift-Space is "back" on a clicker, and on a keyboard it is what a hand does
			// when it means to go back without moving.
			return where === "fullscreen" ? (event.shiftKey ? "prev" : "next") : undefined;
		case "f":
		case "F":
			return where === "focused" ? "present" : undefined;
		case "Escape":
			// Only in fullscreen. On the canvas Escape already deselects, and a deck taking
			// it would mean clicking a deck cost you the way out of everything else.
			return where === "fullscreen" ? "exit" : undefined;
		default:
			return undefined;
	}
}

/**
 * Whether a deck should be drawn as a contact sheet rather than as one slide.
 *
 * The same threshold the canvas already uses for pointer events, and deliberately the same
 * number rather than a second one: below it a board takes no clicks, so a deck down there
 * cannot be paged and showing one slide of twelve would be showing the least useful thing.
 * Above it the board is something you interact with, and one slide is the point.
 */
export function deckMode(zoom: number, interactZoom: number): "stage" | "sheet" {
	return zoom < interactZoom ? "sheet" : "stage";
}


/**
 * What `runtime/lib/slides.js` puts on a deck frame's `window` as `__deck`.
 *
 * Declared here rather than imported, because the runtime is plain JS shipped into every
 * deck and deliberately untyped — a `.d.ts` beside it would be a second thing to keep true
 * of a file that is copied, not compiled. This is the *consumer's* view of that contract,
 * which is the only place it can be checked.
 */
export interface DeckHandle {
	total: number;
	current(): number;
	go(index: number): void;
	next(): void;
	prev(): void;
	first(): void;
	last(): void;
	fit(): void;
	setMode(mode: "stage" | "sheet"): void;
}
