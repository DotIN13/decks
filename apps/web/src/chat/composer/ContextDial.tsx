import type { AgentUsage } from "@decks/protocol";
import { Show } from "solid-js";
import { Popover } from "../../ui/Popover.tsx";
import { ContextSummary } from "../../chrome/ContextSummary.tsx";
import { ContextRing } from "../../chrome/ContextRing.tsx";
import { contextLevel, contextPercent } from "../../chrome/context-usage.ts";

/**
 * How full the context is, at the right end of the hint row.
 *
 * **Below the box, not among the controls, and that is the point of the whole redesign.**
 * Everything inside the box changes what the next turn does; this changes nothing at all —
 * it reports what the turn you already have has cost. A percentage chip sitting between the
 * model and the send button competed with both for a glance it does not deserve, and it
 * only lived there because there was no second row for it to live in.
 *
 * Ambient rather than alarming: a small ring that fills as the conversation grows, amber
 * over 70% and red over 85%, which are the two points where the next long turn is the one
 * that gets truncated. Pressing it opens the numbers behind it.
 */
export function ContextDial(props: {
	usage: AgentUsage | undefined;
	/** The runtime's own usage report, which is what the old percentage chip opened. */
	onUsage: () => void;
}) {
	/*
	 * `contextPercent` and `contextLevel` come from `chrome/context-usage.ts` rather than
	 * being computed here, which is where they went when this file was deleted and is where
	 * they should stay: the thresholds are 70 and 85, the null case is load-bearing
	 * (`contextTokens` is `number | null`, meaning "the agent has not reported yet" — before
	 * the first reply and in the window after a compaction), and zero is a real reading that
	 * happens to be falsy. All three are asserted in `context-usage.test.ts`.
	 *
	 * Nothing is drawn at all when it is not known. A ring at zero would say the context is
	 * empty, which is a different and usually false claim from "not known yet".
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
								aria-label={`Context ${Math.round(value())}% full — the numbers behind it`}
								onClick={api.toggle}
							>
								{/* The ring is `chrome/ContextRing.tsx`, shared with the `⋯` row on a
								    touchscreen — it was written out in both and the two drifted apart on
								    the radius. */}
								<ContextRing usage={props.usage} size={16} />
								{Math.round(value())}%
							</button>
						);
					}}
				>
					{/*
						The numbers themselves are `ContextSummary`: the glance, and the row that opens
						the whole reading. They were written out here and again in the phone's modal
						once, which is two descriptions of one thing — and the kind that drifts,
						because a figure added to one is not added to the other.
					*/}
					<ContextSummary usage={props.usage} onUsage={() => {
						dismiss?.();
						props.onUsage();
					}} />
				</Popover>
			)}
		</Show>
	);
}
