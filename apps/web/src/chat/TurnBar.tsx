import type { ChatItem } from "@decks/protocol";
import { Index, Show } from "solid-js";

/**
 * The conversation as a spine at the edge of the canvas.
 *
 * The chat panel is away by default (DESIGN §7), which leaves a question: how do you
 * know anything was said, and how do you get back to the part you want? A scrollbar
 * of turns answers both. One block per turn, newest at the bottom, stacked against
 * the edge — it is always there, it costs a few pixels, and it says at a glance how
 * much has happened and whether something is happening now.
 *
 * Clicking a block opens the panel *around that turn* rather than at the bottom,
 * because the reason to reach for a transcript is usually something specific that
 * scrolled away.
 */

export interface Turn {
	/** The id of the first item in the turn, which is what the panel scrolls to. */
	id: string;
	label: string;
	tools: number;
	state: "done" | "running" | "error";
	/** Arrived while the panel was away. */
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
	/** The turn the panel is currently showing, if it was opened at one. */
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
							type="button"
							class="turn"
							data-state={turn().state}
							data-unseen={turn().unseen}
							data-current={props.at === turn().id}
							title={`${turn().label}${turn().tools > 0 ? ` · ${turn().tools} tool call${turn().tools === 1 ? "" : "s"}` : ""}`}
							onClick={() => props.onPick(turn())}
						/>
					)}
				</Index>
			</nav>
		</Show>
	);
}

function first(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}
