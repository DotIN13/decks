import type { AgentUsage } from "@decks/protocol";
import { Show } from "solid-js";
import { contextLevel, contextPercent } from "./context-usage.ts";

/**
 * How full the context is, as a ring.
 *
 * Drawn in two places and therefore a component: at the right end of the hint row under the
 * input bar (`composer/ContextDial.tsx`) and in the `⋯` menu's one row on a touchscreen. It
 * was written out twice before, which is how the two came to disagree about the radius.
 *
 * Nothing is drawn when the reading is unknown — `contextTokens` is `number | null` and the
 * null means "the agent has not reported yet", before the first reply and in the window
 * after a compaction. A ring at zero would say the context is *empty*, which is a different
 * and usually false claim, and the one somebody would act on.
 */
export function ContextRing(props: { usage: AgentUsage | undefined; size?: number }) {
	const size = () => props.size ?? 16;
	/* The radius leaves room for the stroke: half of 2.4 on each side of the arc. */
	const radius = () => size() / 2 - 2;
	/** The circumference, so `stroke-dasharray` can be read as a percentage. */
	const ring = () => 2 * Math.PI * radius();

	return (
		<Show when={contextPercent(props.usage)}>
			{(value) => (
				<svg
					class="ctx-ring"
					data-level={contextLevel(props.usage) ?? "normal"}
					width={size()}
					height={size()}
					viewBox={`0 0 ${size()} ${size()}`}
					aria-hidden="true"
				>
					<circle class="track" cx={size() / 2} cy={size() / 2} r={radius()} fill="none" stroke-width="2.4" />
					<circle
						class="fill"
						cx={size() / 2}
						cy={size() / 2}
						r={radius()}
						fill="none"
						stroke-width="2.4"
						stroke-linecap="round"
						/* From twelve o'clock, filling clockwise, like every dial. */
						transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
						stroke-dasharray={`${(Math.min(value(), 100) / 100) * ring()} ${ring()}`}
					/>
				</svg>
			)}
		</Show>
	);
}
