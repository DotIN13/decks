import type { ChatItem } from "@decks/protocol";
import { createSignal, Show } from "solid-js";

/**
 * A tool call, collapsed to one line.
 *
 * The transcript of an agent that edits files is mostly tool calls, and a column
 * that prints each one in full is a column nobody reads. So each is a row — name,
 * what it was called on, a state dot — and the output is there when you ask for it.
 * The title comes from the server (`titleFor`), because what identifies a call
 * depends on the tool and the server is where the tool is known.
 */
export function ToolChip(props: { item: Extract<ChatItem, { kind: "tool" }> }) {
	const [open, setOpen] = createSignal(false);
	const result = () => props.item.result?.trimEnd() ?? "";

	return (
		<div class="tool" data-item={props.item.id} data-state={props.item.state}>
			<button class="row" type="button" onClick={() => setOpen(!open())}>
				<span class="state" />
				<span class="name">{props.item.name}</span>
				<span class="title">{props.item.title}</span>
				<Show when={props.item.images}>{(count) => <span class="name">{count()} img</span>}</Show>
			</button>
			<Show when={open() && result()}>
				<pre>{result()}</pre>
			</Show>
		</div>
	);
}
