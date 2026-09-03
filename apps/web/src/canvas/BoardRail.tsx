import type { Board } from "@decks/protocol";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { claimThumb } from "./thumb-budget.ts";
import { hasPicture, picture, takePicture } from "./thumb-cache.ts";

/** How long after load to let `board.js` finish drawing before photographing a board. */
const SETTLE = 700;

/**
 * `requestIdleCallback`, or a timer where there is none (Safari).
 *
 * The timeout is what stops a busy tab from never taking a picture at all, and the fallback
 * is deliberately longer than the settle: without idle to wait for, later is better.
 */
const whenIdle = (run: () => void): number =>
	typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 4000 }) : (setTimeout(run, 1500) as unknown as number);
const cancelWhenIdle = (handle: number): void => {
	if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
	else clearTimeout(handle);
};
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { paintFrame } from "../lib/theme.ts";

/** The width a thumbnail is drawn at, which is what its scale is computed from. */
const WIDTH = 150;

/*
 * What is left of the board rail: one thumbnail.
 *
 * The panel that used to wrap these is gone — `chrome/LeftPanel` replaced it, along with
 * the agents panel beside it and the full-screen browser over it. What could not go is
 * this: a thumbnail here is the board itself, mounted in an iframe, left to finish drawing
 * its markdown and maths, and photographed on idle into `thumb-cache`. That is the only
 * thing in the app that fills the cache, and every 20x14 row in the panel draws from it.
 *
 * The file keeps its name and `.rail-item` keeps its class, because both are load-bearing
 * elsewhere — the thumbnail checks address them, and renaming a selector to tidy a file is
 * how a green suite stops meaning anything.
 */

/**
 * One board, drawn as itself.
 *
 * Exported because the all-canvases modal (`AllBoards`) shows the same thing — a board is a
 * board whether you found it in the context panel or by searching the deck, and two ways of
 * drawing one is two things to keep in step. It roots its observer at the nearest `.items`,
 * so any scroller reusing it should carry that class; without one it falls back to the
 * viewport, which over-mounts a little rather than breaking.
 *
 * `cache` opts it into photographs (`thumb-cache.ts`): the browse modal sets it, the context
 * panel does not. There the boards are the ones an agent is rewriting, so a picture would be
 * out of date before it landed and re-taken on every revision — a live document costs one
 * document and is right by construction.
 */
export function RailItem(props: { board: Board; current: boolean; offCanvas?: boolean; cache?: boolean; onPick: () => void }) {
	let host!: HTMLDivElement;
	let frame: HTMLIFrameElement | undefined;
	const budget = claimThumb();
	/** The photograph of this exact revision, if one has been taken. */
	const shot = () => (props.cache ? picture(props.board) : undefined);

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
	/*
	 * A poster is an image the board offered instead of itself, and a photograph is one this
	 * app took — either way there is no document to mount, and `loaded()` is reported straight
	 * away or a screen of them would hold the loading budget shut against the boards that do
	 * need it.
	 */
	const live = () => budget.live() && !props.board.poster && !shot();
	createEffect(() => {
		if ((props.board.poster || shot()) && budget.live()) budget.loaded();
	});

	/*
	 * The photograph is taken on idle, once the document has settled.
	 *
	 * On idle because it is ~160ms of main thread — small enough for the browser to fit into a
	 * gap, and not small enough to spend during a scroll. After a settle because `board.js`
	 * renders markdown, maths and diagrams *after* load, so a picture taken on the load event
	 * is a picture of a board half-drawn.
	 *
	 * Taken while the thumbnail is still live rather than as it is released, which was the
	 * other candidate: releasing would have to wait for the picture, so the document it was
	 * meant to dispose of would live *longer* than before. This reaches the same cache and
	 * disposes on time.
	 */
	createEffect(() => {
		if (!props.cache || !ready() || hasPicture(props.board)) return;
		const board = props.board;
		let idle: number | undefined;
		const settle = setTimeout(() => {
			idle = whenIdle(() => {
				if (frame?.contentDocument) void takePicture(frame, board);
			});
		}, SETTLE);
		onCleanup(() => {
			clearTimeout(settle);
			if (idle !== undefined) cancelWhenIdle(idle);
		});
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
	/** Whether this thumbnail's document has finished loading, so it can be photographed. */
	const [ready, setReady] = createSignal(false);
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
				<Show when={props.board.poster}>
					{(poster) => <img src={deckFileUrl(poster(), props.board.rev)} alt={props.board.title} style={{ width: "100%" }} />}
				</Show>
				{/* A photograph of this revision: no document, and exactly as fresh as the file. */}
				<Show when={shot()}>
					{(src) => <img class="thumb-shot" src={src()} alt={`${props.board.title} (thumbnail)`} style={{ width: "100%" }} />}
				</Show>
				<Show when={live()}>
					<iframe
						ref={frame}
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
							setReady(true);
						}}
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
