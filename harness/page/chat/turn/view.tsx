import { Icon } from "@decks/ui";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import GitBranch from "lucide-solid/icons/git-branch";
import { clockTime } from "@decks/ui";
import { createEffect, createSignal, Index, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { MessagePart } from "@decks/protocol";
import type { Draft } from "../../composer/draft/model.ts";
import { closePillCard, pillNode, wirePills, type PillHost } from "../../composer/pill/card.ts";
import { drawMine, setMineReader } from "./actions.ts";
import { Markdown } from "../markdown/view.tsx";
import { TimeMachine } from "../time-machine/view.tsx";
import { ToolGroup } from "../tool/view.tsx";
import type { AgentPart, TurnCard } from "./model.ts";

// One card of the conversation: your message with its way back, the agent's turn, or a notice.

/* A card, and the pieces of one, belong to the turn's cards now. */
export type { AgentPart, TurnCard };

export { setMineReader };

/** A sent message read back into the words and pills it was written as, and what each pill is about. */
export interface MineReading {
	draft: Draft;
	pills: PillHost;
}

/** Reads a sent message into its pills: from its stored `parts` when it has them, else from its text. */
export type MineReader = (text: string, parts?: MessagePart[]) => MineReading | undefined;

/** One turn, as a card floating over the cards. */
export function Turn(props: {
	card: TurnCard;
	/** Whether the canvas is currently previewing this message's point in history. */
	previewing?: boolean;
	/** The time machine, addressed to the message it belongs to. */
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
	/** False where the host cannot rewind or fork: no time machine. `"buttons"`: Rewind and Fork as icon buttons under the message (Studio). */
	timeMachine?: boolean | "buttons";
}) {
	const when = () => clock(props.card.at);

	return (
		<Switch>
			<Match when={props.card.kind === "mine"}>
				<Mine
					card={props.card as Extract<TurnCard, { kind: "mine" }>}
					when={when()}
					previewing={props.previewing}
					onPreview={props.onPreview}
					onRewind={props.onRewind}
					onFork={props.onFork}
					onRestore={props.onRestore}
					timeMachine={props.timeMachine}
				/>
			</Match>

			<Match when={props.card.kind === "agent"}>
				{/*
				 * `article`, and no heading in it. The card is a self-contained thing a reader can be moved
				 * between, which is what the role is for, but a heading per reply would put every turn of every
				 * conversation into the page's outline, which is a worse document than none.
				 */}
				<article class="stream-card flex flex-col gap-2" data-card data-item={props.card.id} title={when()}>
					<Index each={(props.card as Extract<TurnCard, { kind: "agent" }>).parts}>
						{(part) => (
							<Show
								when={part().kind === "tools"}
								fallback={<Said part={part() as Extract<AgentPart, { kind: "text" }>} />}
							>
								<ToolGroup slots={(part() as Extract<AgentPart, { kind: "tools" }>).slots} />
							</Show>
						)}
					</Index>
				</article>
			</Match>

			<Match when={props.card.kind === "notice"}>
				<div
					class="stream-card stream-notice"
					data-card
					data-item={props.card.id}
					data-level={(props.card as Extract<TurnCard, { kind: "notice" }>).level}
					title={when()}
				>
					{(props.card as Extract<TurnCard, { kind: "notice" }>).text}
				</div>
			</Match>
		</Switch>
	);
}

/** Your own message, and the way back to it. */
function Mine(props: {
	card: Extract<TurnCard, { kind: "mine" }>;
	when: string | undefined;
	previewing?: boolean;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
	/** False where the host cannot rewind or fork: no time machine. `"buttons"`: Rewind and Fork as icon buttons under the message (Studio). */
	timeMachine?: boolean | "buttons";
}) {
	return (
		<div class="stream-mine" data-card data-item={props.card.id}>
			{/*
			 * Only once the message has an `entryId`. The server pairs each one with the
			 * session entry it became, and until that has happened there is nothing to address
			 * a rewind to, a button that cannot say where it is going is worse than no button.
			 */}
			<Show when={props.timeMachine !== false && props.timeMachine !== "buttons" && props.card.entryId}>
				{(entryId) => (
					<TimeMachine
						entryId={entryId()}
						previewing={props.previewing}
						onPreview={props.onPreview}
						onRewind={props.onRewind}
						onFork={props.onFork}
						onRestore={props.onRestore}
					/>
				)}
			</Show>
			{/* Verbatim, where the agent's side is markdown. */}
			<div class="stream-bubble" title={props.when}>
				<MineWords text={props.card.text} parts={props.card.parts} />
			</div>
			{/* Studio's way: the two acts as icon buttons under the bubble, once the message has an entry to address. */}
			<Show when={props.timeMachine === "buttons" && props.card.entryId}>
				{(entryId) => (
					<div class="stream-acts">
						<button type="button" class="stream-act" title="Rewind to here: take back everything after it, and these words go back into the input bar" aria-label="Rewind to here" onClick={() => props.onRewind(entryId())}>
							<Icon of={RotateCcw} size={13} />
							<span>Rewind</span>
						</button>
						<button type="button" class="stream-act" title="Fork from here: a new conversation that remembers everything up to this message" aria-label="Fork from here" onClick={() => props.onFork(entryId())}>
							<Icon of={GitBranch} size={13} />
							<span>Fork</span>
						</button>
					</div>
				)}
			</Show>
		</div>
	);
}

/** A message's words with its pills in them, as the field drew them. */
function MineWords(props: { text: string; parts?: MessagePart[] }) {
	let el!: HTMLSpanElement;
	let host: PillHost | undefined;
	createEffect(() => {
		host = drawMine(el, props.text, props.parts);
	});
	onMount(() => onCleanup(wirePills(el, () => host, pillNode)));
	onCleanup(closePillCard);
	return <span ref={el} />;
}

/** What the agent said, and what it was thinking if it says. */
function Said(props: { part: Extract<AgentPart, { kind: "text" }> }) {
	const [shown, setShown] = createSignal(false);

	return (
		<>
			<Show when={props.part.thinking}>
				{(thinking) => (
					<div class="stream-thinking">
						<button type="button" aria-expanded={shown()} onClick={() => setShown(!shown())}>
							{shown() ? "hide thinking" : "thinking…"}
						</button>
						<Show when={shown()}>
							<div class="body">{thinking()}</div>
						</Show>
					</div>
				)}
			</Show>
			{/* No caret, deliberately. */}
			<Markdown text={props.part.text} />
		</>
	);
}

/** The time, for a `title`, and nothing else. */
function clock(at: number | undefined): string | undefined {
	if (!at) return undefined;
	try {
		return clockTime(at);
	} catch {
		return undefined;
	}
}
