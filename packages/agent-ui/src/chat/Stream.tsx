import { dayKey, formatDate, yearOf } from "@decks/ui";
import type { AgentKind, AgentState, ChatItem } from "@decks/protocol";
import ArrowDown from "lucide-solid/icons/arrow-down";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { Icon } from "@decks/ui";
import { closeHistory, historyShown } from "../edge.ts";
import { earlierLabel, hasEarlier, LOAD_MORE_AT, WINDOW, windowStart } from "./history-page.ts";
import { WorkingSign } from "./StatusLine.tsx";
import { turnCards, type TurnCard } from "./turn-cards.ts";
import { signPlacement } from "./working-sign.ts";
import { Turn } from "./Turn.tsx";

/**
 * The conversation: a column of cards over the boards.
 *
 * **Not a panel.** The column itself has no background and takes no pointer events; the
 * cards take their own, so the 10px gaps between turns are still canvas and a board can be
 * dragged through them. That was the one genuinely good idea in the floating transcript this
 * replaces, and it survives unchanged.
 *
 * **Every card is opaque, and none of them dims with age.** `index.css` refuses frosted
 * glass in writing — "40% words behind 100% words reads as grime, and it moves when the
 * camera does" — and a floating transcript is the exact case that argument was about: a
 * small surface directly on top of a board's own paragraphs, at whatever zoom the camera
 * happens to be at. So each card is the panel's colour at full opacity, a hairline, and the
 * `--shadow` rung. The `canvas-chat` lineage this idea comes from steps older turns back in
 * opacity so the board shows through; that is the same grime by a gentler name, and it buys
 * nothing here — the newest card is at the bottom of the column, which is where the eye
 * already is, and the column scrolls rather than stacking.
 *
 * **It is not an inset, and that is deliberate.** The pinned version declared
 * `data-inset="right"`, so `fit` subtracted it and no board could sit underneath. A floating
 * column cannot do that and still be floating. The rule the boards settle on, and the reason
 * the inspector still insets while this does not: *a surface that arrives on its own must be
 * subtracted; a surface you summoned may overlap.* You pressed a button to put this here,
 * one press takes it away, and it steps aside when the inspector needs the room — so
 * covering a board is a trade you made, not one made for you.
 *
 * Whether it is up at all belongs to `state/edge.ts`, which owns the one bit of state deciding
 * who has the right edge. There is no `open` prop for the same reason there is no local
 * signal: two copies of "is the history showing" is the bug where the button says one thing
 * and the screen another.
 */
export function Stream(props: {
	items: ChatItem[];
	/** Whose conversation this is, so the window resets when you switch chats. */
	agentId: string;
	/** The header element, once mounted: the app makes it the float's drag handle. */
	onHead?: (element: HTMLDivElement) => void;
	/** Whether the server holds anything older than `items` (`chat/history-page.ts`). */
	more: boolean;
	/** Fetch the page before the oldest row held. Answers with how many arrived. */
	onEarlier: () => Promise<number>;
	/** What the focused agent is doing, for the sign at the foot. */
	state: AgentState;
	/** Whose work it is — only spoken when the agent is the one waiting. */
	name: string;
	/** Which runtime, for its own mark. */
	agent: AgentKind;
	/** An item to bring into view — the turn the spine was clicked at. */
	scrollTo?: { id: string; at: number };
	/** The entry the canvas is currently previewing, if any. Puts the way out on its card. */
	previewing?: string | null;
	/**
	 * The time machine, addressed to the message it belongs to.
	 *
	 * Kept exactly as the floating transcript had them, and for its reason: the message *is*
	 * the point you rewind to, and a second row of notches over the same list was the same
	 * thing drawn twice.
	 */
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
	/*
	 * For a host other than the Decks app (Studio), which has its own panel and none of the app's
	 * edge state: whether it is showing, what its × does, and whether a message offers the time
	 * machine (a host that cannot rewind leaves it out). Left out, the app's own edge is used.
	 */
	shown?: boolean;
	onClose?: () => void;
	timeMachine?: boolean | "buttons";
}) {
	/*
	 * A memo, so what reads it runs again when the conversation is shown or put away and not on every
	 * change behind the host's answer: the app's reads the window's width, and as a function this took
	 * every resize for an opening and threw a reader who had scrolled up back to the foot.
	 */
	const shownNow = createMemo(() => props.shown ?? historyShown());
	const close = () => (props.onClose ? props.onClose() : closeHistory());
	let column!: HTMLElement;
	let head: HTMLDivElement | undefined;
	onMount(() => { if (head) props.onHead?.(head); });
	let scroller!: HTMLDivElement;
	/** Empty rows before the first card and after the last: what the observers below watch for the two ends. */
	let top!: HTMLDivElement;
	let foot!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);

	/*
	 * Whether the tail of the column is a reply in flight.
	 *
	 * It used to decide whether the sign stood down: a streaming reply had a caret blinking
	 * at the end of its text, saying "still going" in the place the words were arriving,
	 * which is a better place for it than a sign below them. The caret is gone, so the sign
	 * stays up throughout and this no longer gates it — `signPlacement` says why it still
	 * takes the flag.
	 *
	 * Still computed, because it is the honest name for the state and the column may want to
	 * know it again. Between turns there is no card at all, and that is where a sign earns
	 * its keep: "running tools…" for four minutes with nothing to read is exactly the state
	 * a column would otherwise report as silence.
	 */
	const arriving = () => {
		const last = cards().at(-1);
		return last?.kind === "agent" && last.parts.some((part) => part.kind === "text" && part.streaming);
	};
	const signing = () => signPlacement(props.state, { historyOpen: true, arriving: arriving() }) === "column";

	/*
	 * How much of the conversation is in the DOM (`chat/history-page.ts`).
	 *
	 * Only the end of it, because a card is not cheap — markdown, tool groups, a time
	 * machine each — and a conversation has no upper bound. Reaching towards the top widens
	 * the window; coming back to the foot throws the extra away, so a chat that has been
	 * open all day costs what one just opened costs.
	 *
	 * The window starts at a row (`from`), not at a count from the end: rows arriving at the foot
	 * leave it where it is (`windowStart`). Unset, it is the last `WINDOW` rows, and the row that
	 * starts them is kept as soon as they are drawn.
	 */
	const [from, setFrom] = createSignal<string | undefined>();
	const start = createMemo(() => windowStart(props.items, from(), WINDOW));
	createEffect(() => {
		const id = props.items[start()]?.id;
		if (id !== untrack(from)) setFrom(id);
	});
	const shown = createMemo(() => (start() === 0 ? props.items : props.items.slice(start())) as ChatItem[]);
	const hidden = () => start();
	const earlier = () => hasEarlier({ total: props.items.length, hidden: hidden(), more: props.more });

	/** True while a page is on its way, so the column asks once. */
	let fetching = false;

	/**
	 * Show more of the conversation, keeping what the reader is looking at where it is.
	 *
	 * The column grows *upwards*, so without a correction every page would throw the reader down
	 * the page by exactly the height of what they asked for. The row they are reading is held where
	 * it is (`hold`), there and again as the new rows' pictures load (`settle`).
	 *
	 * Two sources, in order. The window is widened first, because those rows are already
	 * here; only once it has caught up with what was sent does this go to the server, which
	 * holds everything older.
	 */
	const showEarlier = () => {
		if (!scroller) return;
		if (hidden() > 0) {
			hold(() => setFrom(props.items[Math.max(0, start() - WINDOW)]?.id));
			rearmTop();
			return;
		}
		if (fetching || !props.more) return;
		fetching = true;
		void props
			.onEarlier()
			.then((added) => {
				if (!scroller || added === 0) return;
				// The window has to take in what arrived, or the page is fetched and then
				// immediately hidden again by the window it landed outside of. The page went in
				// front while the window still started at the old first row, so the reader's row
				// has not moved yet: it is held from here.
				hold(() => setFrom(props.items[0]?.id));
				rearmTop();
			})
			.finally(() => {
				fetching = false;
			});
	};

	/*
	 * Sending from the foot throws away the pages that were scrolled back to.
	 *
	 * Without something like this a conversation left open all day only ever grows: every
	 * page anybody reached for is still in the DOM, above a reader who has long since come
	 * back to the end.
	 *
	 * Keyed on **a new message of yours**, not on being pinned, and that distinction was a
	 * bug before it was a comment: being pinned is a *state*, and resetting on it undid the
	 * widening in the same tick as the click — pressing "earlier messages" while at the foot
	 * did nothing at all. Sending is an event, it means "I am done reading back", and it is
	 * read from the transcript rather than from a callback so that a queued task or a
	 * rewind's replay re-arms it too.
	 */
	createEffect((previous: string | undefined) => {
		const latest = [...props.items].reverse().find((item) => item.kind === "user")?.id;
		if (previous !== undefined && latest && latest !== previous && pinned() && untrack(start) < props.items.length - WINDOW) setFrom(undefined);
		return latest;
	});

	/*
	 * A different conversation is a different window, and opens at its newest turn: the place kept
	 * was the other conversation's, and kept here it left the new one somewhere in its middle.
	 */
	createEffect((previous: string | undefined) => {
		if (previous !== undefined && props.agentId !== previous) {
			setFrom(undefined);
			setPinned(true);
			toFootNow();
		}
		return props.agentId;
	});

	/**
	 * The rows, folded into one card per turn.
	 *
	 * Which is `chat/turn-cards.ts`'s job now. What is left
	 * here is the window: `shown()` is the part of the conversation in the DOM, and the fold is
	 * applied to that rather than to everything held.
	 */
	const cards = createMemo<TurnCard[]>(() => turnCards(shown()));
	const cardById = createMemo(() => new Map(cards().map((card) => [card.id, card])));
	const cardIds = createMemo(() => cards().map((card) => card.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

	/*
	 * The wheel scrolls the column from anywhere over it, not only over a card.
	 *
	 * The column is `pointer-events: none` with the cards `auto`, which is what lets the
	 * 10px gaps pass clicks through to the board underneath — and it is also why a wheel in
	 * one of those gaps zoomed the canvas instead of scrolling the conversation. An element
	 * that is not a hit-test target does not receive a wheel event either, so there is no
	 * handler to put on it.
	 *
	 * So the listener is on the window, in the capture phase, and it asks the one question
	 * `pointer-events` cannot express: *is the pointer inside the column's box?* If it is,
	 * the scroll belongs to the conversation and the stage must not also see it. Clicks are
	 * untouched, so dragging a board through a gap still works.
	 */
	onMount(() => {
		const wheel = (event: WheelEvent) => {
			// A pinch never scrolls the conversation; over it, a pinch does nothing (`Stage.tsx`, `pinchOver`).
			if (event.ctrlKey) return;
			if (!shownNow() || !column || !scroller) return;
			const box = column.getBoundingClientRect();
			if (event.clientX < box.left || event.clientX > box.right) return;
			if (event.clientY < box.top || event.clientY > box.bottom) return;
			// Only when there is somewhere to go: at either end the canvas should still zoom,
			// which is the same courtesy `overscroll-behavior: contain` asks for.
			const room = scroller.scrollHeight - scroller.clientHeight;
			if (room <= 0) return;
			const at = scroller.scrollTop;
			if ((event.deltaY < 0 && at <= 0) || (event.deltaY > 0 && at >= room - 1)) return;
			/*
			 * Over the conversation itself the browser scrolls it, with the smoothing and momentum
			 * every other scrolling box has: the event is only kept from the canvas. Setting
			 * `scrollTop` from each event moved the history in steps. Only a wheel in one of the
			 * gaps, which lands on the board underneath, is scrolled by hand.
			 */
			event.stopPropagation();
			if (event.target instanceof Node && scroller.contains(event.target)) return;
			event.preventDefault();
			scroller.scrollTop = at + event.deltaY;
		};
		window.addEventListener("wheel", wheel, { capture: true, passive: false });
		onCleanup(() => window.removeEventListener("wheel", wheel, { capture: true }));
	});

	/*
	 * Escape puts it away, wherever the focus is.
	 *
	 * On the window rather than on the column: the thing you were doing when you decided to
	 * dismiss the history was probably not in it. A popover open over the column owns Escape
	 * first, though — `Popover` closes on the same key and does not stop the event, so one
	 * press would otherwise take the menu *and* the surface it belongs to.
	 *
	 * **`defaultPrevented` is what stops one press doing two things**, and the failure it
	 * fixes is a good one. `App` clears the component selection on Escape; clearing it hands
	 * the right edge back to the history, so `shownNow()` becomes true — and then this
	 * listener, running later in the *same* event, saw a history that was up and closed it.
	 * One keypress dismissed the inspector and the conversation, and the conversation had
	 * never been asked to go. The first handler to act claims the key, which is the
	 * convention `App`'s own handler already follows.
	 */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !shownNow()) return;
			/*
			 * A menu open over the column owns Escape first — `Popover` closes on the same key
			 * and does not stop the event, so one press would otherwise take the menu *and*
			 * the surface it belongs to.
			 *
			 * `.popover` is exactly the right question again now that it means a menu. It used
			 * to mean "a card that floats", which the always-mounted agent tooltip also is, and
			 * this guard was therefore true forever: Escape stopped closing the conversation at
			 * all. See the note on `.floatcard` in `styles/chrome.css`.
			 */
			if (document.querySelector(".popover")) return;
			event.preventDefault();
			close();
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});

	/* Opening shows the newest turn, unless it was opened *at* something. */
	createEffect(() => {
		if (!shownNow()) return;
		setPinned(true);
		requestAnimationFrame(() => toFootNow());
	});

	/**
	 * The scroll request already carried out, so it is not carried out again.
	 *
	 * `scrollTo` is not a one-shot event — it is also what the spine reads to mark the block
	 * you are looking at, so `App` keeps it set. Without this guard every reopen and every
	 * arriving message replayed a jump to a turn clicked long ago, and scrolling back down was
	 * pointless because the next frame threw you up again. Keyed on `at` as well as `id`, so
	 * clicking the same block twice is a new request and does return to it.
	 */
	let travelled: string | undefined;
	createEffect(() => {
		const target = props.scrollTo;
		if (!target || !shownNow() || !scroller) return;
		const key = `${target.id}:${target.at}`;
		if (travelled === key) return;
		props.items.length;
		/*
		 * A turn clicked on the spine may be older than the window is wide, and a jump to a
		 * card that is not in the DOM finds nothing and silently does nothing. So the window
		 * is opened far enough to hold it first — by position in what is held, which is the
		 * one measure that says how much is missing.
		 */
		const at = props.items.findIndex((item) => item.id === target.id);
		if (at !== -1 && at < untrack(start)) setFrom(props.items[Math.max(0, at - WINDOW)]?.id);
		requestAnimationFrame(() => {
			const element = scroller.querySelector(`[data-item="${cssEscape(target.id)}"]`);
			// Not marked as travelled: the history can be open before the turn has arrived, and
			// this effect re-runs when the items do. Marking here would swallow the one request
			// that was going to work.
			if (!element) return;
			travelled = key;
			setPinned(false);
			/*
			 * Instant, not smooth. A jump almost always starts from the foot — you have been
			 * watching the reply arrive — so the first frames of a smooth scroll are still *at*
			 * the bottom, the scroll handler reads slack ≈ 0, re-pins, and the follow effect
			 * above yanks it straight back down.
			 */
			element.scrollIntoView({ block: "start", behavior: "auto" });
		});
	});

	/*
	 * Following the foot, and holding still away from it.
	 *
	 * - Whether the reader is at the foot is what their last scroll left (`atFoot`, read on each
	 *   scroll event): what the conversation does to its own height changes nothing about it, and a
	 *   scroll of theirs lets go of the foot from its first frame. The IntersectionObserver on a 1px
	 *   row after the last card says whether the foot is in sight (`pinned`), for the "Latest
	 *   messages" button and for throwing pages away on a send.
	 * - At the foot, the column goes back to it whenever its height changes: a card arrives or a
	 *   reply grows (the effect below, before the change is painted), or anything in it changes size
	 *   later (a ResizeObserver on every row and on the column): a picture loading, a tool group
	 *   opened, a pill measured, the window resized. Following only the first left the reader behind
	 *   the foot when a picture came in after the follow: the foot out of sight, and following off.
	 * - Away from it, the row the reader is looking at stays where it is on screen (`anchor`) when
	 *   anything above it changes size, rows put in above it included.
	 * - The browser's own scroll anchoring is off for the column (`overflow-anchor: none`,
	 *   `stream.css`): Safari has none, and where there is one it picked its own row and corrected
	 *   before this did, so the place was moved twice. This is the one that keeps it.
	 * - Reaching back is a second observer, on an empty row before the first card, within
	 *   `LOAD_MORE_AT` of the top; asked again each time the window grows, so a reader who stays near
	 *   the top keeps loading.
	 */
	/** Whether the reader's last scroll left them at the foot. */
	let atFoot = true;
	/** The row the reader is looking at, away from the foot, and how far down the column it was. */
	let anchor: { el: Element; top: number } | undefined;
	const readAnchor = () => {
		const box = scroller.getBoundingClientRect();
		for (const el of scroller.querySelectorAll("[data-item]")) {
			const row = el.getBoundingClientRect();
			if (row.bottom > box.top) return { el, top: row.top - box.top };
		}
		return undefined;
	};
	const toFootNow = () => {
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
		atFoot = true;
		anchor = undefined;
	};
	/** After the column changed: back to the foot if the reader was there, else their row back where it was. */
	const settle = () => {
		if (!scroller || !untrack(shownNow)) return;
		if (atFoot) return toFootNow();
		// Drawn again (its card named by another row), it is found by its id.
		if (anchor && !anchor.el.isConnected) {
			const again = scroller.querySelector(`[data-item="${cssEscape(anchor.el.getAttribute("data-item") ?? "")}"]`);
			anchor = again ? { el: again, top: anchor.top } : undefined;
		}
		if (!anchor) {
			anchor = readAnchor();
			return;
		}
		const moved = anchor.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top;
		if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
	};
	/** Change the rows with the reader's row held where it is. */
	const hold = (change: () => void) => {
		if (!atFoot) anchor = readAnchor();
		change();
		settle();
	};
	onMount(() => {
		const scrolled = () => {
			atFoot = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2;
			anchor = atFoot ? undefined : readAnchor();
		};
		scroller.addEventListener("scroll", scrolled, { passive: true });
		onCleanup(() => scroller.removeEventListener("scroll", scrolled));
		if (typeof ResizeObserver === "undefined") return;
		const sized = new ResizeObserver(() => settle());
		sized.observe(scroller);
		const watch = () => {
			for (const row of scroller.children) sized.observe(row);
		};
		watch();
		// Rows come and go: each is watched from when it is put in, and one taken out is no longer observed.
		const rows = new MutationObserver(watch);
		rows.observe(scroller, { childList: true });
		onCleanup(() => {
			rows.disconnect();
			sized.disconnect();
		});
	});
	createEffect(() => {
		if (!shownNow() || !scroller) return;
		// What changes the conversation's height: a card, a reply's words as they stream, the working sign.
		cards();
		const last = props.items.at(-1);
		if (last?.kind === "assistant" && last.streaming) last.text.length;
		signing();
		settle();
	});
	let footWatch: IntersectionObserver | undefined;
	let topWatch: IntersectionObserver | undefined;
	const rearmTop = () => {
		if (!topWatch || !top) return;
		// Observed again, it reports where the top is now, even when it has not moved in or out.
		requestAnimationFrame(() => {
			topWatch?.unobserve(top);
			topWatch?.observe(top);
		});
	};
	onMount(() => {
		if (typeof IntersectionObserver === "undefined") return;
		footWatch = new IntersectionObserver(
			([seen]) => {
				if (!seen) return;
				setPinned(seen.isIntersecting);
			},
			{ root: scroller, rootMargin: "0px 0px 48px 0px", threshold: 0 },
		);
		footWatch.observe(foot);
		topWatch = new IntersectionObserver(
			([seen]) => {
				if (seen?.isIntersecting && earlier()) showEarlier();
			},
			{ root: scroller, rootMargin: `${LOAD_MORE_AT}px 0px 0px 0px`, threshold: 0 },
		);
		topWatch.observe(top);
	});
	onCleanup(() => {
		footWatch?.disconnect();
		topWatch?.disconnect();
	});

	/** Motion the reader asked not to have. */
	const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

	const toFoot = () => {
		if (!scroller) return;
		setPinned(true);
		if (still()) return toFootNow();
		scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
		// Where the glide ends, the foot exactly, and following from there: the glide was aimed at where
		// the foot was when it was pressed, and the conversation may have grown since.
		const land = () => {
			clearTimeout(timer);
			scroller.removeEventListener("scrollend", land);
			if (pinned()) toFootNow();
		};
		const timer = setTimeout(land, 900);
		scroller.addEventListener("scrollend", land);
	};

	return (
		/*
		 * Always rendered, even with nothing in it and even while away.
		 *
		 * Mounted, because the show and hide are a 160ms fade and an 8px slide *on the cards* —
		 * there is no panel to slide — and a surface that is unmounted when closed has nothing
		 * to animate out. Away, it is `visibility: hidden` rather than merely transparent: an
		 * invisible surface that ate the wheel would be a canvas that had stopped working for
		 * no visible reason.
		 *
		 * The base geometry is in `stream.css`, where it can read `--dock` and `env()`.
		 */
		<section
			class="stream"
			ref={column}
			data-shown={shownNow()}
			aria-label="The conversation"
		>
			{/*
			 * No × of its own, deliberately.
			 *
			 * There was one riding the top of the stack, revealed on hover, on the argument that
			 * a column of cards has no title bar to hang one on. **The button that opened this
			 * is the button that closes it** — one control, in the corner, pressed and pressed
			 * again, which is what `data-on` on it has been saying all along. A second × on the
			 * surface itself was a second answer to a question already answered, and it cost the
			 * top of the newest card a hover target that did nothing else.
			 *
			 * One other way out survives, and it is not a control: Escape. It goes through
			 * `closeHistory`, so the corner button always agrees with the screen.
			 */}
			{/*
			 * The header: whose thread this is, and the handle to move it by.
			 *
			 * The column is a float now. A float needs somewhere to take hold of that is not a
			 * card, and a title that says whose turns these are once it has been moved away
			 * from the corner that used to say so. The × is the same `closeHistory` the corner's
			 * button calls, so the two never disagree.
			 */}
			<div class="stream-head" ref={head}>
				<span class="stream-head-name">{props.name}</span>
				<span class="stream-head-state">{props.state === "idle" ? "" : props.state}</span>
				<button type="button" class="icon-button stream-head-x" title="Hide the conversation" aria-label="Hide the conversation" onClick={() => close()}>
					<Icon of={X} size={13} />
				</button>
			</div>
			<div
				class="stream-roll"
				ref={scroller}
				role="log"
				aria-label="Conversation history"
				tabindex="0"
			>
				<div class="stream-edge" ref={top} aria-hidden="true" />
				{/*
				 * Empty, it says so. The column used to appear only once there was something in
				 * it, which was right while it arrived on its own and wrong now that there is a
				 * button for it: a control that does nothing on a fresh agent looks broken.
				 */}
				<Show when={cards().length === 0}>
					<div class="stream-card stream-notice">Nothing said yet. Ask for something and it will show up here.</div>
				</Show>

				{/*
				 * Everything before the window, as one line rather than as three hundred cards.
				 *
				 * A button as well as a scroll target, because scrolling is a gesture with no
				 * affordance: a reader who cannot see that there is more has no reason to try.
				 * It says how many when it knows — the rows are already here, only not drawn —
				 * and invites when it does not, which is when the rest is still on the server.
				 */}
				<Show when={earlier()}>
					<button class="stream-earlier" type="button" onClick={showEarlier}>
						{earlierLabel(hidden())}
					</button>
				</Show>

				{/*
				 * Keyed by the card's id, and each card read by its id as it changes. Cards are
				 * recomputed on every token of a streaming reply, so keyed by the card itself every
				 * recomputation would replace every card in the column — closing whichever tool group
				 * was open and dropping the selection out of the text you were copying. Keyed by
				 * position (`Index`, as it was), a page put in above or a row taken away there moved
				 * every card into its neighbour's place: each was drawn again, its pictures loading
				 * from nothing, and the column moved under the reader.
				 */}
				<For each={cardIds()}>
					{(id, index) => {
						// The last one read, while a card that has just gone is taken out.
						let last = cardById().get(id)!;
						const card = () => (last = cardById().get(id) ?? last);
						return (
						<>
							{/*
							 * The line between one day and the next, in sentence case — this is what
							 * replaces the uppercase "EARLIER" eyebrow the chat list used. A chip
							 * rather than a label with a rule running off it: over the canvas a bare
							 * hairline lands on top of whatever board is behind the column and reads as
							 * a board's own rule, and a chip is opaque like everything else here.
							 */}
							<Show when={divides(cards()[index() - 1]?.at, card().at)}>
								{(label) => <div class="stream-day">{label()}</div>}
							</Show>
							<Turn
								card={card()}
								previewing={
									card().kind === "mine" &&
									!!props.previewing &&
									(card() as Extract<TurnCard, { kind: "mine" }>).entryId === props.previewing
								}
								onPreview={props.onPreview}
								onRewind={props.onRewind}
								onFork={props.onFork}
								onRestore={props.onRestore}
								timeMachine={props.timeMachine}
							/>
						</>
						);
					}}
				</For>

				{/*
				 * The working sign, in the flow rather than as a float of its own.
				 *
				 * A card, in the same family as the turn cards and in the position the arriving
				 * turn will take — so when the reply starts, the card that replaces this one is
				 * already where the eye is. A second pill floating over the column would have been
				 * a third thing on screen saying what the column is for.
				 *
				 * Inside the roll, so it scrolls with the conversation and the autoscroll keeps it
				 * in view. **And it is the live region while it is up.** The dock's row is not in
				 * the document at all while the conversation is open, so the note that used to be
				 * here — "`aria-live` is on the dock's copy" — described a region that was empty
				 * whenever this card existed, which is to say a turn nobody was told about.
				 * `working-sign.ts` is what makes one region rather than two: exactly one of the
				 * two surfaces draws a sign, ever.
				 */}
				<Show when={signing()}>
					<div class="stream-card stream-working" data-working="true" aria-live="polite">
						<WorkingSign state={props.state} name={props.name} agent={props.agent} />
					</div>
				</Show>
				<div class="stream-edge" ref={foot} aria-hidden="true" />
			</div>

			{/*
			 * The way back to the foot, and only once there is one.
			 *
			 * It overlays the bottom of the column rather than taking a row of its own: a pill
			 * that appeared *between* the last card and the status line would shorten the
			 * scroller at the moment you scrolled, which moves the thing you were reading.
			 */}
			{/*
			 * Always in the page, shown or hidden by its own attribute alone: put in and taken out as the
			 * reader scrolled up from the foot, an element laid over the scrolling column, with the
			 * column's own attribute changing with it, made iOS Safari stop the scroll's momentum the
			 * moment it appeared.
			 */}
			<button
				class="stream-jump"
				type="button"
				data-shown={!pinned() && cards().length > 0 ? "true" : "false"}
				aria-hidden={pinned() || cards().length === 0}
				tabindex={pinned() ? -1 : 0}
				aria-label="Scroll to the latest messages"
				onClick={toFoot}
			>
				<Icon of={ArrowDown} size={12} />
				Latest messages
			</button>
		</section>
	);
}

/**
 * The label for a day boundary, or nothing if the two cards are from the same day.
 *
 * Nothing before the *first* card either: "Today" over a conversation that started an hour
 * ago is a heading for a document with one section in it.
 */
function divides(before: number | undefined, at: number | undefined): string | undefined {
	if (!at || !before) return undefined;
	// Days in the deck's timezone (`lib/time.ts`): "Yesterday" is the person's yesterday.
	if (dayKey(before) === dayKey(at)) return undefined;
	const today = Date.now();
	if (dayKey(at) === dayKey(today)) return "Today";
	if (dayKey(at) === dayKey(today - 86_400_000)) return "Yesterday";
	const sameYear = yearOf(at) === yearOf(today);
	return formatDate(at, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** An item id is user data; escape it before it goes in a selector. */
function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
