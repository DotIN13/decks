import type { Board, Camera, Identity } from "@decks/protocol";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

/**
 * "Sable put up The result · Go": the one way an agent reaches your view on a shared canvas.
 *
 * On a canvas several agents work on, an agent putting a board up does not move the camera —
 * it would take the view away from whoever is reading, every time anybody showed anything. So
 * the board lands in its place and this chip says who put it there, in their colour, with a
 * button that flies to it. It goes away on its own after a while, because a board that nobody
 * went to look at is still on the canvas and still findable; the chip is news, not a queue.
 */
export function ArrivalChip(props: {
	arrival: { agentId: string; path: string; camera: Camera; at: number } | undefined;
	identities: Record<string, Identity>;
	boards: Board[];
	onGo: (camera: Camera, path: string) => void;
	onDismiss: () => void;
}) {
	const [now, setNow] = createSignal(Date.now());
	createEffect(() => {
		if (!props.arrival) return;
		const timer = setTimeout(() => {
			setNow(Date.now());
			props.onDismiss();
		}, LINGER_MS);
		onCleanup(() => clearTimeout(timer));
	});
	const who = () => (props.arrival ? props.identities[props.arrival.agentId] : undefined);
	const title = () => props.boards.find((board) => board.path === props.arrival?.path)?.title ?? props.arrival?.path ?? "";
	const live = () => props.arrival !== undefined && now() - props.arrival.at < LINGER_MS;

	return (
		<Show when={live() && props.arrival}>
			{(arrival) => (
				<div class="arrival-chip" role="status" style={{ "--agent": who()?.color ?? "var(--color-accent)" }}>
					<span class="arrival-dot" aria-hidden="true" />
					<span class="arrival-text">
						<b>{who()?.name ?? "An agent"}</b> put up {title()}
					</span>
					<button type="button" class="arrival-go" onClick={() => props.onGo(arrival().camera, arrival().path)}>
						Go
					</button>
					<button type="button" class="arrival-close" aria-label="Dismiss" onClick={() => props.onDismiss()}>
						×
					</button>
				</div>
			)}
		</Show>
	);
}

/** Long enough to notice and press; short enough that a stale chip does not pile up. */
const LINGER_MS = 12_000;
