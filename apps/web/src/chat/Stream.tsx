import type { AgentKind, AgentState, ChatItem } from "@decks/protocol";
import ArrowDown from "lucide-solid/icons/arrow-down";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { closeHistory, historyShown } from "../lib/edge.ts";
import { floatRows } from "./float-rows.ts";
import { WorkingSign } from "./StatusLine.tsx";
import { signPlacement } from "./working-sign.ts";
import { attachSwipeClose } from "./swipe-close.ts";
import { Turn, type AgentPart, type TurnCard } from "./Turn.tsx";

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
 * Whether it is up at all belongs to `lib/edge.ts`, which owns the one bit of state deciding
 * who has the right edge. There is no `open` prop for the same reason there is no local
 * signal: two copies of "is the history showing" is the bug where the button says one thing
 * and the screen another.
 */
export function Stream(props: {
	items: ChatItem[];
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
}) {
	let column!: HTMLElement;
	let scroller!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);
	/** How many cards are below the fold, which is what the jump pill counts. */
	const [behind, setBehind] = createSignal(0);

	/*
	 * Whether the tail of the column is already answering "is anything happening".
	 *
	 * A streaming reply has a caret blinking at the end of its text, which is the same
	 * message the sign carries and is *in the place the words are arriving* — so the sign
	 * stands down and lets the card have it. Between turns there is no card yet, and that is
	 * where a sign earns its keep: "running tools…" for four minutes with nothing to read is
	 * exactly the state a column would otherwise report as silence.
	 */
	const arriving = () => {
		const last = cards().at(-1);
		return last?.kind === "agent" && last.parts.some((part) => part.kind === "text" && part.streaming);
	};
	const signing = () => signPlacement(props.state, { historyOpen: true, arriving: arriving() }) === "column";

	const rows = createMemo(() => floatRows(props.items));
	const itemById = createMemo(() => new Map(props.items.map((item) => [item.id, item])));

	/**
	 * The rows, folded into one card per turn.
	 *
	 * `floatRows` gives a row per thing said and a row per run of tool calls; a *card* is
	 * coarser than that, because a turn that edited three files is one object in the column
	 * however many calls it made. So consecutive rows from the agent's side collapse into one
	 * card, in order — and no turn check is needed to stop them merging across turns, because
	 * what starts a turn is a user message, which puts a card of its own in between.
	 */
	const cards = createMemo<TurnCard[]>(() => {
		const out: TurnCard[] = [];
		const at = (id: string) => {
			const item = itemById().get(id);
			return item && item.kind !== "tool" ? item.at : undefined;
		};
		for (const row of rows()) {
			if (row.kind === "user") {
				const item = itemById().get(row.id);
				out.push({
					kind: "mine",
					id: row.id,
					text: row.text,
					at: at(row.id),
					...(item?.kind === "user" && item.entryId ? { entryId: item.entryId } : {}),
				});
				continue;
			}
			if (row.kind === "notice") {
				out.push({ kind: "notice", id: row.id, text: row.text, level: row.level, at: at(row.id) });
				continue;
			}
			const part: AgentPart =
				row.kind === "tools"
					? { kind: "tools", id: row.id, calls: row.calls }
					: { kind: "text", id: row.id, text: row.text, streaming: row.streaming, ...(row.thinking ? { thinking: row.thinking } : {}) };
			const last = out.at(-1);
			if (last?.kind === "agent") last.parts.push(part);
			else out.push({ kind: "agent", id: row.id, parts: [part], at: at(row.id) });
		}
		return out;
	});

	/*
	 * A swipe toward the right edge puts the history away, and releasing mid-gesture puts it
	 * back — the same rule iOS and Android use for a sheet. Vertical drags are never touched,
	 * so scrolling the column still scrolls.
	 */
	onMount(() => {
		const detach = attachSwipeClose(column, historyShown, closeHistory);
		onCleanup(detach);
	});

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
			if (!historyShown() || !column || !scroller) return;
			const box = column.getBoundingClientRect();
			if (event.clientX < box.left || event.clientX > box.right) return;
			if (event.clientY < box.top || event.clientY > box.bottom) return;
			// Only when there is somewhere to go: at either end the canvas should still zoom,
			// which is the same courtesy `overscroll-behavior: contain` asks for.
			const room = scroller.scrollHeight - scroller.clientHeight;
			if (room <= 0) return;
			const at = scroller.scrollTop;
			if ((event.deltaY < 0 && at <= 0) || (event.deltaY > 0 && at >= room - 1)) return;
			event.preventDefault();
			event.stopPropagation();
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
	 * the right edge back to the history, so `historyShown()` becomes true — and then this
	 * listener, running later in the *same* event, saw a history that was up and closed it.
	 * One keypress dismissed the inspector and the conversation, and the conversation had
	 * never been asked to go. The first handler to act claims the key, which is the
	 * convention `App`'s own handler already follows.
	 */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || !historyShown()) return;
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
			closeHistory();
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});

	/*
	 * Follow the newest turn while it grows — and only while it grows: a stream that scrolls
	 * itself while you are reading three replies back is the single most annoying thing a chat
	 * surface does. Reading up unpins; scrolling back to the foot re-pins.
	 *
	 * Nothing to do for `prefers-reduced-motion` here, and that is worth saying rather than
	 * leaving to be rediscovered: this is an assignment to `scrollTop`, which does not animate.
	 * The pill below is the one that had to ask.
	 */
	createEffect(() => {
		if (!historyShown() || !scroller) return;
		cards().length;
		const last = props.items.at(-1);
		if (last?.kind === "assistant" && last.streaming) {
			// Tracked: the text grows as it streams.
			last.text.length;
		}
		if (!pinned()) return;
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	/* Opening shows the newest turn, unless it was opened *at* something. */
	createEffect(() => {
		if (!historyShown()) return;
		setPinned(true);
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
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
		if (!target || !historyShown() || !scroller) return;
		const key = `${target.id}:${target.at}`;
		if (travelled === key) return;
		props.items.length;
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
			measure();
		});
	});

	/**
	 * Where the reader is, in the two terms the column needs: pinned to the foot, and how many
	 * cards are past it.
	 *
	 * Counted in cards rather than in pixels because that is what the pill says — "3 newer
	 * turns" is a decision you can make, and "412px below" is not.
	 */
	const measure = () => {
		if (!scroller) return;
		const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		const atFoot = slack < 40;
		setPinned(atFoot);
		if (atFoot) {
			setBehind(0);
			return;
		}
		const fold = scroller.scrollTop + scroller.clientHeight;
		let count = 0;
		for (const card of scroller.querySelectorAll<HTMLElement>("[data-card]")) {
			// 4px of grace: a card whose last shadow pixel is under the fold is not one you
			// have missed.
			if (card.offsetTop + card.offsetHeight > fold + 4) count++;
		}
		setBehind(count);
	};

	/** Motion the reader asked not to have. */
	const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

	const toFoot = () => {
		setPinned(true);
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: still() ? "auto" : "smooth" });
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
		 * Under 1100px it becomes a full-width sheet, and the override is a utility rather than
		 * a `@media` block in the stylesheet — a media query inside `@layer components` still
		 * loses to a utility on the same element, so the responsive half has to be the strong
		 * one. The base geometry stays in `stream.css`, where it can read `--dock` and `env()`.
		 */
		<section
			class="stream max-[1100px]:left-0 max-[1100px]:w-auto"
			ref={column}
			data-shown={historyShown()}
			aria-label="The conversation"
		>
			{/*
			 * Its own way out, just above the topmost card.
			 *
			 * The column has no title bar to hang an × on — it is a stack of cards, not a panel
			 * — so the control rides the top of the stack and appears when the pointer is in the
			 * column. `closeHistory`, not a local flag: dismissing it here and dismissing it from
			 * the corner button have to mean the same thing, including the part where a dismissed
			 * history does not come back when a selection goes away.
			 */}
			<div class="stream-head">
				<button
					class="iconbtn pointer-events-auto [--control:22px] pointer-coarse:[--control:34px]"
					type="button"
					aria-label="Close the conversation"
					title="Close the conversation"
					onClick={closeHistory}
				>
					<Icon of={X} size={13} />
				</button>
			</div>

			<div class="stream-roll" ref={scroller} onScroll={measure}>
				{/*
				 * Empty, it says so. The column used to appear only once there was something in
				 * it, which was right while it arrived on its own and wrong now that there is a
				 * button for it: a control that does nothing on a fresh agent looks broken.
				 */}
				<Show when={cards().length === 0}>
					<div class="stream-card stream-notice">Nothing said yet — ask for something and it will show up here.</div>
				</Show>

				{/*
				 * `Index`, not `For`. Cards are recomputed on every token of a streaming reply and
				 * `For` keys by reference, so each recomputation would replace every card in the
				 * column — closing whichever tool group was open and dropping the selection out of
				 * the text you were copying. `Index` keys by position and updates in place, which
				 * is what `TurnBar` does for the same reason.
				 */}
				<Index each={cards()}>
					{(card, index) => (
						<>
							{/*
							 * The line between one day and the next, in sentence case — this is what
							 * replaces the uppercase "EARLIER" eyebrow the chat list used. A chip
							 * rather than a label with a rule running off it: over the canvas a bare
							 * hairline lands on top of whatever board is behind the column and reads as
							 * a board's own rule, and a chip is opaque like everything else here.
							 */}
							<Show when={divides(cards()[index - 1]?.at, card().at)}>
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
							/>
						</>
					)}
				</Index>

				{/*
				 * The working sign, in the flow rather than as a float of its own.
				 *
				 * A card, in the same family as the turn cards and in the position the arriving
				 * turn will take — so when the reply starts, the card that replaces this one is
				 * already where the eye is. A second pill floating over the column would have been
				 * a third thing on screen saying what the column is for.
				 *
				 * Inside the roll, so it scrolls with the conversation and the autoscroll keeps it
				 * in view; `aria-live` is on the dock's copy, which is the one a screen reader
				 * should hear, so this one is quiet.
				 */}
				<Show when={signing()}>
					<div class="stream-card stream-working" data-working="true">
						<WorkingSign state={props.state} name={props.name} agent={props.agent} />
					</div>
				</Show>
			</div>

			{/*
			 * The way back to the foot, and only once there is one.
			 *
			 * It overlays the bottom of the column rather than taking a row of its own: a pill
			 * that appeared *between* the last card and the status line would shorten the
			 * scroller at the moment you scrolled, which moves the thing you were reading.
			 */}
			<Show when={behind() > 0}>
				<button
					class="stream-jump"
					type="button"
					aria-label={`Jump to the latest turn, ${behind()} below`}
					onClick={toFoot}
				>
					<Icon of={ArrowDown} size={12} />
					{behind()} newer {behind() === 1 ? "turn" : "turns"}
				</button>
			</Show>
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
	const day = (ms: number) => new Date(ms).toDateString();
	if (day(before) === day(at)) return undefined;
	const today = new Date();
	if (day(at) === today.toDateString()) return "Today";
	if (day(at) === new Date(today.getTime() - 86_400_000).toDateString()) return "Yesterday";
	const date = new Date(at);
	const sameYear = date.getFullYear() === today.getFullYear();
	return date.toLocaleDateString(undefined, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

/** An item id is user data; escape it before it goes in a selector. */
function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
