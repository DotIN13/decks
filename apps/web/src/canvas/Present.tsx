import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Board } from "@decks/protocol";
import { type DeckHandle, slideKey } from "./slide-keys.ts";

/**
 * A deck, fullscreen.
 *
 * ### It is an overlay first, and the browser's Fullscreen API second
 *
 * A fixed layer over everything, and *then* a best-effort `requestFullscreen` on top. That
 * order rather than the other way round, and not as a fallback:
 *
 * - the keyboard handling and the way out have to live here regardless;
 * - the API needs a user gesture and can simply be refused — in an iframe without
 *   `allow="fullscreen"`, always — and a presentation that sometimes does not open is worse
 *   than one that never uses the API;
 * - an overlay can be screenshotted and a real fullscreen frame cannot, which is what lets
 *   a deck have a poster later.
 *
 * ### Another frame of the same board
 *
 * Rather than moving the canvas's frame or re-implementing the slide view, this mounts a
 * second iframe on the same board URL. `slides.js` runs in it and scales to the window, so
 * the slide is *identical* to the one on the canvas — same logical 960×540, different
 * `--fit` — which is the whole promise of a fixed-size slide. The canvas keeps its own
 * frame, its own camera and its own current slide untouched behind the overlay, so leaving
 * puts you back exactly where you were.
 *
 * The slide you were on is carried across on load, because arriving at slide one when you
 * pressed `f` on slide seven is the kind of thing that makes a presenter stop using a tool
 * mid-talk.
 */
export function Present(props: {
	board: Board;
	/** The slide the canvas was showing, so fullscreen opens on it rather than on the first. */
	at: number;
	onExit: () => void;
	/** Where the deck ended up, so the canvas can follow rather than snapping back. */
	onLeave?: (at: number) => void;
}) {
	let frameEl: HTMLIFrameElement | undefined;
	let layerEl: HTMLDivElement | undefined;
	const [at, setAt] = createSignal(props.at);
	const [total, setTotal] = createSignal(props.board.format === "slides" ? 0 : 0);
	const [idle, setIdle] = createSignal(true);

	const deck = (): DeckHandle | undefined => (frameEl?.contentWindow as { __deck?: DeckHandle } | null)?.__deck;

	/**
	 * Poll for the handle rather than waiting for a message.
	 *
	 * `slides.js` sets `window.__deck` after it has fetched the file and rendered the first
	 * slide, which is some way after `load`. A board makes this app no promises — the same
	 * reasoning `BoardFrame`'s extent polling is built on — so a few checks that come to
	 * nothing is the right price.
	 */
	const ready = () => {
		let left = 150;
		const attempt = () => {
			const handle = deck();
			if (handle) {
				handle.setMode("stage");
				if (props.at > 0) handle.go(props.at);
				setTotal(handle.total);
				setAt(handle.current());
				return;
			}
			if (left-- > 0) timer = window.setTimeout(attempt, 40);
		};
		let timer = window.setTimeout(attempt, 0);
		onCleanup(() => clearTimeout(timer));
	};

	const act = (event: KeyboardEvent) => {
		const action = slideKey(event, "fullscreen");
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		if (action === "exit") {
			leave();
			return;
		}
		const handle = deck();
		if (!handle) return;
		if (action === "next") handle.next();
		else if (action === "prev") handle.prev();
		else if (action === "first") handle.first();
		else if (action === "last") handle.last();
		setAt(handle.current());
	};

	const leave = () => {
		props.onLeave?.(deck()?.current() ?? at());
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		props.onExit();
	};

	/*
	 * Focus the overlay, and only once it is in the document.
	 *
	 * `onMount` rather than the `ref` callback, which is the bug this replaces: a `ref` fires
	 * before Solid inserts the element, and `focus()` on a detached node does nothing at all
	 * — so the focus stayed inside the *canvas's* board frame, that frame received ← → and
	 * Space, and nothing paged. `requestFullscreen` failed silently for the same reason.
	 *
	 * The focus has to be here rather than on the frame: an iframe that has it receives the
	 * keystrokes itself, and a board document has no idea it is being presented. The frame is
	 * `pointer-events: none` in CSS so a click on the slide cannot hand it back.
	 */
	onMount(() => {
		layerEl?.focus();
		// Best effort, and deliberately unawaited: a refusal is not a failure, because the
		// overlay already *is* the presentation.
		void layerEl?.requestFullscreen?.().catch(() => {});
	});

	/*
	 * Captured on the window, and in the capture phase.
	 *
	 * The keystroke has to be taken before anything else sees it: the canvas is still
	 * mounted behind this overlay with its own handler on the same window, and Escape in
	 * particular has three other owners. Capture is what makes "the overlay is up" mean
	 * "the overlay decides first" without adding a precedence flag to every other handler.
	 */
	createEffect(() => {
		window.addEventListener("keydown", act, true);
		onCleanup(() => window.removeEventListener("keydown", act, true));
	});

	/*
	 * The chrome hides until the pointer moves. A presentation with permanent buttons on it
	 * is a demo of a tool rather than a talk — but a person who has just pressed a button to
	 * get here needs to be able to find the way back out, so any movement brings it back.
	 */
	createEffect(() => {
		let timer: number | undefined;
		const wake = () => {
			setIdle(false);
			clearTimeout(timer);
			timer = window.setTimeout(() => setIdle(true), 2000);
		};
		window.addEventListener("pointermove", wake);
		onCleanup(() => {
			window.removeEventListener("pointermove", wake);
			clearTimeout(timer);
		});
	});

	return (
		<div
			class="present"
			data-idle={idle()}
			tabIndex={-1}
			ref={(element) => {
				layerEl = element;
				/*
				 * Focus the overlay, not the frame inside it.
				 *
				 * An iframe that has the focus receives the keystrokes, and this one is a
				 * board document with no idea it is being presented — so ← → and Space went
				 * into it and nothing paged. The frame is also made non-interactive in CSS,
				 * so a click on the slide cannot move the focus back into it: during a
				 * presentation there is nothing in a slide to click anyway.
				 */
				element.focus();
				// Best effort, and deliberately unawaited: a refusal is not a failure here,
				// because the overlay is already the presentation.
				void layerEl?.requestFullscreen?.().catch(() => {});
			}}
			role="dialog"
			aria-label={`${props.board.title} — presenting`}
		>
			<iframe
				class="present-frame"
				title={props.board.title}
				src={`/api/board/${props.board.path}?present=1&rev=${props.board.rev}`}
				ref={(element) => {
					frameEl = element;
					element.addEventListener("load", ready);
				}}
			/>
			<div class="present-bar">
				<button type="button" class="present-step" onClick={() => { deck()?.prev(); setAt(deck()?.current() ?? 0); }} aria-label="Previous slide">
					‹
				</button>
				<Show when={total() > 0}>
					<span class="present-count">
						{at() + 1} / {total()}
					</span>
				</Show>
				<button type="button" class="present-step" onClick={() => { deck()?.next(); setAt(deck()?.current() ?? 0); }} aria-label="Next slide">
					›
				</button>
				<button type="button" class="present-exit" onClick={leave} aria-label="Stop presenting">
					Esc
				</button>
			</div>
		</div>
	);
}
