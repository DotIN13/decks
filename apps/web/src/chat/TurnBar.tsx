import type { ChatItem } from "@decks/protocol";
import { Index, Show } from "solid-js";

/**
 * The conversation as a spine at the edge of the canvas.
 *
 * The conversation is away by default (DESIGN §7), which leaves a question: how do you
 * know anything was said, and how do you get back to the part you want? A scrollbar
 * of turns answers both. One block per turn, newest at the bottom, stacked against
 * the edge — it is always there, it costs a few pixels, and it says at a glance how
 * much has happened and whether something is happening now.
 *
 * Clicking a block opens the conversation *around that turn* rather than at the bottom,
 * because the reason to reach for a transcript is usually something specific that
 * scrolled away.
 *
 * **Hovering one says what it was**, in a label to the left of the bar. Ten pixels of
 * coloured block is enough to count turns and to aim at one, and no help at all in picking
 * *which* — so this used to be the `title` attribute, which is a tooltip the browser draws
 * where it likes, after a delay it chooses, in a font that is not this app's. It appeared
 * under the cursor, which on this edge is over the block you are trying to read past.
 * Drawn here instead: to the left, immediately, vertically centred on its own block.
 */

export interface Turn {
	/** The id of the first item in the turn, which is what the history scrolls to. */
	id: string;
	label: string;
	tools: number;
	state: "done" | "running" | "error";
	/** Arrived while the conversation was away. */
	unseen: boolean;
}

/**
 * Group a transcript into turns.
 *
 * A turn starts at a user message and runs until the next one — the agent's reply,
 * its tool calls and any notices belong to what was asked. Anything before the first
 * user message (a start-up notice, a failure to launch) is a turn of its own, because
 * it is exactly the kind of thing worth being able to click back to.
 */
export function turnsOf(items: ChatItem[], seenBefore: number): Turn[] {
	const turns: Turn[] = [];
	let current: Turn | undefined;

	const start = (id: string, label: string) => {
		current = { id, label, tools: 0, state: "done", unseen: false };
		turns.push(current);
	};

	for (const item of items) {
		if (item.kind === "user") {
			start(item.id, first(item.text) || "…");
			if (item.at > seenBefore) current!.unseen = true;
			continue;
		}
		if (!current) start(item.id, item.kind === "notice" ? first(item.text) : "before you asked");

		if (item.kind === "tool") {
			current!.tools++;
			if (item.state === "running") current!.state = "running";
			else if (item.state === "error" && current!.state !== "running") current!.state = "error";
		}
		if (item.kind === "assistant") {
			if (item.streaming) current!.state = "running";
			if (item.at > seenBefore) current!.unseen = true;
			// The reply is a better label than the question once there is one to show.
			if (item.text.trim() && current!.label === "…") current!.label = first(item.text);
		}
		if (item.kind === "notice" && item.level === "error" && current!.state !== "running") current!.state = "error";
	}

	return turns;
}

export function TurnBar(props: {
	turns: Turn[];
	/** The turn the conversation is currently showing, if it was opened at one. */
	at: string | undefined;
	onPick: (turn: Turn) => void;
}) {
	return (
		<Show when={props.turns.length > 0}>
			<nav class="turnbar" aria-label="Conversation">
				{/*
					`Index`, not `For`: the turns are positional data, and `For` keys by
					reference — so every recomputation replaced all of the blocks, taking the
					one under the cursor with it. `Index` updates them in place.
				*/}
				<Index each={props.turns}>
					{(turn) => (
						<button
							// `group` and `relative` are what the label hangs off; the rest of the
							// block's own drawing is `.turn` in the stylesheet, which has its state
							// colours, its widening hover and its fingertip size on a touchscreen.
							class="turn group relative"
							type="button"
							data-state={turn().state}
							data-unseen={turn().unseen}
							data-current={props.at === turn().id}
							// The accessible name the `title` used to be: the block has no text of
							// its own, so without this it is a button that announces nothing.
							aria-label={summary(turn())}
							onClick={() => props.onPick(turn())}
						>
							{/*
								Never a hit target: it hangs over the canvas and, at the widest, over a
								board — a tooltip that swallowed the click under it would make the right
								edge of the screen unusable while the cursor rested on the spine.

								One line, because it is a glance. `turnsOf` already caps the label at 90
								characters, and the rest gives way to an ellipsis rather than wrapping into
								a paragraph nobody asked to read.

								Gone entirely on a touchscreen. There is no hovering there — a tap is the
								whole gesture and it opens the turn, so the label would arrive with nothing
								left to decide and then linger over the canvas until something else was
								tapped, which is how a phone browser emulates `:hover`.
							*/}
							<span class="pointer-events-none absolute top-1/2 right-[calc(100%+8px)] max-w-[min(320px,45vw)] -translate-y-1/2 truncate rounded-control border border-line bg-panel px-2 py-1 text-left text-[11px] leading-normal text-fg opacity-0 shadow-panel transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:hidden">
								{turn().label}
								<Show when={turn().tools > 0}>
									<span class="text-faint"> · {turn().tools} tool{turn().tools === 1 ? "" : "s"}</span>
								</Show>
							</span>
						</button>
					)}
				</Index>
			</nav>
		</Show>
	);
}

/** What a block says when the cursor rests on it, and what it announces to a reader. */
function summary(turn: Turn): string {
	if (turn.tools === 0) return turn.label;
	return `${turn.label} · ${turn.tools} tool call${turn.tools === 1 ? "" : "s"}`;
}

function first(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}
