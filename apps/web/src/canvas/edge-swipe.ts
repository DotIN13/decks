import type { Finger } from "./touch.ts";

/**
 * Swipe in from an edge to bring the panel that lives there.
 *
 * The two panels have a button each in the title bar, which is how a finger reached them
 * until now — correct, and two taps up at the top of a phone for something the hand is
 * already holding the bottom of. Every mobile OS teaches the same gesture instead: pull in
 * from the edge the drawer is on. Left is the agents and their boards; right is the
 * conversation, which is where it sits on a wide screen too.
 *
 * **Only the reduced finger stream, so this works over a board as well as over the stage.**
 * A board is an iframe and its pointer events never reach this document (§4), so an edge
 * swipe watched on `window` would work on bare canvas and die the moment it began over a
 * board — which on a phone is most of the screen. `frame-gestures.ts` already converts a
 * board's fingers into stage coordinates and hands them to `Stage.touch`, so hooking the
 * same funnel means one implementation for both, and the stage spans the viewport, so a
 * stage x near 0 really is the left edge.
 *
 * The hard part is not the detection, it is **not stealing the pan.** A finger that lands
 * at the edge is claimed straight away, because 44px of camera movement before the panel
 * appears is a canvas that lurched; the claim is dropped again the moment the gesture says
 * it was a pan after all. So the cost of the gesture existing is that a pan beginning in
 * the outermost 28px does not move until the finger has travelled far enough to say which
 * of the two it is — the same trade iOS makes, and the reason the threshold is small.
 */

/** How near an edge a finger has to land for the swipe to be about a panel. */
const EDGE = 28;
/** How far inward it has to travel before the panel is what was meant. */
const OPEN = 44;
/** Vertical travel that settles it: this is a scroll or a pan, and not a drawer. */
const VERTICAL = 12;

export interface EdgeSwipeHost {
	/** The stage's width, which is the viewport's on every layout this app has. */
	width: () => number;
	/** Whether the swipe should be watched at all: a cursor has the buttons and the reach. */
	enabled: () => boolean;
	openLeft: () => void;
	openRight: () => void;
}

export interface EdgeSwipe {
	down: (finger: Finger) => void;
	/**
	 * Feed a moved finger.
	 *
	 * Returns true while this finger belongs to a possible or opened drawer, which is the
	 * caller's cue to leave the camera alone.
	 */
	move: (finger: Finger) => boolean;
	up: (id: number) => void;
	/** Two fingers are always the canvas, so a pinch abandons any pending swipe. */
	cancel: () => void;
}

interface Candidate {
	side: "left" | "right";
	x: number;
	y: number;
	/** Fired already: the panel is open and the rest of the drag is nobody's. */
	opened: boolean;
}

export function createEdgeSwipe(host: EdgeSwipeHost): EdgeSwipe {
	/** At most one, because a drawer pulled by two fingers is a pinch. */
	let candidate: (Candidate & { id: number }) | undefined;
	let fingers = 0;

	const cancel = () => {
		candidate = undefined;
	};

	return {
		down: (finger) => {
			fingers += 1;
			// A second finger means the canvas: whatever the first was doing, it is a pinch
			// now, and `Stage` clears its claims for the same reason.
			if (fingers > 1) return cancel();
			if (!host.enabled()) return;
			const width = host.width();
			const side = finger.x <= EDGE ? "left" : finger.x >= width - EDGE ? "right" : undefined;
			if (!side) return;
			candidate = { id: finger.id, side, x: finger.x, y: finger.y, opened: false };
		},

		move: (finger) => {
			if (!candidate || candidate.id !== finger.id) return false;
			if (candidate.opened) return true;
			// Inward is the direction the panel comes from, so a right-edge swipe travels
			// negative and a left-edge one positive.
			const inward = candidate.side === "left" ? finger.x - candidate.x : candidate.x - finger.x;
			const across = Math.abs(finger.y - candidate.y);
			// Settled the other way: a scroll, a pan, or a finger pushed back out of the
			// screen. The claim goes with it, and the camera picks the gesture up from here.
			if (across > VERTICAL && across > Math.abs(inward)) {
				cancel();
				return false;
			}
			if (inward < -VERTICAL) {
				cancel();
				return false;
			}
			if (inward < OPEN) return true;
			candidate.opened = true;
			if (candidate.side === "left") host.openLeft();
			else host.openRight();
			return true;
		},

		up: (id) => {
			fingers = Math.max(0, fingers - 1);
			if (candidate?.id === id) cancel();
		},

		cancel,
	};
}
