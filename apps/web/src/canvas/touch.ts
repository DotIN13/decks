/**
 * What a set of fingers on the canvas means, and nothing about where they are.
 *
 * The camera's touch gestures happen in two documents — on the stage, and inside a
 * board frame (`frame-gestures.ts`, DESIGN §7) — and the mistake to avoid is writing
 * them twice. What both places need is the same reduction: fingers arrive and leave,
 * one of them moves, and the answer is either "pan by this much" or "here is one step
 * of a pinch". So that reduction is here, as arithmetic over plain numbers, and the
 * two callers keep only the part that is theirs: converting their own coordinates and
 * moving the camera.
 *
 * **Positions are screen pixels, whoever is asking.** A board frame's own pixels are
 * board pixels, so `frame-gestures.ts` converts before it reports — and it must,
 * because a finger that does not move is over a *different* part of the board once the
 * camera pans under it. Screen space is the one frame of reference in which a still
 * finger is still, which is what stops a two-finger gesture feeding itself.
 *
 * **A step is measured against the last event, not against the start.** Two fingers
 * describe a zoom the canvas may refuse (`clampZoom`), and a gesture measured from its
 * start would then spend the rest of its life describing a camera that does not exist —
 * spread past the limit and the pinch stops answering until you come all the way back.
 * Incremental steps compose, and each one is honoured or clamped on its own.
 *
 * ### A finger that never lifted
 *
 * The pool is fed from several documents at once, and none of them can promise to
 * report the end of a gesture. A board's iframe is navigated the instant anybody writes
 * that board — its document dies mid-drag and the `pointerup` is delivered to nothing.
 * A tab that goes to the background loses its touches. A sandboxed embed reports its
 * fingers by `postMessage` and can be reloaded between two of them.
 *
 * Every one of those leaves a finger in the pool that is not on the glass, and one is
 * enough to break the canvas until the page is reloaded: the next single finger makes a
 * pair, so **every touch is read as a pinch**, the stage thinks a gesture is in progress
 * and keeps the grabbing cursor, and a board can no longer be dragged because the drag
 * gives way to what it takes for a second finger.
 *
 * So the sources release what they hold (`frame-gestures.ts` on teardown, `Stage` when
 * the window loses focus), and this file is the net under them, because a source that
 * has died cannot release anything:
 *
 * - **a finger with no events for `STALE_MS` is gone** when the next one lands. Not on a
 *   timer, because a finger held still is perfectly legitimate and no clock can tell it
 *   from a lost one; only at the moment a new finger would otherwise be read as the
 *   second half of a pinch, which is when the difference starts to matter.
 * - **a finger that moves without having landed is adopted**, rather than ignored. That
 *   is the other half of the same recovery: the sources hold their own record of what is
 *   down, so a move can only arrive for a finger that this pool dropped and the hand
 *   still has. It contributes no step of its own — there is no previous position to
 *   measure from — and drives the gesture from there.
 */

export interface Finger {
	id: number;
	x: number;
	y: number;
}

export type TouchStep =
	/** Nothing to do: the first event of a new finger, whether it landed or was adopted. */
	| { kind: "idle" }
	/** One finger, moved. In screen pixels, so it can go straight to `pan`. */
	| { kind: "pan"; dx: number; dy: number }
	/** Two or more fingers: where the pair was, and where it is now. */
	| { kind: "pinch"; from: [Finger, Finger]; to: [Finger, Finger] };

export interface Touches {
	down(finger: Finger): void;
	/** Where the gesture now is, and what that means. */
	move(finger: Finger): TouchStep;
	up(id: number): void;
	/** The fingers this pool believes are down, so a caller can release its own. */
	ids(): number[];
	count(): number;
	clear(): void;
}

/**
 * How long a finger may go without a single event before a new one assumes it is gone.
 *
 * Ten seconds is far longer than any gesture and far shorter than a session. The cost of
 * being wrong is small in both directions: evict a finger genuinely held motionless for
 * ten seconds and its next movement adopts it back; keep a lost one and the canvas is
 * broken until the page reloads.
 */
export const STALE_MS = 10_000;

interface Held extends Finger {
	/** When this finger was last heard from, so a lost one can be told from a still one. */
	at: number;
}

const bare = (finger: Held): Finger => ({ id: finger.id, x: finger.x, y: finger.y });

/**
 * The fingers currently down, in the order they landed.
 *
 * Order matters for one reason: a pinch is read from the *first two*, so a third finger
 * joining does not reinterpret the gesture halfway. And because every step is measured
 * against stored positions that are always current, a finger arriving or leaving never
 * produces a jump — it only changes which pair the next step is read from.
 */
export function createTouches(options: { now?: () => number } = {}): Touches {
	const clock = options.now ?? (() => Date.now());
	const fingers: Held[] = [];
	const find = (id: number) => fingers.find((finger) => finger.id === id);

	return {
		down(finger) {
			/*
			 * Anything the hand cannot still be holding, dropped before this finger is
			 * counted — a pinch is two fingers on the glass at the same time, and a
			 * record from ten seconds ago is not evidence of one.
			 */
			const cutoff = clock() - STALE_MS;
			for (let i = fingers.length - 1; i >= 0; i--) if ((fingers[i] as Held).at < cutoff) fingers.splice(i, 1);

			const existing = find(finger.id);
			if (existing) {
				// A recycled id — Safari reuses them — is a new finger, not the old one
				// moving. Taking the position without emitting a step is what a landing
				// is, so nothing lurches.
				existing.x = finger.x;
				existing.y = finger.y;
				existing.at = clock();
				return;
			}
			fingers.push({ ...finger, at: clock() });
		},

		move(finger) {
			const held = find(finger.id);
			if (!held) {
				// A finger nobody saw land, which can only be one this pool dropped while
				// the hand still had it: adopt it, and move nothing on the way in.
				fingers.push({ ...finger, at: clock() });
				return { kind: "idle" };
			}
			const was = bare(held);
			held.x = finger.x;
			held.y = finger.y;
			held.at = clock();

			if (fingers.length >= 2) {
				const [first, second] = fingers as [Held, Held];
				// The pair as it was, which for the finger that did not move is where it
				// still is. Both copies, so the caller cannot be handed live objects.
				const from: [Finger, Finger] = [
					first.id === was.id ? was : bare(first),
					second.id === was.id ? was : bare(second),
				];
				return { kind: "pinch", from, to: [bare(first), bare(second)] };
			}

			return { kind: "pan", dx: held.x - was.x, dy: held.y - was.y };
		},

		up(id) {
			const index = fingers.findIndex((finger) => finger.id === id);
			if (index >= 0) fingers.splice(index, 1);
		},

		ids: () => fingers.map((finger) => finger.id),
		count: () => fingers.length,
		clear: () => fingers.splice(0, fingers.length),
	};
}
