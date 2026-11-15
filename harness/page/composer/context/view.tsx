import type { AgentUsage } from "@decks/protocol";
import { For, Show } from "solid-js";
import { Popover, Icon } from "@decks/ui";
import { ContextRing } from "../../shell/index.ts";
import { contextLevel, contextPercent } from "../../lib/index.ts";
import Gauge from "lucide-solid/icons/gauge";
import { openUsage } from "./actions.ts";
import { dialLabel, usageRows } from "./model.ts";

/** How full the context is, at the right end of the hint row. */
export function ContextDial(props: {
	usage: AgentUsage | undefined;
	/** The runtime's own usage report, which is what the old percentage chip opened. */
	onUsage: () => void;
}) {
	/*
	 * `contextPercent` and `contextLevel` come from `lib/context-usage.ts` rather than being computed
	 * here, which is where they went when this file was deleted and is where they should stay: the
	 * thresholds are 70 and 85, the null case is load-bearing (`contextTokens` is `number | null`.
	 */
	const percent = () => contextPercent(props.usage);
	let dismiss: (() => void) | undefined;

	return (
		<Show when={percent()}>
			{(value) => (
				<Popover
					placement="top-end"
					class="w-[min(280px,calc(100vw-16px))]"
					label="Context and cost"
					trigger={(api) => {
						dismiss = () => {
							if (api.open) api.toggle();
						};
						return (
							<button
								ref={api.ref}
								class="dial"
								type="button"
								data-level={contextLevel(props.usage) ?? "normal"}
								aria-haspopup="menu"
								aria-expanded={api.open}
								aria-label={dialLabel(value())}
								onClick={api.toggle}
							>
								{/* The ring is `shell/ContextRing.tsx`, shared with the `⋯` row on a
								    touchscreen — it was written out in both and the two drifted apart on
								    the radius. */}
								<ContextRing usage={props.usage} size={16} />
								{Math.round(value())}%
							</button>
						);
					}}
				>
					{/*
					 * The numbers themselves are `ContextSummary`: the glance, and the row that opens the whole
					 * reading.
					 */}
					<ContextSummary usage={props.usage} onUsage={() => openUsage(dismiss, props.onUsage)} />
				</Popover>
			)}
		</Show>
	);
}

/** How full the context is, and what the conversation has cost, inside the corner's `⋯`. */
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

					<For each={usageRows(props.usage)}>
						{(row) => (
							<div class="pair">
								<span class="kv-key">{row.key}</span>
								<span class="kv-value">{row.value}</span>
							</div>
						)}
					</For>

					{/*
					 * There used to be two more rows here: "Compact now" and "Compact automatically", both drawn
					 * disabled, on the argument that the question after "how full is it" is always "what do I do about
					 * it", so a row saying *not yet* answers it once, where an absence leaves the reader hunting.
					 */}
					<div class="rule" />

					{/* The way through to the whole reading. */}
					<button
						data-row
						data-flat="true"
						type="button"
						onClick={() => props.onUsage()}
					>
						<Icon of={Gauge} size={14} class="shrink-0 text-muted" />
						<span class="row-label">Usage and limits</span>
					</button>
				</>
			)}
		</Show>
	);
}
