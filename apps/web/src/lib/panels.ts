import { createSignal, onCleanup } from "solid-js";

/**
 * The two floating panels, and when they are there.
 *
 * The canvas is the point of this app, so the chrome is away by default and comes
 * when it is wanted. Stage Manager's trick is the one worth copying: a sliver at the
 * edge, and the cursor approaching that edge brings the panel in. No button to find,
 * nothing covering the work while you are not using it.
 *
 * Proximity is measured in JavaScript rather than with an invisible hover strip. A
 * strip wide enough to aim at is also a strip that swallows clicks on whatever is
 * under it — the zoom controls and the timeline live in exactly those corners — and
 * `pointer-events: none` would stop it detecting hover at all. Arithmetic on
 * `pointermove` has neither problem.
 *
 * Each panel can also be **pinned**, because a panel that vanishes when the cursor
 * leaves is a panel you cannot work in: dragging a board out of the rail, reading a
 * long reply, scrolling the chat. Pinning persists per browser.
 *
 * **A finger cannot approach an edge.** There is no cursor to be near with, and the
 * only `pointermove` a touchscreen sends is one during a drag — so on a phone the
 * proximity rule made both panels unreachable, and worse than unreachable: a pan that
 * happened to begin at the left edge summoned the rail over the canvas mid-gesture. So
 * where the pointer cannot hover, proximity is off entirely and the panels are toggled
 * from two buttons in the title bar (`toggle`). The thesis survives the change intact —
 * §7 wants the chrome away by default and the boards in front, which a sheet you open
 * deliberately honours better than an edge that opens by accident.
 *
 * They are also **mutually exclusive** once the screen is too narrow to hold both: 200px
 * of rail and 380px of transcript on a 390px phone is two panels and no canvas, so each
 * one closes the other and there is always a deck behind them.
 */

/** How close to the edge counts as reaching for the panel. */
const REACH = 26;
/** How far past a panel's own width the cursor must go before it leaves again. */
const SLACK = 48;
/**
 * Below this the two panels cannot share the screen with the canvas, so they take turns.
 *
 * A width, unusually — most of the decisions in this file are about the input device and
 * ask `(hover: none)` — because this one really is about how many pixels there are.
 */
const NARROW = 760;

/** Whether this pointer can hover, asked once: a device does not change its mind. */
export function canHover(): boolean {
	try {
		return !window.matchMedia("(hover: none)").matches;
	} catch {
		// No matchMedia at all is old enough to be a desktop browser.
		return true;
	}
}

export type Side = "left" | "right";

/**
 * Everything that wants to know where the pointer is.
 *
 * The window's own `pointermove` is not enough: a board is an iframe, and pointer
 * events inside one do not cross into the parent — so a panel opened at the edge
 * stayed open for as long as the cursor was over a board, which is most of the time.
 * The board frames report their position through `notePointer` (see
 * `canvas/frame-gestures.ts`), and this is where both sources meet.
 */
const reporters = new Set<(x: number) => void>();

/** Tell the panels where the pointer is, in the parent document's coordinates. */
export function notePointer(x: number): void {
	for (const report of reporters) report(x);
}

interface Panel {
	open: () => boolean;
	pinned: () => boolean;
	setPinned: (pinned: boolean) => void;
	/** Opened or closed by a tap, which is how a touchscreen asks for either. */
	toggle: () => void;
	close: () => void;
	/**
	 * Hold it open regardless of the cursor, until the cursor moves properly away.
	 * Set when a turn is clicked on the spine.
	 */
	hold: (held: boolean) => void;
}

const KEY = (side: Side) => `decks.panel.${side}`;

function stored(side: Side): boolean {
	try {
		return localStorage.getItem(KEY(side)) === "pinned";
	} catch {
		return false;
	}
}

function createPanel(side: Side, width: () => number): Panel {
	const [near, setNear] = createSignal(false);
	const [tapped, setTapped] = createSignal(false);
	const [pinned, setPinnedSignal] = createSignal(stored(side));
	const [held, setHeld] = createSignal(false);
	/**
	 * True while the panel holds *keyboard* focus, so tabbing into it works.
	 *
	 * `:focus-visible`, not plain focus: clicking a button inside the panel focuses it,
	 * and treating that as "someone is using this" meant a panel never hid again after
	 * a single click. The browser already knows the difference between arriving by Tab
	 * and arriving by mouse; this asks it rather than guessing.
	 */
	const [focused, setFocused] = createSignal(false);

	const selector = side === "left" ? ".side" : ".chat";

	const measure = (x: number) => {
		const edge = side === "left" ? x : window.innerWidth - x;
		// Two thresholds, not one: opening takes a deliberate reach for the edge, and
		// closing takes leaving the panel properly. One threshold flickers when the
		// cursor sits on the boundary.
		if (edge <= REACH) return true;
		if (edge > width() + SLACK) return false;
		return undefined;
	};

	const report = (x: number) => {
		// A finger has no hover, and its only `pointermove` is part of a drag: reading
		// one as "reaching for the edge" opens a panel in the middle of a pan.
		if (!canHover()) return;
		const verdict = measure(x);
		if (verdict === undefined) return;
		setNear(verdict);
		// A hold is "stay while I read this" — clicking a turn on the spine sets one.
		// Moving properly away is how you say you are done, so it clears itself rather
		// than becoming another switch to remember to turn off.
		if (!verdict && held()) setHeld(false);
	};
	reporters.add(report);
	onCleanup(() => reporters.delete(report));

	const onPointerMove = (event: PointerEvent) => report(event.clientX);

	// A cursor that leaves the window entirely has left the panel too.
	const onLeave = () => setNear(false);

	const onFocusChange = () => {
		const active = document.activeElement;
		const inside = Boolean(active && active !== document.body && active.closest(selector));
		setFocused(inside && matchesFocusVisible(active));
	};

	window.addEventListener("pointermove", onPointerMove, { passive: true });
	window.addEventListener("blur", onLeave);
	document.addEventListener("pointerleave", onLeave);
	document.addEventListener("focusin", onFocusChange);
	document.addEventListener("focusout", onFocusChange);

	onCleanup(() => {
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("blur", onLeave);
		document.removeEventListener("pointerleave", onLeave);
		document.removeEventListener("focusin", onFocusChange);
		document.removeEventListener("focusout", onFocusChange);
	});

	return {
		open: () => pinned() || held() || near() || focused() || tapped(),
		pinned,
		setPinned: (next) => {
			setPinnedSignal(next);
			try {
				localStorage.setItem(KEY(side), next ? "pinned" : "away");
			} catch {
				/* private browsing: the choice just does not persist */
			}
		},
		hold: setHeld,
		toggle: () => {
			setTapped((was) => {
				// A tap that closes a panel opens it again by the same tap: whatever held
				// it open is done too, or the panel would stay up with no way to put it
				// down (a touchscreen has no cursor to wander away).
				if (was) setHeld(false);
				return !was;
			});
		},
		/**
		 * Closed for good, even if it was held open.
		 *
		 * ``setTapped`` alone leaves a held panel open — clicking a turn on the spine
		 * sets a hold, and then nothing on a touchscreen would dismiss it. A swipe or a
		 * tap on the other panel is not “leave the cursor alone for a moment”; it is
		 * “I am done here”, and the hold goes too.
		 */
		close: () => {
			setTapped(false);
			setHeld(false);
		},
	};
}

/** `:focus-visible` where it exists, and "no" where it does not. */
function matchesFocusVisible(element: Element | null): boolean {
	if (!element) return false;
	try {
		return element.matches(":focus-visible");
	} catch {
		return false;
	}
}

/** The panels' widths, kept here so the proximity maths matches the stylesheet. */
export const PANEL_WIDTH = { left: 200, right: 380 } as const;

export function createPanels(): Record<Side, Panel> {
	const left = createPanel("left", () => PANEL_WIDTH.left);
	const right = createPanel("right", () => PANEL_WIDTH.right);

	/**
	 * On a narrow screen, opening one panel closes the other.
	 *
	 * Wrapped here rather than inside `createPanel`, because "the other one" is a fact
	 * about the pair and neither panel should be given a reference to its sibling. The
	 * pinning is cleared too: a pinned panel is one that stays, and a sheet that stays
	 * under the sheet on top of it is a panel nobody can see and cannot get rid of.
	 */
	const exclusive = (panel: Panel, other: Panel): Panel => ({
		...panel,
		toggle: () => {
			const wasOpen = panel.open();
			panel.toggle();
			if (!wasOpen && window.innerWidth < NARROW) {
				other.close();
				other.hold(false);
				if (other.pinned()) other.setPinned(false);
			}
		},
	});

	return { left: exclusive(left, right), right: exclusive(right, left) };
}
