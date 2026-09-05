import type { AgentChat, Identity } from "@decks/protocol";
import ArrowRight from "lucide-solid/icons/arrow-right";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../icons.tsx";
import { AgentFace } from "./AgentPill.tsx";
import { agentStatus, since, statusWords } from "./agent-order.ts";
import { For } from "solid-js";

/**
 * The box under a face in the corner. It answers exactly one question.
 *
 * *Should I switch to this one?* — so it holds the name, how long ago, the state in words,
 * and the last thing that agent said. Nothing else, and the list of what it deliberately
 * leaves out is longer than what it shows: **no model, no thinking level, no ask-mode, no
 * board counts.** Those belong to the composer and the boards panel, which show them for
 * the agent whose window this is; an earlier version of this card had all four, and a
 * tooltip with four settings in it is a settings panel you cannot click.
 *
 * The state is written out *as well as* ringed, because a colour whose meaning you have to
 * remember is a colour that needs a legend — and rather than draw one somewhere else, this
 * is the legend, shown at the moment you are asking.
 *
 * 220px, on the `--shadow-menu` rung, and clamped to the window like every other summoned
 * surface here. It borrows `.popover`'s material rather than restating it: same border,
 * same panel, same three-layer shadow — a control that invents its own shadow is a control
 * on a rung of its own, and there are two rungs in this app and no third.
 */
export function AgentHoverCard(props: {
	chat: AgentChat;
	identity: Identity | undefined;
	unread: number;
	/**
	 * The box to hang off, in viewport coordinates. The card sits 8px under it, centred.
	 *
	 * The fields of a `DOMRect` rather than a `DOMRect`, because `beside` wants an anchor
	 * that is not any one element: the card goes beside the *menu* and level with the *row*,
	 * so `AgentPill` composes one from both and a real rect cannot be edited.
	 */
	anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
	/**
	 * Put it to the *side* of the anchor rather than under it.
	 *
	 * For the agent dropdown, where the anchor is a menu row: a card centred under a row
	 * covers the rows below it, which are exactly the ones being compared. To the right,
	 * top-aligned, and it flips to the left when there is no room — the same clamping the
	 * vertical case does, on the other axis.
	 */
	beside?: boolean;
	/**
	 * Whether it is up.
	 *
	 * The card is **always mounted** and this only unhides it, which is the whole reason it
	 * feels immediate. Mounting on hover meant a component created, a layout measured and
	 * two frames waited before anything appeared, and no delay figure could fix that — it
	 * was 400ms, then 120, and it still read as the app thinking about it. Nothing is built
	 * at the moment of pointing now; the box is already there and already the right size.
	 */
	shown: boolean;
}) {
	const [at, setAt] = createSignal<{ left: number; top: number } | undefined>();
	let card: HTMLDivElement | undefined;

	const status = () => agentStatus(props.chat.state, props.unread);
	const name = () => props.identity?.name ?? props.chat.name;

	/*
	 * Measured after mount rather than placed in CSS, for the same reason `Popover` is: the
	 * card's own width decides whether it fits, and only the browser knows it. A
	 * `translateX(-50%)` rule would centre it correctly and then let it hang off the right
	 * edge of a narrow window with nothing able to notice.
	 */
	const place = () => {
		if (!card) return;
		const box = card.getBoundingClientRect();
		const MARGIN = 8;
		if (props.beside) {
			/*
			 * Beside a menu row: to its right, top-aligned, flipping left when the window ends.
			 * Top-aligned rather than centred so the card's first line sits level with the name
			 * it belongs to — the row and the card read as one thing that way.
			 */
			let left = props.anchor.right + MARGIN;
			if (left + box.width > window.innerWidth - MARGIN) left = Math.max(MARGIN, props.anchor.left - box.width - MARGIN);
			const top = Math.min(Math.max(MARGIN, props.anchor.top), Math.max(MARGIN, window.innerHeight - box.height - MARGIN));
			setAt({ left, top });
			return;
		}
		let left = props.anchor.left + props.anchor.width / 2 - box.width / 2;
		left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - box.width - MARGIN));
		let top = props.anchor.bottom + MARGIN;
		// The corner is at the top of the window, so this almost never fires — but a short
		// window is a window, and a card half off the bottom of one is not readable.
		if (top + box.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, props.anchor.top - box.height - MARGIN);
		setAt({ left, top });
	};

	/*
	 * Placed whenever the face under the pointer changes, and whenever the name in it does.
	 *
	 * One frame, not two: the card exists already, so the only thing worth waiting for is
	 * the new text having changed its width. Reading `props.anchor` and `name()` here is
	 * what makes this run — moving from one face to the next is a new anchor, and the
	 * transition in `agents.css` turns the difference into a slide rather than a jump.
	 */
	createEffect(() => {
		props.anchor;
		name();
		requestAnimationFrame(place);
	});

	onMount(() => {
		window.addEventListener("resize", place);
		onCleanup(() => window.removeEventListener("resize", place));
	});

	return (
		/*
		 * Portaled, for the reason `Popover` is: a `position: fixed` box inside a transformed
		 * ancestor is placed against that ancestor, and nothing about the corner promises to
		 * stay untransformed.
		 */
		<Portal>
			<div
				ref={card}
				data-shown={props.shown ? "true" : "false"}
				aria-hidden={!props.shown}
				/*
				 * `pointer-events-none`: it is a hover card and not a menu, so there is nothing
				 * in it to press — and a 220px box floating over the canvas that swallowed
				 * clicks would be a dead patch beside the corner.
				 */
				class="floatcard agent-hover pointer-events-none flex w-[220px] flex-col gap-[5px] rounded-[10px] px-2.5 py-[9px]"
				role="tooltip"
				style={{
					left: `${at()?.left ?? 0}px`,
					top: `${at()?.top ?? 0}px`,
					/* Hidden until placed, so it never flashes at 0,0 on the way to the corner. */
					visibility: at() ? "visible" : "hidden",
				}}
			>
				<div class="flex items-center gap-[7px]">
					<AgentFace chat={props.chat} identity={props.identity} unread={props.unread} size={20} ring={1.5} />
					<span class="min-w-0 flex-1 truncate text-[12px] font-semibold">{name()}</span>
					<span class="meta flex-none text-[10px] tabular-nums">{since(props.chat.lastAt)}</span>
				</div>

				<div class="flex items-center gap-1.5 text-[11px] text-muted">
					<span class="agent-swatch" data-status={status()} aria-hidden="true" />
					<span class="min-w-0 flex-1 truncate">{statusWords(status(), props.chat.state)}</span>
					{/*
						Which runtime, as the same word the dropdown row and the panel row use.
						On the status line rather than beside the name, because it is the same *kind*
						of fact — what this agent is, not what it is called.
					*/}
					<span class="kind" data-dormant={props.chat.dormant ? "true" : undefined}>{props.chat.kind}</span>
				</div>

				{/*
					What it says it is working on, and what you say it is.
					
					Above the quote, because a tag is a standing fact and the quote is a moment —
					and because tags are the thing being scanned for when several of these are
					opened in turn. Yours are outlined; the agent's are filled.
				*/}
				<Show when={(props.identity?.tags?.length ?? 0) + (props.identity?.userTags?.length ?? 0) > 0}>
					<div class="tags">
						<For each={props.identity?.tags ?? []}>{(tag) => <span class="tag">{tag}</span>}</For>
						<For each={props.identity?.userTags ?? []}>{(tag) => <span class="tag" data-mine="true">{tag}</span>}</For>
					</div>
				</Show>

				{/*
				 * The last thing it said, in quotes.
				 *
				 * Three lines at most: this is the evidence for the decision rather than the
				 * transcript, and a card that grows with whatever the agent last wrote would be
				 * a card that covers the boards it is telling you about.
				 */}
				<Show when={props.chat.lastLine}>
					{(line) => <div class="line-clamp-3 text-[11px] leading-[1.45] text-faint">“{line()}”</div>}
				</Show>

				{/* Says what the click does, because the face is a *switch* and not a status
				    light — which is the whole reason faces in a corner survive one agent at a
				    time. Switching moves the canvas, the camera, the panel and the transcript
				    together, so switching is the only kind of following there is. */}
				<div class="flex items-center gap-1.5 border-t border-line pt-1.5 text-[10.5px] text-muted">
					<Icon of={ArrowRight} size={11} class="flex-none" />
					Click to switch to {name()}
				</div>
			</div>
		</Portal>
	);
}
