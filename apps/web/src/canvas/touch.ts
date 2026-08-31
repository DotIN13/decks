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
 */

export interface Finger {
	id: number;
	x: number;
	y: number;
}

export type TouchStep =
	/** Nothing to do: an unknown finger, or the first event of a new one. */
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
	count(): number;
	clear(): void;
}

/**
 * The fingers currently down, in the order they landed.
 *
 * Order matters for one reason: a pinch is read from the *first two*, so a third finger
 * joining does not reinterpret the gesture halfway. And because every step is measured
 * against stored positions that are always current, a finger arriving or leaving never
 * produces a jump — it only changes which pair the next step is read from.
 */
export function createTouches(): Touches {
	const fingers: Finger[] = [];
	const find = (id: number) => fingers.find((finger) => finger.id === id);

	return {
		down(finger) {
			const existing = find(finger.id);
			if (existing) {
				existing.x = finger.x;
				existing.y = finger.y;
				return;
			}
			fingers.push({ ...finger });
		},

		move(finger) {
			const held = find(finger.id);
			// A finger nobody saw land: a gesture that began before this document was
			// listening, or one the browser cancelled. It moves nothing.
			if (!held) return { kind: "idle" };
			const was = { ...held };
			held.x = finger.x;
			held.y = finger.y;

			if (fingers.length >= 2) {
				const [first, second] = fingers as [Finger, Finger];
				// The pair as it was, which for the finger that did not move is where it
				// still is. Both copies, so the caller cannot be handed live objects.
				const from: [Finger, Finger] = [
					first.id === was.id ? was : { ...first },
					second.id === was.id ? was : { ...second },
				];
				return { kind: "pinch", from, to: [{ ...first }, { ...second }] };
			}

			return { kind: "pan", dx: held.x - was.x, dy: held.y - was.y };
		},

		up(id) {
			const index = fingers.findIndex((finger) => finger.id === id);
			if (index >= 0) fingers.splice(index, 1);
		},

		count: () => fingers.length,
		clear: () => fingers.splice(0, fingers.length),
	};
}
