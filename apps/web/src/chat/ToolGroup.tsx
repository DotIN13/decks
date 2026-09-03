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
 * The header over the calls that went as expected.
 *
 * "4 tools" when that is the whole story, "2 done" when something is still going or went
 * wrong below it — the second wording exists because a bare count over a live row invites
 * the reading "4 tools, one of which is that one", and it is not: the count is of the ones
 * you cannot see.
 *
 * A button, with `aria-expanded`, because it is a disclosure and a keyboard has to be able
 * to reach it. The chevron turns rather than being swapped for a second icon, which is the
 * convention `ToolChip` set.
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
		<div>
			<button
				class="stream-tool-head"
				type="button"
				aria-expanded={open()}
				aria-label={`${count()} finished tool calls: ${summary().names.join(", ")}`}
				title={open() ? "Hide these calls" : "Show these calls"}
				onClick={() => setOpen(!open())}
			>
				<Icon of={ChevronRight} class="twist" size={12} />
				<span class="n">
					{count()} {word()}
				</span>
				<span class="names">{names()}</span>
			</button>
			{/* Indented behind a hairline: the rows belong *to* the header, and an indent says
			    that with no border of their own — three bordered rows inside a bordered card
			    is the box-in-a-box the whole column is trying not to be. */}
			<Show when={open()}>
				<div class="stream-tool-kids">
					<Index each={props.calls}>{(call) => <ToolChip item={call()} />}</Index>
				</div>
			</Show>
		</div>
	);
}
