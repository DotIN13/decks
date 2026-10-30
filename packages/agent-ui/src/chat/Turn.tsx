import { Icon } from "@decks/ui";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import GitBranch from "lucide-solid/icons/git-branch";
import { clockTime } from "@decks/ui";
import { createEffect, createSignal, Index, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { Draft } from "../composer/draft.ts";
import { closePillCard, pillElement, pillNode, wirePills, type PillHost } from "../composer/pill-card.ts";
import { Markdown } from "./MarkdownView.tsx";
import { TimeMachine } from "./TimeMachine.tsx";
import { ToolGroup } from "./ToolGroup.tsx";
import type { AgentPart, TurnCard } from "./turn-cards.ts";

/*
 * A card, and the pieces of one, are `chat/turn-cards.ts`'s now.
 *
 * They were declared here; the fold moved to its own module, and these are re-exported for the
 * readers that still import them from the component that draws them.
 */
export type { AgentPart, TurnCard };

/**
 * One turn, as a card floating over the boards.
 *
 * **Both speakers get a card, and that is the change.** In the pinned-panel version the
 * agent's replies were flat markdown with no box, because the panel behind them *was* the
 * box. Floating, there is nothing behind them: flat prose would be text lying directly on
 * top of a board's own paragraphs. So the asymmetry moves from *box or no box* to **width
 * and tint** — your turns are narrower, right-aligned and tinted; the agent's take the full
 * column in the panel's own colour.
 *
 * **No name and no timestamp on an agent's card.** One agent owns the window and its name
 * is in the top-left cluster; the alignment already says which side spoke. "Ada 09:12" over
 * every reply was 15px spent restating two facts, over and over, in the narrowest column in
 * the app. The time is on the card's own `title`, for the rare moment it matters — which is
 * a tooltip rather than a layout, because that is the frequency it is wanted at.
 */
export function Turn(props: {
	card: TurnCard;
	/** Whether the canvas is currently previewing this message's point in history. */
	previewing?: boolean;
	/**
	 * The time machine, addressed to the message it belongs to.
	 *
	 * These live on the user's own messages rather than on a separate bar: the message *is*
	 * the point you rewind to, and a second row of notches over the same list was the same
	 * thing drawn twice.
	 */
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
				 * `article`, and no heading in it. The card is a self-contained thing a reader
				 * can be moved between, which is what the role is for — but a heading per reply
				 * would put every turn of every conversation into the page's outline, which is a
				 * worse document than none.
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

/** A sent message read back into the words and pills it was written as, and what each pill is about. */
export interface MineReading {
	draft: Draft;
	pills: PillHost;
}

let mineReader: ((text: string) => MineReading | undefined) | undefined;
/**
 * How the host reads a message you sent back into its pills (`MineReading`): the Decks app knows how
 * comments, boards, items and files are written into a message, and reads them out of the stored text,
 * so a message loaded from history after a reload shows the same pills. Without a reader, or for a
 * message it does not read, the bubble is the text as it was sent.
 */
export function setMineReader(reader: ((text: string) => MineReading | undefined) | undefined): void {
	mineReader = reader;
}

/** A message's words with its pills in them, as the field drew them. */
function MineWords(props: { text: string }) {
	let el!: HTMLSpanElement;
	let host: PillHost | undefined;
	createEffect(() => {
		const reading = mineReader?.(props.text);
		host = reading?.pills;
		if (!reading) {
			el.textContent = props.text;
			return;
		}
		el.replaceChildren(...reading.draft.map((node) => (node.type === "text" ? document.createTextNode(node.text) : pillElement(node))));
		// Not editable here: the attribute is the field's, for its caret.
		for (const pill of el.querySelectorAll<HTMLElement>("[contenteditable]")) pill.removeAttribute("contenteditable");
	});
	onMount(() => onCleanup(wirePills(el, () => host, pillNode)));
	onCleanup(closePillCard);
	return <span ref={el} />;
}

/**
 * Your own message, and the way back to it.
 *
 * The button sits at the bubble's top-left, *outside* the tint: inside it would be a control
 * drawn on top of the words it is about, and the bubble is only 88% of a 320px column. It is
 * hidden until the row is hovered — and hidden by opacity rather than by not being there, so
 * it stays in the tab order and a keyboard can find it without a pointer. On a touchscreen
 * it is simply always shown, because "hidden until hovered" is hidden forever there and this
 * is the only route to the time machine.
 */
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
			 * a rewind to — a button that cannot say where it is going is worse than no button.
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
			{/*
			 * Verbatim, where the agent's side is markdown.
			 *
			 * A reply is *written* as markdown and showing its asterisks makes the reader do
			 * the parsing. A message you typed is different: it is the literal text that was
			 * sent, and quietly transforming it would leave you unable to see what the agent
			 * actually received. The one exception is what you put in, which is drawn as the
			 * pills you wrote it with (`MineWords`), each with its exact text one press away.
			 */}
			<div class="stream-bubble" title={props.when}>
				<MineWords text={props.card.text} />
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

/**
 * What the agent said, and what it was thinking if it says.
 *
 * Thinking is a disclosure and collapsed by default: it is long, it is not addressed to the
 * reader, and a card that showed it in full would be a card where the reply is the small
 * part.
 */
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
			{/*
				No caret, deliberately.
				
				A blinking block at the end of a streaming reply was a second thing on screen
				saying "still going" — the `typing…` indicator says it, in words, in one place
				that does not move. Two signals for one fact, one of which flickered on and off
				twice a second, and the flicker was the whole complaint.
				
				`Markdown`'s `trailing` slot stays: it exists to put something *inside* the last
				block rather than on a line of its own, which is a hard-won piece of layout and
				will be wanted again. Nothing is passed to it today.
			*/}
			<Markdown text={props.part.text} />
		</>
	);
}

/**
 * The time, for a `title` — and nothing else.
 *
 * Locale-formatted rather than a fixed `HH:mm`: it is read by one person on one machine, and
 * a browser already knows whether that person writes 14:30 or 2:30 pm.
 */
function clock(at: number | undefined): string | undefined {
	if (!at) return undefined;
	try {
		return clockTime(at);
	} catch {
		return undefined;
	}
}
