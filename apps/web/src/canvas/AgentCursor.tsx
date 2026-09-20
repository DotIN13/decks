import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";

/**
 * An agent's cursor: it drifts, it breathes, and it puts its name away.
 *
 * Four behaviours, each for a reason a person watching would give:
 *
 * - **Drift, 380 ms.** A cursor never teleports; it eases to the new point on the app's own
 *   curve (a CSS transition on `left`/`top`, in the board's coordinates). A jump longer than a
 *   screen fades out and back in instead, because a streak across the canvas reads as a glitch.
 * - **Breathe, 3.2 s.** At rest the dot rises and falls and its halo swells. A still agent is
 *   still working, and a dead dot says it is not.
 * - **Act, 520 ms.** One ring out of the dot when it arrives somewhere — the only loud thing it
 *   does, so it means something.
 * - **Put the name away after 2.5 s.** The label shrinks into the dot when nothing happens and
 *   comes back the moment it moves. Four agents on one canvas is four names otherwise.
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
}

const DRIFT_MS = 380;
const QUIET_MS = 2500;
const LEAVE_MS = 600;
/** Past this many screen pixels a move is a jump: faded, not drifted. */
const JUMP_PX = 1200;

export function AgentCursor(props: { cursor: CursorAt | null | undefined; zoom: number }) {
	const [shown, setShown] = createSignal<CursorAt | undefined>(props.cursor ?? undefined);
	const [moving, setMoving] = createSignal(false);
	const [quiet, setQuiet] = createSignal(false);
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
			(): CursorAt | undefined => (props.cursor ? { x: props.cursor.x, y: props.cursor.y, label: props.cursor.label, color: props.cursor.color } : undefined),
			(next, previous) => {
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
				setQuiet(false);
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
				later(QUIET_MS, () => setQuiet(true));
			},
		),
	);

	return (
		<Show when={shown()}>
			{(cursor) => (
				<div
					class="agent-cursor"
					data-moving={moving() ? "true" : undefined}
					data-quiet={quiet() ? "true" : undefined}
					data-jump={jumped() ? "true" : undefined}
					data-gone={gone() ? "true" : undefined}
					style={{
						left: `${cursor().x}px`,
						top: `${cursor().y}px`,
						"--zoom": props.zoom,
						"--cursor-color": cursor().color,
					}}
				>
					<span class="dot">
						<span class="halo" />
						{/* Keyed on the count so each arrival starts the ring from the beginning. */}
						<Show when={ping() > 0 ? ping() : undefined} keyed>
							{(count) => <span class="ring" data-count={count} />}
						</Show>
					</span>
					<span class="label">{cursor().label}</span>
				</div>
			)}
		</Show>
	);
}
