import { cssEscape, dayKey, formatDate, yearOf } from "@decks/ui";
import type { AgentKind, AgentState, ChatItem } from "@decks-next/protocol";
import ArrowDown from "lucide-solid/icons/arrow-down";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { Icon } from "@decks/ui";
import { closeHistory, historyShown } from "../edge.ts";
import { earlierLabel, hasEarlier, LOAD_MORE_AT, WINDOW, windowStart } from "./model.ts";
import { WorkingSign } from "../status/view.tsx";
import { turnCards, type TurnCard } from "../turn/model.ts";
import { signPlacement } from "../status/model.ts";
import { Turn } from "../turn/view.tsx";

/** The conversation: a column of cards over the cards. */
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
	/** Whose work it is, only spoken when the agent is the one waiting. */
	name: string;
	/** Which runtime, for its own mark. */
	agent: AgentKind;
	/** An item to bring into view, the turn the spine was clicked at. */
	scrollTo?: { id: string; at: number };
	/** The entry the canvas is currently previewing, if any. Puts the way out on its card. */
	previewing?: string | null;
	/** The time machine, addressed to the message it belongs to. */
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

	/* Whether the tail of the column is a reply in flight. */
	const arriving = () => {
		const last = cards().at(-1);
		return last?.kind === "agent" && last.parts.some((part) => part.kind === "text" && part.streaming);
	};
	const signing = () => signPlacement(props.state, { historyOpen: true, arriving: arriving() }) === "column";

	/* How much of the conversation is in the DOM (`chat/history-page.ts`). */
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

	/** Show more of the conversation, keeping what the reader is looking at where it is. */
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

	/* Sending from the foot throws away the pages that were scrolled back to. */
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

	/** The rows, folded into one card per turn. */
	const cards = createMemo<TurnCard[]>(() => turnCards(shown()));
	const cardById = createMemo(() => new Map(cards().map((card) => [card.id, card])));
	const cardIds = createMemo(() => cards().map((card) => card.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

	/* The wheel scrolls the column from anywhere over it, not only over a card. */
	onMount(() => {
		const wheel = (event: WheelEvent) => {
			// A pinch never scrolls the conversation; over it, a pinch does nothing (the canvas, `pinchOver`).
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
			 * Over the conversation itself the browser scrolls it, with the smoothing and momentum every other
			 * scrolling box has: the event is only kept from the canvas. Setting `scrollTop` from each event
			 * moved the history in steps.
			 */
			event.stopPropagation();
			if (event.target instanceof Node && scroller.contains(event.target)) return;
			event.preventDefault();
			scroller.scrollTop = at + event.deltaY;
		};
		window.addEventListener("wheel", wheel, { capture: true, passive: false });
		onCleanup(() => window.removeEventListener("wheel", wheel, { capture: true }));
	});

	/* Escape puts it away, wherever the focus is. */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !shownNow()) return;
			/*
			 * A menu open over the column owns Escape first, `Popover` closes on the same key and does not stop
			 * the event, so one press would otherwise take the menu *and* the surface it belongs to.
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

	/** The scroll request already carried out, so it is not carried out again. */
	let travelled: string | undefined;
	createEffect(() => {
		const target = props.scrollTo;
		if (!target || !shownNow() || !scroller) return;
		const key = `${target.id}:${target.at}`;
		if (travelled === key) return;
		props.items.length;
		/*
		 * A turn clicked on the spine may be older than the window is wide, and a jump to a card that is not
		 * in the DOM finds nothing and silently does nothing. So the window is opened far enough to hold it
		 * first, by position in what is held, which is the one measure that says how much is missing.
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
			 * Instant, not smooth. A jump almost always starts from the foot, you have been watching the reply
			 * arrive, so the first frames of a smooth scroll are still *at* the bottom, the scroll handler reads
			 * slack ≈ 0, re-pins, and the follow effect above yanks it straight back down.
			 */
			element.scrollIntoView({ block: "start", behavior: "auto" });
		});
	});

	/* Following the foot, and holding still away from it. */
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
		/* Always rendered, even with nothing in it and even while away. */
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
			{/* The header: whose thread this is, and the handle to move it by. */}
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

				{/* Everything before the window, as one line rather than as three hundred cards. */}
				<Show when={earlier()}>
					<button class="stream-earlier" type="button" onClick={showEarlier}>
						{earlierLabel(hidden())}
					</button>
				</Show>

				{/* Keyed by the card's id, and each card read by its id as it changes. */}
				<For each={cardIds()}>
					{(id, index) => {
						// The last one read, while a card that has just gone is taken out.
						let last = cardById().get(id)!;
						const card = () => (last = cardById().get(id) ?? last);
						return (
						<>
							{/*
							 * The line between one day and the next, in sentence case, this is what replaces the uppercase
							 * "EARLIER" eyebrow the chat list used.
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

				{/* The working sign, in the flow rather than as a float of its own. */}
				<Show when={signing()}>
					<div class="stream-card stream-working" data-working="true" aria-live="polite">
						<WorkingSign state={props.state} name={props.name} agent={props.agent} />
					</div>
				</Show>
				<div class="stream-edge" ref={foot} aria-hidden="true" />
			</div>

			{/* The way back to the foot, and only once there is one. */}
			{/*
			 * Always in the page, shown or hidden by its own attribute alone: put in and taken out as the reader
			 * scrolled up from the foot, an element laid over the scrolling column, with the column's own
			 * attribute changing with it, made iOS Safari stop the scroll's momentum the moment it appeared.
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

/** The label for a day boundary, or nothing if the two cards are from the same day. */
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

