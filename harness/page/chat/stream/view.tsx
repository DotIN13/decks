import type { AgentKind, AgentState, ChatItem } from "@decks-next/protocol";
import ArrowDown from "lucide-solid/icons/arrow-down";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { closeHistory, historyShown } from "../edge.ts";
import { WorkingSign } from "../status/view.tsx";
import { turnCards, type TurnCard } from "../turn/model.ts";
import { signPlacement } from "../status/model.ts";
import { Turn } from "../turn/view.tsx";
import { createFollow, createWindow, escapeCloses, followScrollTo, glideToFoot, resetWindow, watchEnds, watchRows, wheelOverColumn, type Column } from "./actions.ts";
import { divides, earlierLabel } from "./model.ts";

/** What the conversation's column is given by its host. */
export interface StreamProps {
	items: ChatItem[];
	/** Whose conversation this is, so the window resets when you switch chats. */
	agentId: string;
	/** The header element, once mounted: the app makes it the float's drag handle. */
	onHead?: (element: HTMLDivElement) => void;
	/** Whether the server holds anything older than `items` (the history pager). */
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
}

/** Whether the tail of the column is a reply in flight. */
const arriving = (cards: TurnCard[]) => {
	const last = cards.at(-1);
	return last?.kind === "agent" && last.parts.some((part) => part.kind === "text" && part.streaming);
};

/** The conversation: a column of cards over the canvas, always rendered, even while away. */
export function Stream(props: StreamProps) {
	// A memo, so a reader who scrolled up is not thrown to the foot by every change behind the host's answer.
	const shownNow = createMemo(() => props.shown ?? historyShown());
	const close = () => (props.onClose ? props.onClose() : closeHistory());
	let column: HTMLElement | undefined;
	let scroller: HTMLDivElement | undefined;
	let top!: HTMLDivElement;
	let foot!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);
	const col: Column = { column: () => column, scroller: () => scroller, shown: shownNow };
	const follow = createFollow(col);
	const toFoot = () => (setPinned(true), follow.toFootNow());
	const inputs = { items: () => props.items, more: () => props.more, agentId: () => props.agentId, onEarlier: () => props.onEarlier() };
	const rearmTop = watchEnds(col, { top: () => top, foot: () => foot }, setPinned, () => win.earlier() && win.showEarlier());
	const win = createWindow(inputs, follow, rearmTop);
	resetWindow(inputs, win, pinned, toFoot);
	const cards = createMemo<TurnCard[]>(() => turnCards(win.shown()));
	const signing = () => signPlacement(props.state, { historyOpen: true, arriving: arriving(cards()) }) === "column";
	wheelOverColumn(col);
	escapeCloses(shownNow, close);
	followScrollTo(col, () => props.scrollTo, () => props.items, win, setPinned);
	onMount(() => scroller && watchRows(scroller, follow));
	// Opening shows the newest turn, unless it was opened at something.
	createEffect(() => shownNow() && (setPinned(true), requestAnimationFrame(() => follow.toFootNow())));
	// What changes the column's height: a card, a reply's words as they stream, the working sign.
	createEffect(() => {
		if (!shownNow() || !scroller) return;
		cards();
		const last = props.items.at(-1);
		if (last?.kind === "assistant" && last.streaming) last.text.length;
		signing();
		follow.settle();
	});
	return (
		<section class="stream" ref={column} data-shown={shownNow()} aria-label="The conversation">
			{/* No × on the surface: the corner button that opened it closes it, and Escape does. */}
			<StreamHead name={props.name} state={props.state} onHead={props.onHead} onClose={close} />
			<div class="stream-roll" ref={scroller} role="log" aria-label="Conversation history" tabindex="0">
				<div class="stream-edge" ref={top} aria-hidden="true" />
				<Show when={cards().length === 0}>
					<div class="stream-card stream-notice">Nothing said yet. Ask for something and it will show up here.</div>
				</Show>
				{/* Everything before the drawn span, as one line rather than as three hundred cards. */}
				<Show when={win.earlier()}>
					<button class="stream-earlier" type="button" onClick={win.showEarlier}>
						{earlierLabel(win.start())}
					</button>
				</Show>
				<StreamCards cards={cards()} props={props} />
				<Show when={signing()}>
					<div class="stream-card stream-working" data-working="true" aria-live="polite">
						<WorkingSign state={props.state} name={props.name} agent={props.agent} />
					</div>
				</Show>
				<div class="stream-edge" ref={foot} aria-hidden="true" />
			</div>
			<JumpToFoot shown={!pinned() && cards().length > 0} onJump={() => (setPinned(true), glideToFoot(scroller, pinned, follow.toFootNow))} />
		</section>
	);
}

/** The header: whose thread this is, and the handle to move it by. */
function StreamHead(props: { name: string; state: AgentState; onHead?: (element: HTMLDivElement) => void; onClose: () => void }) {
	let head: HTMLDivElement | undefined;
	onMount(() => head && props.onHead?.(head));
	return (
		<div class="stream-head" ref={head}>
			<span class="stream-head-name">{props.name}</span>
			<span class="stream-head-state">{props.state === "idle" ? "" : props.state}</span>
			<button type="button" class="icon-button stream-head-x" title="Hide the conversation" aria-label="Hide the conversation" onClick={() => props.onClose()}>
				<Icon of={X} size={13} />
			</button>
		</div>
	);
}

/** The cards, keyed by id and each read by its id as it changes, with a line between days. */
function StreamCards(p: { cards: TurnCard[]; props: StreamProps }) {
	const cardById = createMemo(() => new Map(p.cards.map((card) => [card.id, card])));
	const cardIds = createMemo(() => p.cards.map((card) => card.id), undefined, { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });
	const previewing = (card: TurnCard) => card.kind === "mine" && !!p.props.previewing && card.entryId === p.props.previewing;
	return (
		<For each={cardIds()}>
			{(id, index) => {
				// The last one read, while a card that has just gone is taken out.
				let last = cardById().get(id)!;
				const card = () => (last = cardById().get(id) ?? last);
				return (
					<>
						<Show when={divides(p.cards[index() - 1]?.at, card().at)}>{(label) => <div class="stream-day">{label()}</div>}</Show>
						<Turn
							card={card()}
							previewing={previewing(card())}
							onPreview={p.props.onPreview}
							onRewind={p.props.onRewind}
							onFork={p.props.onFork}
							onRestore={p.props.onRestore}
							timeMachine={p.props.timeMachine}
						/>
					</>
				);
			}}
		</For>
	);
}

/** The way back to the foot. Always in the page and shown by its own attribute, so iOS keeps its momentum. */
function JumpToFoot(props: { shown: boolean; onJump: () => void }) {
	return (
		<button
			class="stream-jump"
			type="button"
			data-shown={props.shown ? "true" : "false"}
			aria-hidden={!props.shown}
			tabindex={props.shown ? 0 : -1}
			aria-label="Scroll to the latest messages"
			onClick={props.onJump}
		>
			<Icon of={ArrowDown} size={12} />
			Latest messages
		</button>
	);
}
