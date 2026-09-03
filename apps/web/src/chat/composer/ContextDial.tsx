import type { AgentUsage } from "@decks/protocol";
import AlignCenter from "lucide-solid/icons/align-center";
import Gauge from "lucide-solid/icons/gauge";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show } from "solid-js";
import { Icon } from "../../icons.tsx";
import { Popover } from "../../ui/Popover.tsx";

/** The circumference of an r=6 circle, so `stroke-dasharray` can be read as a percentage. */
const RING = 2 * Math.PI * 6;

/** Thousands separated, because these are read at a glance and not counted digit by digit. */
const figure = (value: number) => value.toLocaleString("en-US");

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
	 * `contextTokens` is `number | null` and the null is load-bearing: it means the agent
	 * has not reported yet — before the first reply, and in the window right after a
	 * compaction. **Nothing is drawn at all then.** A ring at zero would say the context is
	 * empty, which is a different and usually false claim from "not known yet", and it is
	 * the reading somebody would act on.
	 *
	 * Tested as `!= null` rather than for truthiness, because zero is a real reading and a
	 * falsy one — that is the bug picone's own comment on this warns about.
	 */
	const percent = () => {
		const usage = props.usage;
		if (!usage || usage.contextTokens == null || usage.contextWindow <= 0) return undefined;
		return (usage.contextTokens / usage.contextWindow) * 100;
	};
	const level = (value: number) => (value >= 85 ? "high" : value >= 70 ? "warn" : "normal");
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
								data-level={level(value())}
								aria-haspopup="menu"
								aria-expanded={api.open}
								aria-label={`Context ${Math.round(value())}% full — the numbers behind it`}
								onClick={api.toggle}
							>
								<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
									<circle class="track" cx="8" cy="8" r="6" fill="none" stroke-width="2.4" />
									<circle
										class="fill"
										cx="8"
										cy="8"
										r="6"
										fill="none"
										stroke-width="2.4"
										stroke-linecap="round"
										/* From twelve o'clock, filling clockwise, like every dial. */
										transform="rotate(-90 8 8)"
										stroke-dasharray={`${(Math.min(value(), 100) / 100) * RING} ${RING}`}
									/>
								</svg>
								{Math.round(value())}%
							</button>
						);
					}}
				>
					{/* Reading is the common case, so the numbers come before the buttons. */}
					<div class="flex items-baseline gap-2 px-2 pt-1 pb-2">
						<span class="big">{Math.round(value())}%</span>
						<span class="meta flex-1">of the context window</span>
					</div>
					<div class="track mx-2 mb-2">
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

					<div class="rule" />

					{/*
					 * The two things worth doing about a full context, and neither is built.
					 *
					 * TODO: both rows need a server message that does not exist yet. Picone has
					 * them as `compactSession` and `setAutoCompaction`; the Decks protocol has
					 * nothing — the two to add to `@decks/protocol` are an
					 * `{ type: "agent.compact", id }` client message, answered by the same
					 * `agent.usage` event the reading already comes from, and an
					 * `{ type: "agent.autoCompact", id, on }` alongside it with the flag mirrored
					 * onto `AgentChat` so this switch has something true to draw.
					 *
					 * Drawn disabled rather than left out, which is a deliberate call and the
					 * board argues it the other way round. The case for showing them: this popup
					 * exists to answer "how full is it", and the next question is always "what do
					 * I do about it" — a row that says *not yet* answers that once, where an
					 * absence leaves the reader hunting for a control the app never had.
					 */}
					<button class="act" type="button" disabled title="Not built yet: compacting needs a server call Decks does not have.">
						<Icon of={AlignCenter} size={14} />
						Compact now
					</button>
					{/* A button rather than a div with a switch in it, so that `disabled` is a real
					    attribute and the row cannot pick up the hover of something you can press. */}
					<button
						class="act"
						type="button"
						disabled
						aria-pressed="false"
						title="Not built yet: automatic compaction needs a server setting Decks does not have."
					>
						<Icon of={RefreshCw} size={14} />
						Compact automatically
						<span class="sw" data-on="false" aria-hidden="true">
							<i />
						</span>
					</button>

					{/*
					 * What the old percentage chip did when you clicked it, kept.
					 *
					 * This dial is the one place in the app already about how much is being
					 * spent, so it is where somebody looks for the runtime's own account of it —
					 * and it is the only route to that panel that is not a typed command.
					 */}
					<button
						data-row
						data-flat="true"
						type="button"
						onClick={() => {
							props.onUsage();
							dismiss?.();
						}}
					>
						<Icon of={Gauge} size={14} class="shrink-0 text-muted" />
						Usage and limits
					</button>
				</Popover>
			)}
		</Show>
	);
}
