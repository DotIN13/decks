import type { AgentChat, Identity } from "@decks/protocol";
import ArrowRight from "lucide-solid/icons/arrow-right";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { AgentFace } from "./AgentPill.tsx";
import { agentStatus, since, statusWords } from "./agent-order.ts";

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
	/** The face's box in viewport coordinates. The card hangs 8px under it, centred. */
	anchor: DOMRect;
	/**
	 * How long the pointer has to stay before it appears.
	 *
	 * 120ms, which is about as short as a delay can be while still doing its job — stopping
	 * a pointer crossing the corner on its way to the zoom chip from summoning three cards
	 * in passing. It was 400, which is the number tooltips use, and on a control you are
	 * *aiming at* that reads as the app thinking about it: you have already decided to look
	 * at the face, and the card is the answer to a question you asked by pointing.
	 *
	 * The delay is the card's own rather than the stack's, so the caller only has to say
	 * *which* face is hovered and never has to own a timer.
	 */
	delay?: number;
}) {
	const [ready, setReady] = createSignal(false);
	const [at, setAt] = createSignal<{ left: number; top: number } | undefined>();
	let card: HTMLDivElement | undefined;

	const status = () => agentStatus(props.chat.state, props.unread);
	const name = () => props.identity?.name ?? props.chat.name;

	onMount(() => {
		const timer = setTimeout(() => setReady(true), props.delay ?? 120);
		onCleanup(() => clearTimeout(timer));
	});

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
		let left = props.anchor.left + props.anchor.width / 2 - box.width / 2;
		left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - box.width - MARGIN));
		let top = props.anchor.bottom + MARGIN;
		// The corner is at the top of the window, so this almost never fires — but a short
		// window is a window, and a card half off the bottom of one is not readable.
		if (top + box.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, props.anchor.top - box.height - MARGIN);
		setAt({ left, top });
	};

	createEffect(() => {
		if (!ready()) return;
		// Two frames: one for the card to exist, one for the fonts to have settled its height.
		requestAnimationFrame(() => {
			place();
			requestAnimationFrame(place);
		});
		window.addEventListener("resize", place);
		onCleanup(() => window.removeEventListener("resize", place));
	});

	return (
		<Show when={ready()}>
			<div
				ref={card}
				/*
				 * `pointer-events-none`: it is a hover card and not a menu, so there is nothing
				 * in it to press — and a 220px box floating over the canvas that swallowed
				 * clicks would be a dead patch beside the corner.
				 */
				class="popover pointer-events-none flex w-[220px] flex-col gap-[5px] rounded-[10px] px-2.5 py-[9px]"
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
					{statusWords(status(), props.chat.state)}
				</div>

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
		</Show>
	);
}
