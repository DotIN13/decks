import type { ChatItem } from "@decks/protocol";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, Show } from "solid-js";
import { Icon } from "../icons.tsx";

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
			<button class="row" type="button" data-open={open()} onClick={() => setOpen(!open())}>
				<span class="state" />
				{/* The row has always been a disclosure without looking like one. The chevron
				    says so, and turns rather than being swapped for a second icon. */}
				<Icon of={ChevronRight} class="twist" size={12} />
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
