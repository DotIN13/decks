import type { Board } from "@decks/protocol";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { claimThumb } from "../canvas/thumb-budget.ts";
import { BoardPicture } from "./BoardPicture.tsx";
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { paintFrame } from "../lib/theme.ts";

/** The width a thumbnail is drawn at, which is what its scale is computed from. */
const WIDTH = 150;

/*
 * What is left of the board rail: one tile.
 *
 * The panel that used to wrap these is gone — `chrome/LeftPanel` replaced it, along with
 * the agents panel beside it and the full-screen browser over it. The file keeps its name
 * and `.rail-item` keeps its class, because both are load-bearing elsewhere, and renaming a
 * selector to tidy a file is how a green suite stops meaning anything.
 */

/**
 * One board, as a tile: the server's picture of it over its title.
 *
 * The picture is `BoardPicture`, the same one a gallery card and a row draw. A tile used to
 * be the board itself, mounted in an iframe and scaled down, and then photographed by this
 * browser with `modern-screenshot` so the next look was cheaper. Both are gone as the normal
 * path: the server's picture is Chromium's own, exists before anybody has opened the board,
 * and is retaken when the board changes, with the last one left up meanwhile.
 *
 * **The live document is what is left for a server that cannot take pictures** (no Chromium
 * on the machine): the poster the board offered if there is one, and otherwise the board in
 * an iframe, which is what `thumb-budget.ts` and the observer below are still for. It roots
 * its observer at the nearest `.items`, so any scroller reusing it should carry that class.
 */
export function RailItem(props: { board: Board; current: boolean; offCanvas?: boolean; onPick: () => void }) {
	let host!: HTMLDivElement;
	const budget = claimThumb();

	onMount(() => {
		const observer = new IntersectionObserver(
			// Tracked rather than latched: a `near` that only ever turns on means every item
			// scrolled past stays a live document for the rest of the session, so the cost of a
			// long rail grows with how much of it you have looked at.
			//
			// This says who is live; `thumb-budget.ts` says how many may *start* at once. The
			// margin is one row rather than 300px, which in a grid was every item at once — the
			// modal fits twenty-four boards inside 400px, so "near" meant "all of them".
			(entries) => {
				for (const entry of entries) budget.want(entry.isIntersecting);
			},
			{ root: host.closest(".items"), rootMargin: "120px" },
		);
		observer.observe(host);
		onCleanup(() => observer.disconnect());
	});

	const scale = () => WIDTH / Math.max(1, props.board.w);
	/* A poster is an image, so there is no document to wait for: the loading budget is handed
	   straight back, or a screen of posters would hold it shut against the boards that need it. */
	const live = () => budget.live() && !props.board.poster;
	createEffect(() => {
		if (props.board.poster && budget.live()) budget.loaded();
	});

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

	/* Only ever mounted when the server has refused a picture, so the observer's answer and the
	   budget cost nothing on a machine that has Chromium. */
	const Fallback = () => (
		<>
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
					onLoad={(event) => {
						paintFrame(event.currentTarget);
						// Frees the loading budget for whoever is queued behind this one.
						budget.loaded();
					}}
				/>
			</Show>
		</>
	);

	return (
		<button
			class="rail-item"
			/* Which board this is, for the same reason `.board-node` carries one: a tile shows a
			   picture and a title, so without this the only way to say "the tile for
			   `boards/plan.html`" is to match on prose. */
			data-path={props.board.path}
			data-current={props.current}
			data-off-canvas={props.offCanvas}
			title={props.offCanvas ? `${props.board.title} — held, not on the canvas. Click to show it.` : props.board.title}
			onClick={() => props.onPick()}
			type="button"
		>
			<div class="thumb" ref={host}>
				<BoardPicture
					board={props.board}
					alt={`${props.board.title} (thumbnail)`}
					fallback={<Fallback />}
				/>
			</div>
			<div class="label">
				<div>{props.board.title}</div>
				<div class="file">{props.board.path}</div>
			</div>
		</button>
	);
}
