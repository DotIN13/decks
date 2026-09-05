import type { AgentUsage } from "@decks/protocol";
import Gauge from "lucide-solid/icons/gauge";
import { Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { contextLevel, contextPercent } from "./context-usage.ts";

/** Thousands separated, because these are read at a glance and not counted digit by digit. */
const figure = (value: number) => value.toLocaleString("en-US");

/**
 * How full the context is, and what the conversation has cost — inside the corner's `⋯`.
 *
 * This was a dial: a small ring and a percentage under the input bar, at the right end of
 * the hint row, drawn all the time. It reads better in the menu and the reason is the one
 * that put it below the box in the first place. Everything in the composer changes what the
 * *next* turn does; this changes nothing at all — it reports what the turns you already
 * have have cost. That argument does not stop at the edge of the box: a number nobody acts
 * on is a number to go and look up, and `⋯` is where this app keeps the things you go and
 * look up.
 *
 * What is lost by moving it is the glance — a ring quietly turning amber was a warning you
 * did not have to ask for. That is why `contextLevel` is exported from `context-usage.ts`
 * and why the `⋯` button wears it: the alarm stays on the outside of the menu, and only the
 * numbers move in.
 *
 * Nothing is drawn at all until the agent has reported a reading — see `contextPercent`,
 * where the null that means "not known yet" is argued.
 */
export function ContextSummary(props: {
	usage: AgentUsage | undefined;
	/** Open the usage panel: the plan's windows, the per-model spend, the scan (`UsageModal`). */
	onUsage: () => void;
}) {
	const percent = () => contextPercent(props.usage);

	return (
		<Show when={percent()}>
			{(value) => (
				<>
					{/* Reading is the common case, so the numbers come before the one thing to do. */}
					<div class="flex items-baseline gap-2 px-2 pt-1 pb-2">
						<span class="big">{Math.round(value())}%</span>
						<span class="meta flex-1">of the context window</span>
					</div>
					<div class="track mx-2 mb-2" data-level={contextLevel(props.usage)}>
						<i style={{ width: `${Math.min(value(), 100)}%` }} />
					</div>

					<div class="kv">
						<span class="k">Used</span>
						<span class="v">{figure(props.usage?.contextTokens ?? 0)}</span>
					</div>
					<div class="kv">
						<span class="k">Window</span>
						<span class="v">{figure(props.usage?.contextWindow ?? 0)}</span>
					</div>
					<div class="kv">
						<span class="k">This session</span>
						<span class="v">${(props.usage?.cost ?? 0).toFixed(3)}</span>
					</div>

					{/*
					 * There used to be two more rows here: "Compact now" and "Compact
					 * automatically", both drawn disabled, on the argument that the question after
					 * "how full is it" is always "what do I do about it" — so a row saying *not
					 * yet* answers it once, where an absence leaves the reader hunting.
					 *
					 * They are gone because this is a general menu now rather than a panel of its
					 * own: two permanently dead rows in the list you reach for settings and the
					 * theme is furniture, and on a phone the whole corner folds into here. The
					 * work they were waiting for is unchanged and still unstarted —
					 * `{ type: "agent.compact", id }`, answered by the same `agent.usage` event
					 * this reading comes from, and `{ type: "agent.autoCompact", id, on }` with
					 * the flag mirrored onto `AgentChat` so a switch has something true to draw.
					 * Build those and the rows belong right here.
					 */}
					<div class="rule" />

					{/*
					 * The way through to the whole reading.
					 *
					 * It used to send a message that made the *runtime* format its figures into
					 * strings and push them back as a card above the input bar. It opens a panel in
					 * the browser now (`chat/UsageModal.tsx`), which is why the label can promise
					 * limits: there is somewhere for a meter and a countdown to go.
					 */}
					<button
						data-row
						data-flat="true"
						type="button"
						onClick={() => props.onUsage()}
					>
						<Icon of={Gauge} size={14} class="shrink-0 text-muted" />
						<span class="lb">Usage and limits</span>
					</button>
				</>
			)}
		</Show>
	);
}
