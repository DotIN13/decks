import { createSignal, Index, Match, Show, Switch } from "solid-js";
import type { ToolItem } from "./float-rows.ts";
import { Markdown } from "./Markdown.tsx";
import { TimeMachine } from "./TimeMachine.tsx";
import { ToolGroup } from "./ToolGroup.tsx";

/** A piece of what the agent did in one turn, in the order it happened. */
export type AgentPart =
	| { kind: "text"; id: string; text: string; streaming: boolean; thinking?: string }
	| { kind: "tools"; id: string; calls: ToolItem[] };

/**
 * One card in the column.
 *
 * A turn is one card however many calls it made — `parts` is what the agent did, in order,
 * and the card is the object the reader drags their eye down. Notices are their own card
 * rather than a line inside one: a failure to launch is not something the agent said, and
 * burying it in a reply's card is how it gets missed.
 */
export type TurnCard =
	| { kind: "mine"; id: string; at?: number; text: string; entryId?: string }
	| { kind: "agent"; id: string; at?: number; parts: AgentPart[] }
	| { kind: "notice"; id: string; at?: number; level: "info" | "warn" | "error"; text: string };

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
								<ToolGroup calls={(part() as Extract<AgentPart, { kind: "tools" }>).calls} />
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
}) {
	return (
		<div class="stream-mine" data-card data-item={props.card.id}>
			{/*
			 * Only once the message has an `entryId`. The server pairs each one with the
			 * session entry it became, and until that has happened there is nothing to address
			 * a rewind to — a button that cannot say where it is going is worse than no button.
			 */}
			<Show when={props.card.entryId}>
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
			 * actually received.
			 */}
			<div class="stream-bubble" title={props.when}>
				{props.card.text}
			</div>
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
		return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	} catch {
		return undefined;
	}
}
