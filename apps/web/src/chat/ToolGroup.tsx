import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, Index, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import type { ToolItem } from "./float-rows.ts";
import { ToolChip } from "./ToolChip.tsx";
import { distinctNames, toolSlots, type ToolSlot } from "./tool-groups.ts";

/**
 * A turn's tool calls, inside the turn's own card.
 *
 * Three levels, and every one of them is one line until it is asked for: the group is a
 * count, a call is a row, and a call's output is behind that row. `ToolChip` already owns
 * the third level — the output has lived there since the chat column existed — so this only
 * adds the first, and the rules for what may hide are in `tool-groups.ts` where they can be
 * tested.
 *
 * Not a card of its own. A turn that edited three files is *one* object in the column
 * however many calls it made, so these rows sit inside the agent's card with the reply,
 * which is also what keeps the count next to the sentence explaining it.
 */
export function ToolGroup(props: { calls: ToolItem[] }) {
	const slots = () => toolSlots(props.calls);

	return (
		<div class="stream-tools">
			{/*
			 * `Index`, not `For`. The slots are recomputed on every token that arrives — a
			 * reply streams while its tool calls sit above it — and `For` keys by reference, so
			 * each recomputation would replace every row and shut whichever chip was open.
			 * `Index` keys by position and updates in place, which is the same reason
			 * `TurnBar` uses it.
			 */}
			<Index each={slots()}>
				{(slot) => {
					const grouped = () => (slot().kind === "group" ? (slot() as Extract<ToolSlot, { kind: "group" }>) : undefined);
					const bare = () => (slot().kind === "call" ? (slot() as Extract<ToolSlot, { kind: "call" }>) : undefined);
					return (
						<Show when={grouped()} fallback={<Show when={bare()}>{(one) => <ToolChip item={one().call} />}</Show>}>
							{(group) => <Group calls={group().calls} alone={slots().length === 1} />}
						</Show>
					);
				}}
			</Index>
		</div>
	);
}

/**
 * The header over the calls that went as expected — and it is one of those rows itself.
 *
 * "4 tools" when that is the whole story, "2 done" when something is still going or went
 * wrong below it — the second wording exists because a bare count over a live row invites
 * the reading "4 tools, one of which is that one", and it is not: the count is of the ones
 * you cannot see.
 *
 * **The same row, not a header of its own.** It used to be a filled grey pill, which made a
 * group a different species from the calls inside it — and the moment it opened you had a
 * pill with three unpilled rows hanging under it. Now it wears `.tool` like everything else:
 * the count sits in the name's slot, the distinct names sit in the description's, and the
 * chevron is at the right end where a call's is. What is left to say "these belong to that"
 * is the indent, which is all it needs.
 *
 * `data-state="done"` is not decoration either: a group only ever holds calls that finished
 * cleanly — that is what makes them groupable — so it takes the same quiet dot they do.
 */
function Group(props: { calls: ToolItem[]; alone: boolean }) {
	const [open, setOpen] = createSignal(false);
	const count = () => props.calls.length;
	const summary = () => distinctNames(props.calls);
	const names = () => {
		const { names, more } = summary();
		return more > 0 ? `${names.join(" · ")} +${more}` : names.join(" · ");
	};
	const word = () => (props.alone ? (count() === 1 ? "tool" : "tools") : "done");

	return (
		/* `data-group` names the row for a check without giving it a look of its own —
		   from the outside it is a `.tool` like every other row here, which is the point. */
		<div class="tool" data-group data-state="done">
			<button
				class="row"
				type="button"
				data-open={open()}
				aria-expanded={open()}
				aria-label={`${count()} finished tool calls: ${summary().names.join(", ")}`}
				title={open() ? "Hide these calls" : "Show these calls"}
				onClick={() => setOpen(!open())}
			>
				<span class="state" aria-hidden="true" />
				<span class="name">
					{count()} {word()}
				</span>
				<span class="title">{names()}</span>
				<Icon of={ChevronRight} class="twist" size={12} />
			</button>
			{/*
			 * Opened, the calls are *nested* and otherwise unchanged: same row, same glyphs,
			 * same type, hanging off a rule that lands under the header's own state cell. Three
			 * bordered rows inside a bordered card is the box-in-a-box this column is trying not
			 * to be, so the indent is the whole of the difference.
			 */}
			<Show when={open()}>
				<div class="tool-kids">
					<Index each={props.calls}>{(call) => <ToolChip item={call()} />}</Index>
				</div>
			</Show>
		</div>
	);
}
