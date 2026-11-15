import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, Index, Show } from "solid-js";
import { Icon } from "@decks/ui";
import type { ToolSlot } from "./model.ts";
import type { ChatItem } from "@decks/protocol";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { askFullResult, awaitingResult, fullResult } from "./actions.ts";

// A turn's tool calls inside its card: a group as a count, each call as a row, its output behind the row.

/** A turn's tool calls, inside the turn's own card. */
export function ToolGroup(props: { slots: ToolSlot[] }) {
	return (
		<div class="stream-tools">
			{/*
			 * `Index`, not `For`. The slots are recomputed on every token that arrives, a reply streams while
			 * its tool calls sit above it, and `For` keys by reference, so each recomputation would replace
			 * every row and shut whichever chip was open.
			 */}
			<Index each={props.slots}>
				{(slot) => {
					const grouped = () => (slot().kind === "group" ? (slot() as Extract<ToolSlot, { kind: "group" }>) : undefined);
					const bare = () => (slot().kind === "call" ? (slot() as Extract<ToolSlot, { kind: "call" }>) : undefined);
					return (
						<Show when={grouped()} fallback={<Show when={bare()}>{(one) => <ToolChip item={one().call} />}</Show>}>
							{(group) => <Group slot={group()} alone={props.slots.length === 1} />}
						</Show>
					);
				}}
			</Index>
		</div>
	);
}

/** The header over the calls that went as expected, and it is one of those rows itself. */
function Group(props: { slot: Extract<ToolSlot, { kind: "group" }>; alone: boolean }) {
	const [open, setOpen] = createSignal(false);
	const count = () => props.slot.calls.length;
	const names = () => (props.slot.more > 0 ? `${props.slot.names.join(" · ")} +${props.slot.more}` : props.slot.names.join(" · "));
	const word = () => (props.alone ? (count() === 1 ? "tool" : "tools") : "done");

	return (
		/* `data-group` names the row for a check without giving it a look of its own, from the outside it is a `.tool` like every other row here, which is the point. */
		<div class="tool" data-group data-state="done">
			<button
				class="row"
				type="button"
				data-open={open()}
				aria-expanded={open()}
				aria-label={`${count()} finished tool calls: ${props.slot.names.join(", ")}`}
				title={open() ? "Hide these calls" : "Show these calls"}
				onClick={() => setOpen(!open())}
			>
				<span class="state" aria-hidden="true" />
				<span class="name">
					{count()} {word()}
				</span>
				<span class="title">{names()}</span>
				<Icon of={ChevronRight} class="twisty" size={12} />
			</button>
			{/*
			 * Opened, the calls are *nested* and otherwise unchanged: same row, same glyphs, same type, hanging
			 * off a rule that lands under the header's own state cell.
			 */}
			<Show when={open()}>
				<div class="tool-kids">
					<Index each={props.slot.calls}>{(call) => <ToolChip item={call()} />}</Index>
				</div>
			</Show>
		</div>
	);
}

/** A tool call, as one line: what happened, what ran, what it ran on, and a way in. */
export function ToolChip(props: { item: Extract<ChatItem, { kind: "tool" }> }) {
	const [open, setOpen] = createSignal(false);
	/*
	 * The whole output once it has been fetched, else what came with the row, which for a long
	 * output is a preview, with `full` saying how long the whole of it is (`agents/wire.ts`).
	 */
	const result = () => (fullResult(props.item.id) ?? props.item.result)?.trimEnd() ?? "";
	const partial = () => props.item.full !== undefined && fullResult(props.item.id) === undefined;
	/*
	 * Nothing to open is not a disclosure. A running call has no output yet and some tools
	 * never return text, so the chevron is absent and the button is `disabled`, which is
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
				onClick={() => {
					const opening = !open();
					// The preview is there at once; the rest is asked for the first time it is wanted, // before opening, so the line under it says it is on its way from the first frame.
					if (opening && partial()) askFullResult(props.item.id);
					setOpen(opening);
				}}
			>
				{/*
					A fixed cell whatever is in it, so the names line up down the column, a
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
					    convention everywhere a row opens, picone swaps `chevron-down` for
					    `chevron-up` and the two are the same picture at rest. */}
					<Icon of={ChevronRight} class="twisty" size={12} />
				</Show>
			</button>
			<Show when={open() && result()}>
				<pre>{result()}</pre>
				<Show when={partial()}>
					<p class="more">
						{awaitingResult(props.item.id)
							? "Loading the rest…"
							: `The first ${result().length.toLocaleString()} of ${(props.item.full ?? 0).toLocaleString()} characters.`}
					</p>
				</Show>
			</Show>
		</div>
	);
}
