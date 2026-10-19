import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";

/**
 * An agent's cursor: an arrow with its name tag, the way a design tool draws a collaborator's.
 *
 * Four behaviours, each for a reason a person watching would give:
 *
 * - **Drift, 380 ms.** A cursor never teleports; it eases to the new point on the app's own
 *   curve (a CSS transition on `left`/`top`, in the board's coordinates). A jump longer than a
 *   screen fades out and back in instead, because a streak across the canvas reads as a glitch.
 * - **Breathe, 3.2 s.** At rest the arrow rises and falls a little. A still agent is still
 *   working, and a dead arrow says it is not.
 * - **Act, 520 ms.** One ring out of the tip when it arrives somewhere — the only loud thing it
 *   does, so it means something.
 * - **Stay.** It is drawn one level up, on the stage (`Stage.tsx`), for as long as the agent is
 *   working, so it glides from one board or drawn item to the next instead of leaving one and
 *   appearing on the other, and its name stays beside it.
 *
 * And it leaves with a 600 ms fade rather than vanishing mid-sentence. Counter-scaled like the
 * title bars (`--zoom`), so it is one size on the screen at any zoom. Reduced motion keeps the
 * position and the name and drops everything that moves.
 */
export interface CursorAt {
	x: number;
	y: number;
	label: string;
	color: string;
	/** What the cursor arrived for, such as the act's clock: a new one rings again at the same place. */
	key?: number;
}

const DRIFT_MS = 380;
const LEAVE_MS = 600;
/** Past this many screen pixels a move is a jump: faded, not drifted. */
const JUMP_PX = 1200;

export function AgentCursor(props: { cursor: CursorAt | null | undefined; zoom: number }) {
	const [shown, setShown] = createSignal<CursorAt | undefined>(props.cursor ?? undefined);
	const [moving, setMoving] = createSignal(false);
	const [jumped, setJumped] = createSignal(false);
	const [ping, setPing] = createSignal(0);
	const [gone, setGone] = createSignal(false);
	let timers: ReturnType<typeof setTimeout>[] = [];
	const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
	const clear = () => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
	};
	onCleanup(clear);

	createEffect(
		on(
			/*
			 * A plain snapshot, not the object handed in. The cursor comes out of a store, and a
			 * store *merges* a new value into the one it has, so "the previous cursor" would be the
			 * same object with the new numbers already in it — every move would look like standing
			 * still. Reading the fields here also makes the effect run when only a field changed.
			 */
			(): CursorAt | undefined => (props.cursor ? { x: props.cursor.x, y: props.cursor.y, label: props.cursor.label, color: props.cursor.color, ...(props.cursor.key === undefined ? {} : { key: props.cursor.key }) } : undefined),
			(next, previous) => {
				// Nothing it shows changed: something else in the store did. Leave its timers alone.
				if (next && previous && next.x === previous.x && next.y === previous.y && next.key === previous.key && next.label === previous.label && next.color === previous.color && !gone()) return;
				if (!next && !previous) return;
				clear();
				if (!next) {
					// Leaving: fade the last place out, then drop it.
					if (!shown()) return;
					setGone(true);
					later(LEAVE_MS, () => {
						setShown(undefined);
						setGone(false);
					});
					return;
				}
				setGone(false);
				const before = previous ?? undefined;
				const far = before ? Math.hypot(next.x - before.x, next.y - before.y) * props.zoom > JUMP_PX : false;
				const same = before !== undefined && before.x === next.x && before.y === next.y;
				setJumped(far);
				setMoving(!far && !same && before !== undefined);
				setShown(next);
				// Arrived: one ring, then quiet after a while with nothing new.
				later(same || far ? 0 : DRIFT_MS, () => {
					setMoving(false);
					setJumped(false);
					setPing((n) => n + 1);
				});
			},
		),
	);

	return (
		<Show when={shown()}>
			{(cursor) => (
				<div
					class="agent-cursor"
					data-moving={moving() ? "true" : undefined}
					data-jump={jumped() ? "true" : undefined}
					data-gone={gone() ? "true" : undefined}
					style={{
						left: `${cursor().x}px`,
						top: `${cursor().y}px`,
						"--zoom": props.zoom,
						"--cursor-color": cursor().color,
					}}
				>
					{/* Keyed on the count so each arrival starts the ring from the beginning. */}
					<Show when={ping() > 0 ? ping() : undefined} keyed>
						{(count) => <span class="ring" data-count={count} />}
					</Show>
					<svg class="arrow" viewBox="0 0 22 24" width="22" height="24" aria-hidden="true">
						<path d="M3 2.5 L19 10.4 Q19.9 10.9 18.9 11.3 L11.9 13.4 Q11.4 13.6 11.1 14.1 L7.6 20.8 Q7.1 21.6 6.8 20.7 Z" />
					</svg>
					<span class="label">{cursor().label}</span>
				</div>
			)}
		</Show>
	);
}
