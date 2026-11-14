import type { AgentKind, AgentState } from "@decks-next/protocol";
import { Show } from "solid-js";
import { historyShown } from "../edge.ts";
import { showConversation } from "./actions.ts";
import { AgentMark } from "@decks/ui";
import { isWorking, signPlacement, workingWords } from "./model.ts";

/** The mark and the words, without any chrome of its own. */
export function WorkingSign(props: { state: AgentState; name: string; agent: AgentKind }) {
	return (
		<>
			{/*
			 * The agent's own mark, moving, rather than a generic spinner, so the sign says whose work it is as
			 * well as that there is some (picone §58).
			 */}
			<AgentMark agent={props.agent as Parameters<typeof AgentMark>[0]["agent"]} class="mark" size={13} busy={isWorking(props.state)} />
			<span>{workingWords(props.state, props.name)}</span>
		</>
	);
}

/** The one row above the input bar that says whether anything is happening. */
export function StatusLine(props: {
	state: AgentState;
	/** Whose work it is. Only spoken when the agent is the one waiting. */
	name: string;
	/** Which runtime, for its own mark. */
	agent: AgentKind;
}) {
	/*
	 * Whether the sign is *this* surface's to draw, `working-sign.ts` decides, because the column draws
	 * one too and both deciding for themselves is how they end up both up at once, 12px apart, saying the
	 * same thing.
	 */
	const mine = () => signPlacement(props.state, { historyOpen: historyShown(), arriving: false }) === "dock";
	const working = () => isWorking(props.state);
	/* Whether the dock is the surface that *could* be showing a sign right now. */
	const reserved = () => !historyShown();

	return (
		/*
		 * `pointer-events-none` on the row and back on for the chip: the reserved height is full-width and
		 * mostly empty, and an empty strip across the canvas that swallowed clicks would be a 28px band above
		 * the composer where the cards stopped answering.
		 */
		<Show when={reserved()}>
			<div class="statusrow pointer-events-none flex h-[28px] items-center" aria-live="polite">
				<Show when={mine()}>
					<button
						class="statusline pointer-events-auto"
						type="button"
						data-working={working()}
						title="Show the conversation"
						onClick={showConversation}
					>
						<WorkingSign state={props.state} name={props.name} agent={props.agent} />
					</button>
				</Show>
			</div>
		</Show>
	);
}
