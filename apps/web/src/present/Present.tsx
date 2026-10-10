import { api } from "../connections/connection.ts";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Board } from "@decks/protocol";
import { type DeckHandle, slideKey } from "./slide-keys.ts";
import { enterFullscreen, exitFullscreen, onFullscreenLeft } from "./fullscreen.ts";
import { attachBoardOpen } from "../board/board-links.ts";
import { attachBoardEval } from "../board/board-eval.ts";
import { lendFrame } from "../canvas/borrow.ts";
import { SPRING_BACK_MS, SPRING_BACK_RESPONSE, SPRING_MS, springEasing } from "../app/spring.ts";
import { reducedMotion } from "../state/camera.ts";

/**
 * A board, fullscreen.
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
 * second iframe on the same board URL — so the canvas keeps its own frame, its own camera
 * and its own current slide untouched behind the overlay, and leaving puts you back exactly
 * where you were.
 *
 * ### Every format, and one decision per format
 *
 * This was decks only, gated on `format === "slides"` in three places. None of the
 * machinery above is slide-specific — an overlay and a second frame are what fill a window
 * with anything — so what is left per format is **the keyboard** and **how big the frame
 * is**, and both are stated here rather than assumed:
 *
 * | | frame | keys |
 * |---|---|---|
 * | slides | the slide's own 16:9, letterboxed | the overlay owns them: ← → Space page the deck |
 * | flow | the window; the document scrolls in it | the document's, so ↑ ↓ PageDown scroll it |
 * | component | the board's own rectangle, at 1:1, centred | the board's — it may have buttons |
 *
 * Escape is the overlay's in every case, and the only key that is. For a document that is
 * also the *only* key it takes, which is why the listener is installed **inside the frame**
 * as well: a keystroke with the focus in a board's document is dispatched there and never
 * reaches this window at all, so an Escape handled only here would work in a deck (whose
 * frame takes no pointer events and cannot take the focus) and quietly fail in a document.
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
	/**
	 * A link **on** this board that points at another board (`board/board-links.ts`).
	 *
	 * The overlay draws its own frame rather than a `BoardFrame`, so it has to wire the same
	 * ask up from the board's document. `true` means the board is on the canvas and this exits
	 * the presentation, because the canvas is underneath the overlay and a board opened behind
	 * it is a board nobody sees.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/** A component on the presented board carrying code was pressed (`board/board-eval.ts`). */
	onBoardEval?: (path: string, id: string, value: unknown) => void;
}) {
	let frameEl: HTMLIFrameElement | undefined;
	let layerEl: HTMLDivElement | undefined;
	const slides = () => props.board.format === "slides";
	const [at, setAt] = createSignal(props.at);
	const [total, setTotal] = createSignal(0);
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
		// Escape is everyone's. Everything else in this table belongs to the format, and to
		// a document that means "nothing here takes it".
		if (action === "exit") {
			event.preventDefault();
			event.stopPropagation();
			leave();
			return;
		}
		if (!slides()) return;
		event.preventDefault();
		event.stopPropagation();
		const handle = deck();
		if (!handle) return;
		if (action === "next") handle.next();
		else if (action === "prev") handle.prev();
		else if (action === "first") handle.first();
		else if (action === "last") handle.last();
		setAt(handle.current());
	};

	/*
	 * Opening and closing, the way iOS opens an app from its icon: the board grows out of its place on
	 * the canvas into the screen on a spring, while the black comes up behind it, and closing is the
	 * same thing back into its place. With no place to grow from (the board is off screen) it rises
	 * from slightly smaller instead. Nothing moves with reduced motion.
	 */
	const placeOnCanvas = () => {
		const box = document.querySelector(`.world .board-node[data-path="${CSS.escape(props.board.path)}"] > .surface`)?.getBoundingClientRect();
		return box && box.width > 1 && box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth ? box : undefined;
	};
	/** What moves: the scaled board's box, or the frame itself when it has no box of its own. */
	const moving = (): HTMLElement | undefined => (fitEl?.getAttribute("style") ? fitEl : frameEl);
	const fromPlace = (target: HTMLElement, place: DOMRect | undefined): Keyframe => {
		const now = target.getBoundingClientRect();
		if (!place || now.width < 1 || now.height < 1) return { transform: "scale(0.94)", opacity: 0, transformOrigin: "50% 50%" };
		return {
			transform: `translate(${place.left - now.left}px, ${place.top - now.top}px) scale(${place.width / now.width}, ${place.height / now.height})`,
			opacity: 1,
			transformOrigin: "0 0",
		};
	};
	const settled = (origin: string): Keyframe => ({ transform: "none", opacity: 1, transformOrigin: origin });
	const opening = (place: DOMRect | undefined) => {
		if (reducedMotion()) return;
		const target = moving();
		if (!target) return;
		const start = fromPlace(target, place);
		target.animate([start, settled(String(start.transformOrigin))], { duration: SPRING_MS, easing: springEasing(SPRING_MS) });
		layerEl?.animate([{ backgroundColor: "rgb(11 13 16 / 0)" }, { backgroundColor: "rgb(11 13 16 / 1)" }], { duration: 300, easing: "ease-out" });
	};

	/** Once, whichever way out arrives first — see `present/fullscreen.ts` and each caller. */
	let left = false;
	const leave = () => {
		if (left) return;
		left = true;
		props.onLeave?.(deck()?.current() ?? at());
		exitFullscreen(document);
		const target = moving();
		if (reducedMotion() || !target || !layerEl) {
			props.onExit();
			return;
		}
		// After the window has left fullscreen, so the place it goes back to is where it will be.
		layerEl.style.pointerEvents = "none";
		requestAnimationFrame(() => {
			const end = fromPlace(target, placeOnCanvas());
			const back = target.animate([settled(String(end.transformOrigin)), end], { duration: SPRING_BACK_MS, easing: springEasing(SPRING_BACK_MS, SPRING_BACK_RESPONSE), fill: "forwards" });
			layerEl?.animate([{ backgroundColor: "rgb(11 13 16 / 1)" }, { backgroundColor: "rgb(11 13 16 / 0)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
			let gone = false;
			const exit = () => {
				if (gone) return;
				gone = true;
				props.onExit();
			};
			back.finished.then(exit, exit);
			// However the animation ends, the overlay goes.
			window.setTimeout(exit, SPRING_BACK_MS + 120);
		});
	};

	/*
	 * Focus, and only once the element is in the document.
	 *
	 * `onMount` rather than the `ref` callback, which is the bug this replaces: a `ref` fires
	 * before Solid inserts the element, and `focus()` on a detached node does nothing at all
	 * — so the focus stayed inside the *canvas's* board frame, that frame received ← → and
	 * Space, and nothing paged. `requestFullscreen` failed silently for the same reason.
	 *
	 * **Which** thing gets the focus is the per-format decision with teeth. A deck's overlay
	 * takes it, because an iframe that has it receives the keystrokes itself and a deck has
	 * no idea it is being presented. A flow document wants exactly the opposite: it has its
	 * own scroll position, so the arrows have to reach *it*. A component board likewise —
	 * it may have buttons on it.
	 */
	onMount(() => {
		if (slides()) layerEl?.focus();
		else frameEl?.focus();
		enterFullscreen(layerEl);
	});

	/*
	 * The chrome hides until the pointer moves. A presentation with permanent buttons on it
	 * is a demo of a tool rather than a talk — but a person who has just pressed a button to
	 * get here needs to be able to find the way back out, so any movement brings it back.
	 *
	 * A plain function with a module-scope timer rather than a signal and an effect: it is
	 * called from a listener, from the frame's document and from this one, and none of those
	 * is a reactive context.
	 */
	let wakeTimer: number | undefined;
	const wake = () => {
		setIdle(false);
		clearTimeout(wakeTimer);
		wakeTimer = window.setTimeout(() => setIdle(true), 2000);
	};

	/**
	 * The keys, in both places they can arrive.
	 *
	 * The window, in the capture phase: the canvas is still mounted behind this overlay with
	 * its own handler on the same window, and Escape in particular has three other owners.
	 * Capture is what makes "the overlay is up" mean "the overlay decides first" without
	 * adding a precedence flag to every other handler.
	 *
	 * And the frame's own document, because a keystroke that lands in a board never reaches
	 * this window. Same origin (§4), so it can just be listened for — and it is the whole
	 * reason Escape works in a document as well as in a deck.
	 */
	let frameListeners: (() => void) | undefined;
	let detachLinks: (() => void) | undefined;
	let detachEval: (() => void) | undefined;
	const listenInFrame = () => {
		const doc = frameEl?.contentDocument;
		if (!doc) return;
		doc.addEventListener("keydown", act, true);
		doc.addEventListener("pointermove", wake);
		// A tap is how a finger asks for the controls: a touch screen has no pointer moving over it.
		doc.addEventListener("pointerdown", wake);
		frameListeners = () => {
			doc.removeEventListener("keydown", act, true);
			doc.removeEventListener("pointermove", wake);
			doc.removeEventListener("pointerdown", wake);
		};
	};

	onMount(() => {
		window.addEventListener("keydown", act, true);
		window.addEventListener("pointermove", wake);
		window.addEventListener("pointerdown", wake);
		// The way out with no keystroke in it: the browser leaving fullscreen on its own, which
		// is what Escape does there — Chrome consumes it and the page never sees it.
		onCleanup(onFullscreenLeft(document, leave));
		onCleanup(() => {
			window.removeEventListener("keydown", act, true);
			window.removeEventListener("pointermove", wake);
			window.removeEventListener("pointerdown", wake);
			frameListeners?.();
			detachLinks?.();
			detachEval?.();
			clearTimeout(wakeTimer);
		});
	});

	/*
	 * A designed board fills the screen: scaled to the window's width or its height, whichever runs out
	 * first, and centred. A deck scales itself (`slides.js`), and a board that fills itself (one document,
	 * one file) or had to be wrapped in a shell is laid out at the window's size instead.
	 */
	const [screen, setScreen] = createSignal({ w: window.innerWidth, h: window.innerHeight });
	const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
	window.addEventListener("resize", onResize);
	onCleanup(() => window.removeEventListener("resize", onResize));
	const scaled = () => !slides() && !props.board.shell && !props.board.fills;
	const fit = () => Math.min(screen().w / Math.max(1, props.board.w), screen().h / Math.max(1, props.board.h));
	/** How the frame is drawn here: scaled to the screen, or the window's height at most the board's width. */
	const frameStyle = (): Record<string, string> | undefined =>
		scaled()
			? { width: `${props.board.w}px`, height: `${props.board.h}px`, transform: `scale(${fit()})`, "transform-origin": "0 0" }
			: /* One file or one document: centred, the window's height, and no wider than the board was made. */
				props.board.fills && !slides()
				? { width: `min(100vw, ${props.board.w}px)`, height: "100vh" }
				: undefined;

	/*
	 * The canvas's own page, moved here and back (`canvas/borrow.ts`), so the board is presented as it
	 * was left on the canvas and the canvas has it back the same way. A deck is the exception: it is
	 * presented in a mode of its own (`present=1`), so it gets its own page. So does a board the canvas
	 * has no page for within a few frames, and every board in a browser that cannot move a frame.
	 */
	let fitEl: HTMLDivElement | undefined;
	const [own, setOwn] = createSignal(slides());
	const [lentFrame, setLentFrame] = createSignal<HTMLIFrameElement>();
	onMount(() => {
		// Where the board is on the canvas, read before its page leaves it.
		const place = placeOnCanvas();
		// In the same frame the overlay first draws, so its finished layout never shows before the zoom.
		if (slides()) {
			opening(place);
			return;
		}
		let tries = 20;
		let id = 0;
		let lending: ReturnType<typeof lendFrame>;
		const attempt = () => {
			if (!fitEl) return;
			lending = lendFrame(props.board.path, fitEl);
			if (lending) {
				lending.frame.classList.add("present-frame");
				frameEl = lending.frame;
				setLentFrame(lending.frame);
				listenInFrame();
				// The keyboard goes into the page, as it does into a page of the overlay's own (`onMount` above).
				lending.frame.focus();
				opening(place);
				return;
			}
			if (tries-- > 0) id = requestAnimationFrame(attempt);
			else {
				setOwn(true);
				opening(place);
			}
		};
		attempt();
		onCleanup(() => {
			cancelAnimationFrame(id);
			frameListeners?.();
			frameListeners = undefined;
			lending?.frame.classList.remove("present-frame");
			// The closing animation holds its last frame; the canvas gets its page without it.
			for (const running of lending?.frame.getAnimations() ?? []) running.cancel();
			lending?.give();
		});
	});
	createEffect(() => {
		const frame = lentFrame();
		if (!frame) return;
		const style = frameStyle();
		for (const name of ["width", "height", "transform", "transform-origin"]) frame.style.removeProperty(name);
		for (const [name, value] of Object.entries(style ?? {})) frame.style.setProperty(name, value);
	});

	return (
		<div
			class="present"
			data-idle={idle()}
			data-format={props.board.format}
			/* A board that had to be wrapped in a shell has no measured height of its own, so it
			   is the one presented as a page that scrolls (`styles/canvas.css`). */
			data-shell={props.board.shell ?? (props.board.fills ? "fills" : undefined)}
			tabIndex={-1}
			ref={(element) => {
				layerEl = element;
				/*
				 * Focus the overlay, not the frame. See `onMount` — the same call, for the
				 * case where Solid's `ref` runs before the element is in the document.
				 */
				element.focus();
				enterFullscreen(layerEl);
			}}
			role="dialog"
			aria-label={`${props.board.title} — ${slides() ? "presenting" : "fullscreen"}`}
		>
			<div class="present-fit" ref={fitEl} style={scaled() ? { width: `${props.board.w * fit()}px`, height: `${props.board.h * fit()}px` } : undefined}>
			<Show when={own()}>
			<iframe
				class="present-frame"
				title={props.board.title}
				/*
				 * `present=1` is the slides shell's flag: fill the viewport rather than the
				 * board's own rectangle, so a fixed 960×540 slide can scale to the window. A
				 * flow document wants the opposite — the window *is* its rectangle, and the
				 * flag's `overflow: hidden` would take away the scrolling it is there to do.
				 */
				src={api(`/board/${props.board.path}?${slides() ? "present=1&" : ""}rev=${props.board.rev}`)}
				/* A designed board is laid out at the size it was written at and scaled to the screen
				    (`fit`). A board wrapped in a shell is given the window by CSS. */
				style={frameStyle()}
				ref={(element) => {
					frameEl = element;
					element.addEventListener("load", () => {
						frameListeners?.();
						frameListeners = undefined;
						listenInFrame();
						/*
						 * A link on the presented board, which the overlay's own frame has to ask about for
						 * the same reason the canvas's does: the board will not navigate itself, and this is
						 * the only thing listening on this side of it.
						 */
						detachLinks?.();
						detachLinks = attachBoardOpen(element, (path) => {
							if (props.onOpenBoard?.(path, props.board.path)) props.onExit();
						});
						/*
						 * Code on the presented board, pressed. The overlay's own frame carries this for the
						 * same reason the link above does, and the path is stamped from the board being
						 * presented rather than from anything the board said.
						 */
						detachEval?.();
						detachEval = attachBoardEval(element, (ask) => props.onBoardEval?.(props.board.path, ask.id, ask.value));
						if (slides()) ready();
					});
				}}
			/>
			</Show>
			</div>
			{/* The way out, top centre, shown with the other controls when the pointer moves or a finger taps. */}
			<button type="button" class="present-exit" onClick={leave} aria-label={slides() ? "Stop presenting" : "Leave fullscreen"}>
				Esc
			</button>
			{/* A deck's paging, at the foot. */}
			<Show when={slides()}>
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
				</div>
			</Show>
		</div>
	);
}
