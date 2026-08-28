import type { ChatItem } from "@decks/protocol";
import { createEffect, createMemo, Show } from "solid-js";

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
	/** The last assistant message, and whether it is still arriving. */
	const latest = createMemo(() => {
		for (let index = props.items.length - 1; index >= 0; index -= 1) {
			const item = props.items[index];
			if (item?.kind === "user") return undefined; // Newer than the last reply: nothing to show yet.
			if (item?.kind === "assistant") {
				const text = item.text.trim();
				return text ? { text, streaming: item.streaming === true, id: item.id } : undefined;
			}
		}
		return undefined;
	});

	let body!: HTMLButtonElement;
	/*
	 * Follow the text while it arrives, then go back to the beginning.
	 *
	 * Following is right mid-reply — the newest words are the interesting ones — but a
	 * finished message left scrolled to its end opens mid-sentence, which reads as if the
	 * start had been lost. Once it has stopped growing, the top is where a reader starts.
	 */
	createEffect(() => {
		const current = latest();
		if (!current || !body) return;
		body.scrollTop = current.streaming ? body.scrollHeight : 0;
	});

	return (
		<Show when={!props.columnOpen && latest()?.id !== props.dismissed && latest()}>
			{(current) => (
				<div class="latest" data-streaming={current().streaming}>
					<button
						class="body"
						type="button"
						ref={body}
						title="Open the chat"
						onClick={() => props.onOpen()}
					>
						{current().text}
					</button>
					<button class="dismiss" type="button" title="Dismiss" onClick={() => props.onDismiss(current().id)}>
						×
					</button>
				</div>
			)}
		</Show>
	);
}
