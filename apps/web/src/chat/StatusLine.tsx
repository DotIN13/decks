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
		<div class="statusrow pointer-events-none flex h-[28px] items-center" aria-live="polite">
			<Show when={words()}>
				{(said) => (
					<button
						class="statusline pointer-events-auto"
						type="button"
						data-working={working()}
						title="Show the conversation"
						onClick={toggleHistory}
					>
						{/*
						 * The agent's own mark, moving — rather than a generic spinner, so the sign
						 * says whose work it is as well as that there is some (picone §58).
						 *
						 * Picone's actual marks, and not the still one animated. This was one element
						 * on a scale-and-fade loop, on the argument that a single drawing can breathe
						 * without a second one: what it looked like was a flower opening and closing,
						 * because Claude's burst is a ten-pointed star and the loop was tinted with
						 * the agent's identity colour. So a working Claude is the asterisk its own CLI
						 * cycles, stepping through ten glyphs, and a working Pi builds its logo out of
						 * character cells in reading order. The cost is unchanged and it is the part
						 * that matters: the animation is CSS on a fixed stack, so a turn that runs
						 * four minutes costs what one that runs four seconds costs.
						 *
						 * No identity colour on it either. The mark in motion is the *runtime's* — the
						 * one place in this app where a drawing is not the colour of the text beside
						 * it — and an agent whose colour happened to be green got a green bloom over
						 * the input bar. Whose turn it is, is what the words say.
						 */}
						<AgentMark agent={props.agent} class="mark" size={13} busy={working()} />
						<span>{said()}</span>
					</button>
				)}
			</Show>
		</div>
	);
}
