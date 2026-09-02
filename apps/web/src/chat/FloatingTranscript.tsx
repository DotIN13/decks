import type { ChatItem } from "@decks/protocol";
import ArchiveRestore from "lucide-solid/icons/archive-restore";
import GitBranch from "lucide-solid/icons/git-branch";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";
import { Markdown } from "./Markdown.tsx";
import { floatRows, type FloatRow } from "./float-rows.ts";
import { attachSwipeClose } from "./swipe-close.ts";
import { ToolChip } from "./ToolChip.tsx";

/**
 * The conversation, floating over the boards as bubbles — and the only transcript
 * there is.
 *
 * There used to be two of these: a 380px sheet that slid in from the right edge with
 * the full history in it, and this, a dim condensation of the newest turn floating over
 * the canvas. Two surfaces for one conversation, and the one that could
 * actually be read was the one nobody could find — the sheet was away by default,
 * summoned by a cursor approaching an edge, and everything it could do the float had a
 * dimmer, click-through version of. So the sheet is gone and the bubbles took its job:
 * the whole history, scrollable, with the time machine on each message where it always
 * was.
 *
 * What it keeps from the float is the shape. Nothing here has a background of its own —
 * the rows are painted and the gaps between them are the boards, which is what keeps a
 * column of replies from reading as a panel. What it takes from the sheet is being
 * *deliberate*: it opens and closes from one button in the title bar, or with a swipe from
 * the right edge and back out again, rather than appearing on its own for every turn.
 * That matters more now that it can be scrolled
 * and clicked in, because a surface you can scroll is a surface that swallows the
 * canvas's wheel; one that arrives uninvited would swallow it uninvited.
 *
 * The dock's peek (`Latest`) covers what the float used to cover by appearing on its
 * own: the newest reply, one glance, over the input bar, without a panel.
 */
export function FloatingTranscript(props: {
	items: ChatItem[];
	/** Whether the history is up. Owned by App, which also quiets the dock's peek while it is. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** An item to bring into view — the turn the spine was clicked at. */
	scrollTo?: { id: string; at: number };
	/**
	 * The time machine, addressed to the message it belongs to.
	 *
	 * These live on the user's own messages rather than on a separate bar: the message
	 * *is* the point you rewind to, and a second row of notches over the same list was
	 * the same thing drawn twice.
	 */
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	let sheet!: HTMLElement;
	let scroller!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);

	const rows = createMemo(() => floatRows(props.items));
	/** Which item each row belongs to, so `entryId` can be found for a user bubble. */
	const itemById = createMemo(() => new Map(props.items.map((item) => [item.id, item])));

	/*
	 * A swipe toward the right edge puts the history away, and releasing mid-gesture
	 * puts it back — the same rule iOS and Android use for a sheet. Vertical drags are
	 * never touched, so scrolling the history still scrolls.
	 */
	onMount(() => {
		const detach = attachSwipeClose(sheet, () => props.open, () => props.onOpenChange(false));
		onCleanup(detach);
	});

	/*
	 * Follow the stream while it grows — and only while it grows: a stream that
	 * scrolls itself while you are reading three replies back is the single most
	 * annoying thing a chat surface does. Reading up unpins; scrolling back to the
	 * bottom re-pins.
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

	/*
	 * Opening at the bottom, unless it was opened *at* something.
	 *
	 * A fresh open should show the newest turn — that is what the peek was showing
	 * when it was clicked.
	 */
	createEffect(() => {
		if (!props.open) return;
		setPinned(true);
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	/**
	 * The scroll request already carried out, so it is not carried out again.
	 *
	 * `scrollTo` is not a one-shot event — it is also what the spine reads to mark the
	 * block you are looking at, so `App` keeps it set. Without this guard every reopen and
	 * every arriving message replayed a jump to a turn clicked long ago, and scrolling back
	 * down was pointless because the next frame threw you up again. Keyed on `at` as well
	 * as `id`, so clicking the same block twice is a new request and does return to it.
	 */
	let travelled: string | undefined;
	createEffect(() => {
		const target = props.scrollTo;
		if (!target || !props.open || !scroller) return;
		const key = `${target.id}:${target.at}`;
		if (travelled === key) return;
		props.items.length;
		requestAnimationFrame(() => {
			const element = scroller.querySelector(`[data-item="${cssEscape(target.id)}"]`);
			// Not marked as travelled: the history can be open before it has arrived, and
			// this effect re-runs when the items do. Marking here would swallow the one
			// request that was going to work.
			if (!element) return;
			travelled = key;
			setPinned(false);
			/*
			 * Instant, not smooth. A jump almost always starts from the bottom — you have
			 * been watching the reply arrive — so the first frames of a smooth scroll are
			 * still *at* the bottom, `onScroll` reads slack ≈ 0, re-pins, and the
			 * follow-the-bottom effect above yanks it straight back down.
			 */
			element.scrollIntoView({ block: "start", behavior: "auto" });
		});
	});

	const onScroll = () => {
		const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		setPinned(slack < 40);
	};

	return (
		/*
		 * Always rendered, even with nothing in it.
		 *
		 * It used to appear only once there was a row to show, which was right while it
		 * arrived on its own and wrong now that there is a button for it: a control that
		 * does nothing on a fresh agent is a control that looks broken. Empty, it says so.
		 */
		<section
			class="chat-float"
			ref={sheet}
			data-open={props.open}
			aria-label="The conversation"
		>
			<div class="fsroll" ref={scroller} onScroll={onScroll}>
				<Show when={rows().length === 0}>
					<div class="fnotice">Nothing said yet — ask for something and it will show up here.</div>
				</Show>
				<For each={rows()}>
					{(row) => (
						<Row
							row={row}
							entryId={
								row.kind === "user"
									? (itemById().get(row.id) as Extract<ChatItem, { kind: "user" }> | undefined)?.entryId
									: undefined
							}
							onPreview={props.onPreview}
							onRewind={props.onRewind}
							onFork={props.onFork}
							onRestore={props.onRestore}
						/>
					)}
				</For>
			</div>
		</section>
	);
}

/** One floating bubble, and whatever it is a way into. */
function Row(props: {
	row: FloatRow;
	/** The session entry a user message became — the address a rewind is sent to. */
	entryId: string | undefined;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	return (
		<Switch>
			<Match when={props.row.kind === "user"}>
				<UserTurn
					row={props.row as Extract<FloatRow, { kind: "user" }>}
					entryId={props.entryId}
					onPreview={props.onPreview}
					onRewind={props.onRewind}
					onFork={props.onFork}
					onRestore={props.onRestore}
				/>
			</Match>
			<Match when={props.row.kind === "assistant"}>
				<Assistant row={props.row as Extract<FloatRow, { kind: "assistant" }>} />
			</Match>
			<Match when={props.row.kind === "tools"}>
				<Tools row={props.row as Extract<FloatRow, { kind: "tools" }>} />
			</Match>
			<Match when={props.row.kind === "notice"}>
				<div class="fnotice" data-item={props.row.id} data-level={(props.row as Extract<FloatRow, { kind: "notice" }>).level}>
					{(props.row as Extract<FloatRow, { kind: "notice" }>).text}
				</div>
			</Match>
		</Switch>
	);
}

/**
 * What the agent said, and what it was thinking if it says.
 *
 * Thinking is a disclosure rather than text, and collapsed by default: it is long, it is
 * not addressed to the reader, and a history that showed it in full would be a history
 * where the reply is the small part.
 */
function Assistant(props: { row: Extract<FloatRow, { kind: "assistant" }> }) {
	const [showThinking, setShowThinking] = createSignal(false);

	return (
		<>
			<Show when={props.row.thinking}>
				{(thinking) => (
					<div class="thinking">
						<button type="button" onClick={() => setShowThinking(!showThinking())}>
							{showThinking() ? "hide thinking" : "thinking…"}
						</button>
						<Show when={showThinking()}>
							<div class="body">{thinking()}</div>
						</Show>
					</div>
				)}
			</Show>

			{/*
			 * The agent's words are markdown; yours are not.
			 *
			 * A reply is written *as* markdown — lists, headings, `code` — and showing its
			 * asterisks makes the reader do the parsing. A message you typed is different: it
			 * is the literal text that was sent, and quietly transforming it would leave you
			 * unable to see what the agent actually received. So one side renders and the
			 * other stays verbatim, which is also why only this branch has a `Markdown`.
			 */}
			<div class="fbubble" data-who="agent" data-item={props.row.id}>
				<Markdown text={props.row.text} trailing={props.row.streaming ? <span class="caret" /> : undefined} />
			</div>
		</>
	);
}

/**
 * A user message, and the way back to it.
 *
 * The actions appear on hover and only once the message has an `entryId` — the server
 * pairs each one with the session entry it became, and until that has happened there is
 * nothing to address a rewind to. (On a touchscreen they are always shown: `hidden until
 * hovered` is hidden forever there, and this is the only route to the time machine.)
 *
 * **Icons, not words.** They were "rewind", "fork" and "restore boards" at 10px, which is
 * three phrases of grey text under every message you have ever sent — a second transcript
 * running down the history, in a smaller font, saying the same three things over and over.
 * The icons are the same size as the rest of the chrome's, they read as controls rather than
 * as more prose, and the sentence each one was standing in for is in its tooltip, where it is
 * read once rather than continuously.
 *
 * Hovering **rewind** previews immediately: the canvas renders that point from the
 * revision store, and leaving puts it back. No dwell delay, because you only get here by
 * reaching for the action itself.
 */
function UserTurn(props: {
	row: Extract<FloatRow, { kind: "user" }>;
	entryId: string | undefined;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	return (
		<div class="turn-row" data-item={props.row.id}>
			<div class="fbubble" data-who="user">
				{props.row.text}
			</div>
			<Show when={props.entryId}>
				{(entryId) => (
					<div class="turn-actions">
						<button
							type="button"
							data-act="rewind"
							title="Rewind to just before this message. Hover to see the boards as they were."
							aria-label="Rewind to just before this message"
							onMouseEnter={() => props.onPreview(entryId())}
							onMouseLeave={() => props.onPreview(null)}
							onFocus={() => props.onPreview(entryId())}
							onBlur={() => props.onPreview(null)}
							onClick={() => {
								props.onPreview(null);
								props.onRewind(entryId());
							}}
						>
							<Icon of={RotateCcw} size={13} />
						</button>
						<button
							type="button"
							data-act="fork"
							title="Carry on from here in a new chat, keeping this one as it is"
							aria-label="Fork a new chat from here"
							onClick={() => props.onFork(entryId())}
						>
							<Icon of={GitBranch} size={13} />
						</button>
						<button
							type="button"
							data-act="restore"
							title="Write the boards back to how they were at this point. The conversation stays where it is."
							aria-label="Restore the boards to this point"
							onClick={() => props.onRestore(entryId())}
						>
							<Icon of={ArchiveRestore} size={13} />
						</button>
					</div>
				)}
			</Show>
		</div>
	);
}

/**
 * A turn's tool calls: one slim pill, and the calls themselves when asked for.
 *
 * A turn that edits files is mostly tool calls, and printing each one in full is a
 * transcript nobody reads — so the count is the default and the last call's name is the
 * colour. Opening it hands each call to the same `ToolChip` the column used, which is
 * where a call's output has always lived.
 */
function Tools(props: { row: Extract<FloatRow, { kind: "tools" }> }) {
	const [open, setOpen] = createSignal(false);
	const last = () => props.row.calls.at(-1)?.name ?? "";
	const count = () => props.row.calls.length;

	return (
		<div class="ftools-group" data-item={props.row.id}>
			<button
				class="ftools"
				data-state={props.row.running ? "running" : props.row.failed ? "error" : "done"}
				data-open={open()}
				type="button"
				title={open() ? "Collapse these tool calls" : "Show these tool calls"}
				aria-expanded={open()}
				onClick={() => setOpen(!open())}
			>
				<span class="fdot" />
				<span class="fcount">{count()}</span>
				<span class="fname">{last()}</span>
				<span class="fmore">{count() > 1 ? "calls" : "call"}</span>
			</button>
			<Show when={open()}>
				<div class="fcalls">
					<For each={props.row.calls}>{(call) => <ToolChip item={call} />}</For>
				</div>
			</Show>
		</div>
	);
}

/** An item id is user data; escape it before it goes in a selector. */
function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
