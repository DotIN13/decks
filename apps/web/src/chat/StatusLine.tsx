import type { AgentKind, AgentState } from "@decks/protocol";
import { Show } from "solid-js";
import { toggleHistory } from "../lib/edge.ts";
import { AgentMark } from "./agent-marks.tsx";

/**
 * The one row above the input bar that says whether anything is happening.
 *
 * **Three words, not one.** "Working…" for a turn that has started and has nothing to read
 * yet, "typing…" for the moment an answer is visibly arriving, and "running tools…" for the
 * long pause with no text in it. It was two before, which put the state where an answer is
 * arriving under the same word as the state where nothing is — and the difference is exactly
 * the one that decides whether it is worth opening the conversation to watch.
 *
 * **And nothing at all when the agent is idle.** No "Ada replied", no last line, no tick:
 * status only. A row that reports the *absence* of work is a row you learn to stop reading,
 * and it would be there for all of the time the app is not doing anything, which is most of
 * it.
 *
 * **But the row keeps its height.** This is the whole reason it is a wrapper with a
 * `<Show>` inside rather than a component that renders nothing: in picone's first draft the
 * sign *was* the row, so finishing a turn removed it and the composer slid down by its
 * height — at the exact moment the reader starts reading the answer. Reserved, the input bar
 * never moves between turns.
 *
 * **It is a button, because the one thing to do about "it is working" is go and watch.** It
 * hands off to `lib/edge.ts` rather than owning any state of its own — the same press, from
 * the same one bit, as the button in the corner cluster.
 */
export function StatusLine(props: {
	state: AgentState;
	/** Whose work it is. Only spoken when the agent is the one waiting. */
	name: string;
	/** Which runtime, for its own mark. */
	agent: AgentKind;
	/** The agent's colour (`Identity.color`), if it has one, for the mark in motion. */
	color?: string;
}) {
	const words = (): string | undefined => {
		switch (props.state) {
			case "thinking":
				return "working…";
			case "streaming":
				return "typing…";
			case "tool":
				return "running tools…";
			case "waiting":
				// Not work in progress at all: the agent asked *you* something, so the mark
				// stands still and the words name whose move it is.
				return `${props.name} is waiting for you`;
			default:
				return undefined;
		}
	};
	const working = () => props.state === "thinking" || props.state === "streaming" || props.state === "tool";

	return (
		/*
		 * `pointer-events-none` on the row and back on for the chip: the reserved height is
		 * full-width and mostly empty, and an empty strip across the canvas that swallowed
		 * clicks would be a 28px band above the composer where the boards stopped answering.
		 */
		<div class="pointer-events-none flex h-[28px] items-center" aria-live="polite">
			<Show when={words()}>
				{(said) => (
					<button
						class="statusline pointer-events-auto"
						type="button"
						data-working={working()}
						title="Show the conversation"
						style={props.color ? { "--mark": props.color } : undefined}
						onClick={toggleHistory}
					>
						{/*
						 * The agent's own mark, moving — rather than a generic spinner, so the sign
						 * says whose work it is as well as that there is some (picone §58).
						 *
						 * One element breathing, where picone stacks ten frames with staggered delays.
						 * It needed the stack because its frames are *different glyphs* and only CSS
						 * could pick between them without a re-render; a mark that is one drawing can
						 * be scaled and faded in place, which costs one element and cannot fall out of
						 * step. Either way the important half holds: a turn that runs four minutes
						 * costs the same as one that runs four seconds, because nothing re-renders.
						 */}
						<AgentMark agent={props.agent} class="mark" size={13} />
						<span>{said()}</span>
					</button>
				)}
			</Show>
		</div>
	);
}
