import type { ChatItem } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, Show } from "solid-js";
import { Icon } from "../icons.tsx";

/**
 * The newest thing the agent said, floating over the canvas above the input bar.
 *
 * The chat column is away by default and that is the point of the app — boards are the
 * medium, and you should not need the transcript to know what is happening. But "not
 * needing it" is not the same as "never seeing a word": a reply that names the board it
 * just wrote is worth a glance, and hunting for it in a hidden panel made the chat feel
 * like the place the real work was.
 *
 * So the last reply flows here as it arrives, one or two lines of it, where the eye already
 * is. It is a read-only glimpse, not the transcript: click it to open the column properly.
 *
 * ### What is said, and what is happening, are two rows
 *
 * The reply used to vanish the moment you sent the next message, and again whenever the
 * agent's turn was all tool calls: the scan stopped at the first user message it met and
 * gave up, so the float went blank for the whole of a long turn — exactly when a person is
 * most interested in it. Worse, it was blank *because* work was happening, which read as the
 * agent having gone quiet.
 *
 * Now the two are separated. The **text** is the last thing the agent actually said and it
 * stays until it is replaced by more text, across as many user messages and tool calls as it
 * takes. The **work** is whatever is running right now, on its own line underneath with a
 * pulsing dot — the same idiom a running tool has in the column, so the two surfaces agree.
 * Either can be present without the other: a first turn shows only work, and a finished
 * turn only text.
 */
export function Latest(props: {
	items: ChatItem[];
	/** Hidden while the column is open, where the same text is already shown in full. */
	columnOpen: boolean;
	/** The id of a reply the user waved away. */
	dismissed: string | undefined;
	onOpen: () => void;
	onDismiss: (id: string) => void;
}) {
	/**
	 * The last thing the agent said, and whether it is still arriving.
	 *
	 * Scanned to the *last non-empty* assistant message rather than stopping at the newest
	 * item of any kind. An assistant bubble exists with empty text for the moment between a
	 * turn starting and its first token, and a turn that only calls tools leaves one behind
	 * with nothing in it — treating either as "nothing to show" is what made the float blink.
	 */
	const said = createMemo(() => {
		for (let index = props.items.length - 1; index >= 0; index -= 1) {
			const item = props.items[index];
			if (item?.kind !== "assistant") continue;
			const text = item.text.trim();
			if (text) return { text, streaming: item.streaming === true, id: item.id };
		}
		return undefined;
	});

	/** The text to show, unless this is the one the user waved away. */
	const shown = createMemo(() => {
		const current = said();
		return current && current.id !== props.dismissed ? current : undefined;
	});

	/**
	 * The tool calls in flight.
	 *
	 * Dismissing does not suppress this: waving away a reply says "I have read it", not
	 * "stop telling me what you are doing", and hiding progress on a turn already underway
	 * is the blank-float bug again by another route.
	 */
	const running = createMemo(() =>
		props.items.filter((item): item is Extract<ChatItem, { kind: "tool" }> => item.kind === "tool" && item.state === "running"),
	);
	/** The newest call, because that is the one actually happening now. */
	const busy = () => running().at(-1);

	let body: HTMLButtonElement | undefined;
	/*
	 * Follow the text while it arrives, then go back to the beginning.
	 *
	 * Following is right mid-reply — the newest words are the interesting ones — but a
	 * finished message left scrolled to its end opens mid-sentence, which reads as if the
	 * start had been lost. Once it has stopped growing, the top is where a reader starts.
	 */
	createEffect(() => {
		const current = shown();
		if (!current || !body) return;
		body.scrollTop = current.streaming ? body.scrollHeight : 0;
	});

	return (
		<Show when={!props.columnOpen && (shown() !== undefined || running().length > 0)}>
			<div class="latest" data-streaming={shown()?.streaming === true}>
				<div class="stack">
					<Show when={shown()}>
						{(current) => (
							<button class="body" type="button" ref={body} title="Open the chat" onClick={() => props.onOpen()}>
								{current().text}
							</button>
						)}
					</Show>

					<Show when={busy()}>
						{(tool) => (
							<button class="working" type="button" title="Open the chat" onClick={() => props.onOpen()}>
								<span class="state" />
								<span class="name">{tool().name}</span>
								<span class="what">{tool().title}</span>
								{/* Only the count of the others: naming four parallel calls in a
								    one-line strip is four things nobody can read. */}
								<Show when={running().length > 1}>
									<span class="more">+{running().length - 1}</span>
								</Show>
							</button>
						)}
					</Show>
				</div>

				{/* Dismissal is of the message, so there is nothing to dismiss when the float is
				    only reporting work — and a button that removed a progress line the agent is
				    about to replace would be a control that undoes itself. */}
				<Show when={shown()}>
					{(current) => (
						<button
							class="dismiss"
							type="button"
							title="Dismiss"
							aria-label="Dismiss"
							onClick={() => props.onDismiss(current().id)}
						>
							<Icon of={X} size={14} />
						</button>
					)}
				</Show>
			</div>
		</Show>
	);
}
