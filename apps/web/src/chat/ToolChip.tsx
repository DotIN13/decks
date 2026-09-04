import type { ChatItem } from "@decks/protocol";
import ChevronRight from "lucide-solid/icons/chevron-right";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { createSignal, Show } from "solid-js";
import { Icon } from "../icons.tsx";

/**
 * A tool call, as one line: what happened, what ran, what it ran on, and a way in.
 *
 * The transcript of an agent that edits files is mostly tool calls, and a column that prints
 * each one in full is a column nobody reads. So each is a row and the output is behind it.
 * The title comes from the server (`titleFor`), because what identifies a call depends on
 * the tool and the server is where the tool is known.
 *
 * The shape is picone's `ToolCallView`, which is where these rows should have been looking
 * all along — they read as a log rather than as a list of widgets. Four parts:
 *
 * 1. **The state, and it is two different objects.** A call in flight is a *spinner*: the
 *    only thing worth saying about it is that it has not finished, and motion is the one way
 *    to say that without words. A call that is over is a *dot* — and a quiet grey one,
 *    because success is the state you should be able to skim past. Failure is the exception
 *    and gets a shape of its own rather than a colour: a triangle, which also survives being
 *    read by somebody who cannot tell red from grey.
 * 2. **The name, in mono**, small and uppercase: `read`, `bash`, `stage_eval` — an
 *    identifier, and the string the runtime uses. It gives ground before the title does,
 *    because an MCP tool is called `mcp__server__tool` and would otherwise take the row.
 * 3. **The description** beside it, the widest thing in the row: the path, the command, the
 *    pattern. It is *arguments*, which is code, so it keeps the mono face.
 * 4. **The chevron, at the right end**, and only when there is something behind it. A
 *    disclosure at the end of a row is a column you can run your eye down; on the left it
 *    sat between the state and the name and pushed the two things you read out of line.
 */
export function ToolChip(props: { item: Extract<ChatItem, { kind: "tool" }> }) {
	const [open, setOpen] = createSignal(false);
	const result = () => props.item.result?.trimEnd() ?? "";
	/*
	 * Nothing to open is not a disclosure. A running call has no output yet and some tools
	 * never return text, so the chevron is absent and the button is `disabled` — which is
	 * also what stops a keyboard from tabbing onto a row that cannot answer.
	 */
	const openable = () => result() !== "";

	return (
		<div class="tool" data-item={props.item.id} data-state={props.item.state}>
			<button
				class="row"
				type="button"
				data-open={open()}
				aria-expanded={openable() ? open() : undefined}
				disabled={!openable()}
				title={openable() ? (open() ? "Hide the output" : "Show the output") : undefined}
				onClick={() => setOpen(!open())}
			>
				{/*
					A fixed cell whatever is in it, so the names line up down the column — a
					spinner is 9px, a dot is 5 and the alert is 11, and a row that sized itself to
					its glyph would be a list with a ragged left edge.
				*/}
				<span class="state" aria-hidden="true">
					<Show when={props.item.state === "error"}>
						<Icon of={TriangleAlert} size={11} />
					</Show>
				</span>
				<span class="name">{props.item.name}</span>
				<span class="title">{props.item.title}</span>
				<Show when={props.item.images}>{(count) => <span class="imgs">{count()} img</span>}</Show>
				<Show when={openable()}>
					{/* Turned rather than swapped for a second glyph, which is this app's
					    convention everywhere a row opens — picone swaps `chevron-down` for
					    `chevron-up` and the two are the same picture at rest. */}
					<Icon of={ChevronRight} class="twist" size={12} />
				</Show>
			</button>
			<Show when={open() && result()}>
				<pre>{result()}</pre>
			</Show>
		</div>
	);
}
