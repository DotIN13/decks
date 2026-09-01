import type { ChatItem } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";
import { splitFences } from "./Bubbles.tsx";
import { floatRows, type FloatRow } from "./float-rows.ts";
import { turnsOf, type Turn } from "./TurnBar.tsx";

/**
 * The conversation, floating over the boards as bubbles.
 *
 * The transcript sheet is away by default (DESIGN §7) — boards are the medium —
 * but "away" is not the same as "invisible": what the agent said should follow its
 * work across the canvas, translucently, without asking a panel to be open. So the
 * conversation floats there itself: user and assistant turns as blurred bubbles
 * over the boards, tool calls as one slim row each, the spine at the edge still the
 * handle it always was.
 *
 * It appears when a new turn begins and follows it while it streams, then stays
 * until waved away; the × dismisses the *current* turn, and the next one comes
 * back — the rule canvas-chat's stream plays by, which is the rule this is, and
 * closing the float should not mean the next reply is invisible again.
 *
 * Nothing here has a background of its own: the bubbles are translucent and the
 * gaps between them pass clicks through, so the boards underneath stay visible and
 * usable. A click on a bubble opens the sheet around that turn — the deck's scrub.
 */
export function FloatingTranscript(props: {
	items: ChatItem[];
	/** Whether the float is up. Owned by App, which also quiets the dock's peek while it is. */
	open: boolean;
	/** The full sheet is up — the same words twice would be noise. */
	columnOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** Reopen the transcript sheet at this turn. */
	onScrub: (turn: Turn) => void;
}) {
	let scroller!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);
	/** The turn the float was waved away at: it stays away for that turn only. */
	const [dismissed, setDismissed] = createSignal("");

	const rows = createMemo(() => floatRows(props.items));
	const turns = createMemo(() => turnsOf(props.items, 0));
	const turnById = createMemo(() => new Map(turns().map((turn) => [turn.id, turn])));
	const newestTurn = createMemo(() => turns().at(-1)?.id ?? "");

	/*
	 * A new turn opens the float and brings itself into view. The learner should
	 * never have to go looking for what the agent just said.
	 */
	let seen = "";
	createEffect(() => {
		const turn = newestTurn();
		if (!turn || turn === seen) return;
		seen = turn;
		setPinned(true);
		if (props.open) return;
		if (props.columnOpen || turn === dismissed()) return;
		props.onOpenChange(true);
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	/*
	 * Follow the stream while it grows — and only while it grows: a stream that
	 * scrolls itself while you are reading three replies back is the single most
	 * annoying thing a chat surface does, so reading up unpins and a new turn
	 * re-pins, exactly as the sheet does.
	 */
	createEffect(() => {
		if (!props.open || !scroller) return;
		rows().length;
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

	const onScroll = () => {
		const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		setPinned(slack < 40);
	};

	return (
		<Show when={rows().length > 0 && !props.columnOpen}>
			<section class="chat-float" data-open={props.open} aria-label="The conversation, floating">
				<button
					class="fclose"
					type="button"
					title="Hide the floating chat — it comes back for the next turn"
					aria-label="Hide the floating chat"
					onClick={() => {
						setDismissed(newestTurn());
						props.onOpenChange(false);
					}}
				>
					<Icon of={X} size={14} />
				</button>
				<div class="fsroll" ref={scroller} onScroll={onScroll}>
					<For each={rows()}>
						{(row) => <Row row={row} turn={turnById().get(row.turnId)} onScrub={props.onScrub} />}
					</For>
				</div>
			</section>
		</Show>
	);
}

/**
 * One floating bubble.
 *
 * Everything is a button where there is something to rewind to; the turn it opens
 * is the conversation address of the row, not the row itself — a reply is read in
 * the sheet, which is where its actions live.
 */
function Row(props: { row: FloatRow; turn: Turn | undefined; onScrub: (turn: Turn) => void }) {
	const scrub = () => {
		const turn = props.turn;
		if (turn) props.onScrub(turn);
	};
	return (
		<Switch>
			<Match when={props.row.kind === "user"}>
				<button class="fbubble" data-who="user" type="button" onClick={scrub} onWheel={wheel} title="Open the conversation at this turn">
					{(props.row as Extract<FloatRow, { kind: "user" }>).text}
				</button>
			</Match>
			<Match when={props.row.kind === "assistant"}>
				<button class="fbubble" data-who="agent" type="button" onClick={scrub} onWheel={wheel} title="Open the conversation at this turn">
					<For each={splitFences((props.row as Extract<FloatRow, { kind: "assistant" }>).text)}>
						{(block) => (block.code ? <pre>{block.text}</pre> : <span>{block.text}</span>)}
					</For>
					<Show when={(props.row as Extract<FloatRow, { kind: "assistant" }>).streaming}>
						<span class="caret" />
					</Show>
				</button>
			</Match>
			<Match when={props.row.kind === "tools"}>
				<Tools row={props.row as Extract<FloatRow, { kind: "tools" }>} onScrub={scrub} />
			</Match>
			<Match when={props.row.kind === "notice"}>
				<div class="fnotice" data-level={(props.row as Extract<FloatRow, { kind: "notice" }>).level} onWheel={wheel}>
					{(props.row as Extract<FloatRow, { kind: "notice" }>).text}
				</div>
			</Match>
		</Switch>
	);
}

/** A turn's tool calls, one slim row; the count is the point, the last call the colour. */
function Tools(props: { row: Extract<FloatRow, { kind: "tools" }>; onScrub: () => void }) {
	const last = () => props.row.names.at(-1) ?? "";
	const label = () =>
		props.row.names.length === 1
			? `1 tool call · ${last()}`
			: `${props.row.names.length} tool calls · ${last()}`;
	return (
		<button class="ftools" data-state={props.row.running ? "running" : props.row.failed ? "error" : "done"} type="button" onClick={props.onScrub} onWheel={wheel} title="Open the conversation at this turn">
			<span class="fdot" />
			<span class="fcount">{props.row.names.length}</span>
			<span class="fname">{last()}</span>
			<span class="fmore">{props.row.names.length > 1 ? "calls" : "call"}</span>
		</button>
	);
}

/**
 * The wheel, taken over wherever a bubble is under the cursor.
 *
 * The float lets clicks through between bubbles, which means it is not itself a
 * pointer target and cannot be relied on to catch the wheel — so the bubbles take
 * it themselves, scroll the stream, and let nothing pass to the boards underneath.
 */
function wheel(event: WheelEvent): void {
	event.preventDefault();
	const scroller = (event.currentTarget as HTMLElement).parentElement;
	if (scroller) scroller.scrollTop += event.deltaY;
}