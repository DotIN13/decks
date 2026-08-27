import type { Board } from "@decks/protocol";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { paintFrame } from "../lib/theme.ts";

/**
 * The rail: every board in the deck, small.
 *
 * There is no thumbnail service, by design (DESIGN §6.6) — a rail item is the
 * board itself, scaled down, mounted when it scrolls into view. That means a
 * thumbnail is never stale and never a job that has to finish before you can see
 * your deck. The cost is a live document per item, so two things bound it: only
 * what is near the visible part of the list mounts, and a board can hand over a
 * `<meta name="poster">` image instead, which is the escape hatch for one that is
 * expensive to render.
 *
 * "Near the visible part" used to be "among the first eight", which is not the same
 * thing: past the eighth board the thumbnail stayed blank however far you scrolled.
 * The bound now comes from the geometry — what fits in the list box plus a screen of
 * margin — so it holds for a deck of four boards or four hundred, and it follows the
 * scroll instead of the array.
 *
 * From M3 this shows the focused agent's context set rather than the whole deck.
 */
const WIDTH = 150;

export function BoardRail(props: {
	boards: Board[];
	current?: string;
	/** Whether these are the agent's held boards or just everything in the deck. */
	held?: boolean;
	/** Which of them the agent has put on the canvas. */
	inPlay?: string[];
	onPick: (board: Board) => void;
}) {
	return (
		<section class="rail">
			<div class="rail-head" title={props.held ? "Boards the agent is holding in context" : "Every board in the deck"}>
				<span>{props.held ? "in context" : "boards"}</span>
				<span>{props.boards.length}</span>
			</div>
			<div class="items">
				<For each={props.boards}>
					{(board) => (
						<RailItem
							board={board}
							current={props.current === board.path}
							// Held but not on the canvas: the agent is working from it without
							// asking the user to look at it.
							offCanvas={Boolean(props.held) && !(props.inPlay ?? []).includes(board.path)}
							onPick={() => props.onPick(board)}
						/>
					)}
				</For>
			</div>
		</section>
	);
}

function RailItem(props: { board: Board; current: boolean; offCanvas?: boolean; onPick: () => void }) {
	let host!: HTMLDivElement;
	const [near, setNear] = createSignal(false);

	onMount(() => {
		const observer = new IntersectionObserver(
			// Tracked rather than latched: a `near` that only ever turns on means every
			// item scrolled past stays a live document for the rest of the session, so the
			// cost of a long rail grows with how much of it you have looked at. The margin
			// is what stops this thrashing — an item just off the edge stays mounted.
			(entries) => {
				for (const entry of entries) setNear(entry.isIntersecting);
			},
			{ root: host.closest(".items"), rootMargin: "300px" },
		);
		observer.observe(host);
		onCleanup(() => observer.disconnect());
	});

	const scale = () => WIDTH / Math.max(1, props.board.w);
	const live = () => near() && !props.board.poster;

	/**
	 * The revision the thumbnail is showing, brought up to date on a trailing delay.
	 *
	 * A thumbnail is a second copy of the document, so unlike the stage frame it has no
	 * live DOM to preserve — it genuinely has to reload to show an edit. But it reloads
	 * the *whole* board, libraries included, and a component drag produces a new revision
	 * on every drop. Following each one made dragging something around cost a full
	 * document load per drop, flashing in the rail. Coalescing means one reload after the
	 * hand comes to rest, which is all a thumbnail is for.
	 */
	const [shownRev, setShownRev] = createSignal(props.board.rev);
	let settle: ReturnType<typeof setTimeout> | undefined;
	createEffect(() => {
		const rev = props.board.rev;
		if (rev === shownRev()) return;
		clearTimeout(settle);
		settle = setTimeout(() => setShownRev(rev), 400);
	});
	onCleanup(() => clearTimeout(settle));

	return (
		<button
			class="rail-item"
			data-current={props.current}
			data-off-canvas={props.offCanvas}
			title={props.offCanvas ? `${props.board.title} — held, not on the canvas. Click to show it.` : props.board.title}
			onClick={() => props.onPick()}
			type="button"
		>
			<div class="thumb" ref={host}>
				<Show when={props.board.poster}>
					{(poster) => <img src={deckFileUrl(poster(), props.board.rev)} alt={props.board.title} style={{ width: "100%" }} />}
				</Show>
				<Show when={live()}>
					<iframe
						title={`${props.board.title} (thumbnail)`}
						src={boardUrl({ path: props.board.path, rev: shownRev() })}
						width={props.board.w}
						height={props.board.h}
						referrerpolicy="no-referrer"
						// Scaled rather than re-rendered small: the board decides how it
						// looks, and a thumbnail is the same board seen from further away.
						style={{ transform: `scale(${scale()})` }}
						scrolling="no"
						onLoad={(event) => paintFrame(event.currentTarget)}
					/>
				</Show>
			</div>
			<div class="label">
				<div>{props.board.title}</div>
				<div class="file">{props.board.path}</div>
			</div>
		</button>
	);
}
