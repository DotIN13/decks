import type { AgentKind, AgentState } from "@decks/protocol";
import { Show } from "solid-js";
import { historyShown, toggleHistory } from "../lib/edge.ts";
import { AgentMark } from "./agent-marks.tsx";
import { isWorking, signPlacement, workingWords } from "./working-sign.ts";

/**
 * The mark and the words, without any chrome of its own.
 *
 * Two callers put it in different boxes — a pill over the composer, a card at the foot of the
 * column — and everything about *what it says* is here, so the two cannot come to disagree
 * about what "typing" means.
 */
export function WorkingSign(props: { state: AgentState; name: string; agent: AgentKind }) {
	return (
		<>
			{/*
			 * The agent's own mark, moving — rather than a generic spinner, so the sign says
			 * whose work it is as well as that there is some (picone §58). Claude steps through
			 * ten glyph frames, Pi builds its logo out of character cells; the drawings and the
			 * reasoning behind them are in `agent-marks.tsx`.
			 */}
			<AgentMark agent={props.agent} class="mark" size={13} busy={isWorking(props.state)} />
			<span>{workingWords(props.state, props.name)}</span>
		</>
	);
}

/**
 * The one row above the input bar that says whether anything is happening.
 *
 * What it says, and *whether this is the surface that says it*, are both in
 * `working-sign.ts` — the words because they are worth three states rather than one, and the
 * placement because the conversation draws the same sign at its foot and only one of the two
 * may ever be up. Nothing at all when the agent is idle: a row that reports the absence of
 * work is a row you learn to stop reading, and it would be there for all of the time the app
 * is doing nothing, which is most of it.
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
	/*
	 * Whether the sign is *this* surface's to draw — `working-sign.ts` decides, because the
	 * column draws one too and both deciding for themselves is how they end up both up at
	 * once, 12px apart, saying the same thing.
	 *
	 * The **row keeps its height** whatever the answer, which is the whole reason this is a
	 * wrapper with a `<Show>` inside: reserved, the input bar does not move when a turn ends
	 * or when the conversation opens.
	 */
	const mine = () => signPlacement(props.state, { historyOpen: historyShown(), arriving: false }) === "dock";
	const working = () => isWorking(props.state);

	return (
		/*
		 * `pointer-events-none` on the row and back on for the chip: the reserved height is
		 * full-width and mostly empty, and an empty strip across the canvas that swallowed
		 * clicks would be a 28px band above the composer where the boards stopped answering.
		 */
		<div class="statusrow pointer-events-none flex h-[28px] items-center" aria-live="polite">
			<Show when={mine()}>
				<button
					class="statusline pointer-events-auto"
					type="button"
					data-working={working()}
					title="Show the conversation"
					onClick={toggleHistory}
				>
					<WorkingSign state={props.state} name={props.name} agent={props.agent} />
				</button>
			</Show>
		</div>
	);
}
