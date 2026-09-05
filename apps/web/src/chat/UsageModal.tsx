import type { AgentUsage, PlanLimit, SessionSpend, UsageReport, UsageShare, UsageWindow } from "@decks/protocol";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { contextLevel, contextPercent, usageLevel } from "../chrome/context-usage.ts";
import { behaviorLabel, duration, exact, modelLabel, money, planLabel, resetsAt, resetsIn, tokens } from "./usage-format.ts";

/** How often the countdowns move. A window resets in hours; this is plenty. */
const TICK = 30_000;

/**
 * Everything about what an agent is spending, in one panel.
 *
 * ### What this replaced
 *
 * Both runtimes used to answer this by formatting their own figures into strings —
 * `"42% (148000 / 200000 tokens)"` — and handing them to the extension-UI bridge as a list
 * of `label: value` pairs, which the dock drew as a card above the input bar with an OK
 * button. By the time it reached the browser nobody could tell a percentage from a dollar,
 * so nothing could be a meter, nothing could be a countdown, and the plan windows were a
 * sentence. **A runtime formatting its own numbers is a runtime deciding how they are
 * drawn.** The figures are structured now (`UsageReport`) and this file draws them.
 *
 * The reading and the mapping behind it come from picone, which worked out the defensive
 * read of the CLI's `get_usage` payload first (`server/claude/usage.ts`).
 *
 * ### Why this is not picone's dialog
 *
 * picone puts the three questions behind three tabs, because its dialog does not scroll.
 * Here they are three groups on a recessed ground in a scrolling body, which is what
 * `Settings` already is — the app has one modal shape and this is it. It also means the
 * answer to "how full is this conversation" and the answer to "how much of the plan is
 * left" can be read in one look, which is usually why both were wanted.
 *
 * Three questions, and they are genuinely not the same one:
 *
 * 1. **This conversation** — its context window, its cost, its tokens, per model. Drawn
 *    from figures the browser already has plus the report; the context part needs no round
 *    trip, so it is there the instant the modal opens.
 * 2. **The plan** — which window this account is closest to filling, and when it turns
 *    over. Only a Claude agent on a subscription has any; the group says so rather than
 *    drawing empty meters.
 * 3. **What has been using it** — the runtime's own scan of this machine's transcripts,
 *    when it collects one.
 *
 * Read fresh on every opening and never cached between them: two of the three are running
 * totals and the third is a countdown, so figures from an hour ago labelled as usage are
 * worse than no figures.
 */
export function UsageModal(props: {
	/** The cheap reading the browser already has, so the context is drawn immediately. */
	usage: AgentUsage | undefined;
	report: UsageReport | undefined;
	error: string | undefined;
	loading: boolean;
	onRefresh: () => void;
	onClose: () => void;
}) {
	/*
	 * The clock the countdowns are read against, so "resets in 3h 58m" does not sit there
	 * being wrong while the panel is open.
	 */
	const [now, setNow] = createSignal(Date.now());
	/** Which window the scan is shown for. */
	const [span, setSpan] = createSignal<"day" | "week">("day");

	onMount(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK);
		/*
		 * Escape closes it, from anywhere — on the window rather than on the card, for the
		 * reason `Settings` documents: a `keydown` handler on a div only fires while focus is
		 * inside it, and nothing in here takes focus on open.
		 */
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => {
			clearInterval(timer);
			window.removeEventListener("keydown", onKey);
		});
	});

	const percent = () => contextPercent(props.usage);
	const scan = () => (span() === "day" ? props.report?.behaviors?.day : props.report?.behaviors?.week);
	/** The plan and whose it is — the subject every percentage below belongs to. */
	const whose = () => [planLabel(props.report?.subscription ?? null), props.report?.account].filter(Boolean).join(" · ");

	return (
		/*
		 * Dismissed by a press that *begins* on the backdrop: the tap that opened this
		 * produces a `click` at the same coordinates afterwards, and a modal that closes
		 * itself on the way in is worse than one that will not close at all. `FilePicker`
		 * documents this at length and every modal here follows it.
		 */
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<div class="panel-float usage-modal static flex max-h-[86%] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden p-0" role="dialog" aria-label="Usage">
				<header class="set-head">
					<span class="set-head-title">Usage</span>
					<span class="flex-1" />
					{/* Free to press: the reading is a control request to the runtime, not a turn. */}
					<button
						class="iconbtn [--control:26px]"
						classList={{ "usage-spin": props.loading }}
						type="button"
						title="Read again"
						aria-label="Read again"
						disabled={props.loading}
						onClick={props.onRefresh}
					>
						<Icon of={RefreshCw} size={14} />
					</button>
					<button class="iconbtn [--control:26px]" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={15} />
					</button>
				</header>

				<div class="set-body">
					{/*
						A read that failed over figures that may already be on screen.
						
						The stale numbers stay — they were true a minute ago, which is more use than an
						empty panel — but silence would read as a refresh button that does nothing, so
						the failure is said out loud above them.
					*/}
					<Show when={props.error}>{(message) => <p class="usage-stale">Could not read usage: {message()}</p>}</Show>

					{/* --- this conversation ------------------------------------------------- */}

					<section class="set-group" data-group="conversation">
						<header>
							<span class="set-title">This conversation</span>
							<span class="set-note">what it has spent, and how full its window is</span>
						</header>

						<div class="usage-pad">
							<Show
								when={percent() !== undefined}
								fallback={
									/*
									 * `contextTokens` is `number | null` and the null is load-bearing: it
									 * means the agent has not reported yet. A bar at zero would say the
									 * context is empty, which is a different and usually false claim.
									 */
									<p class="usage-empty">No reading yet — an agent reports its context after its first reply.</p>
								}
							>
								{/*
									The percentage and the bar, and **not** the ring as well.
									
									The dial that opens this on a desktop is a ring, so one was drawn here
									too at 34px — three pictures of one number in 60 vertical pixels, and
									the least precise of the three taking the most room. The bar is the arc
									unrolled and can be read to a percent, which is what a panel is for.
								*/}
								<div class="usage-headline">
									<span class="big">{Math.round(percent() ?? 0)}%</span>
									<span class="meta">of the context window</span>
								</div>
								<div class="track" data-level={contextLevel(props.usage)}>
									<i style={{ width: `${Math.min(percent() ?? 0, 100)}%` }} />
								</div>
								<p class="usage-note">
									{exact(props.usage?.contextTokens ?? 0)} of {exact(props.usage?.contextWindow ?? 0)} tokens
								</p>
							</Show>

							<Show when={props.report?.session} fallback={<Reading loading={props.loading} />}>
								{(spend) => <Facts spend={spend()} />}
							</Show>
						</div>

						{/*
							Which model spent it, when the runtime attributes it.
							
							pi keeps one running total for the whole session however many models it has
							been through, so it sends no breakdown rather than one row labelled with
							whatever the model happens to be now — which would attribute every token of
							the conversation to the last thing it was switched to.
						*/}
						<Show when={props.report?.session.models.length}>
							<table class="usage-table">
								<thead>
									<tr>
										<th>Model</th>
										<th>In</th>
										<th>Out</th>
										<th>Cache r/w</th>
										<th>Cost</th>
									</tr>
								</thead>
								<tbody>
									<For each={props.report?.session.models ?? []}>
										{(model) => (
											<tr>
												<td title={model.model}>{modelLabel(model.model)}</td>
												<td>{tokens(model.tokens.input)}</td>
												<td>{tokens(model.tokens.output)}</td>
												<td>
													{tokens(model.tokens.cacheRead)} / {tokens(model.tokens.cacheWrite)}
												</td>
												<td>{money(model.costUsd)}</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</Show>
					</section>

					{/* --- the plan ---------------------------------------------------------- */}

					<section class="set-group" data-group="limits">
						<header>
							<span class="set-title">Plan limits</span>
							{/*
								Whose limits these are.
								
								This install rotates between several Claude subscriptions on its own when
								one runs out (`claude/accounts.ts`), so "42% of the 5-hour window" is a
								reading with no subject until this line says which account it belongs to.
								It is the one field of the report picone had no need for.
							*/}
							<Show when={whose()} fallback={<span class="set-note">what the subscription has left</span>}>
								{(subject) => <span class="set-note">{subject()}</span>}
							</Show>
						</header>

						<div class="usage-pad">
							<Show when={props.report} fallback={<Reading loading={props.loading} />}>
								{(report) => (
									<Show
										when={report().limits?.length}
										fallback={
											/*
											 * Three different nothings, and the difference is worth the words: a
											 * runtime with no notion of a plan, an account that is not on one,
											 * and a plan that reported no active window.
											 */
											<p class="usage-empty">
												{report().kind !== "claude"
													? "A pi agent bills per token and has no plan windows to run out of."
													: report().limits === null
														? "This agent is not running against a claude.ai plan, so there are no windows to report."
														: "The plan reports no active windows."}
											</p>
										}
									>
										<ul class="usage-limits">
											<For each={report().limits ?? []}>{(limit) => <Limit limit={limit} now={now()} />}</For>
										</ul>
									</Show>
								)}
							</Show>
						</div>
					</section>

					{/* --- what has been using it -------------------------------------------- */}

					<Show when={props.report?.behaviors}>
						<section class="set-group" data-group="behaviors">
							<header>
								<span class="set-title">What's using it</span>
								<span class="set-note">as the runtime scans this machine</span>
								<span class="flex-1" />
								<div class="seg">
									<For each={["day", "week"] as const}>
										{(option) => (
											<button type="button" data-on={span() === option} onClick={() => setSpan(option)}>
												{option === "day" ? "24 hours" : "7 days"}
											</button>
										)}
									</For>
								</div>
							</header>

							<Show when={scan()}>{(window) => <Behaviors window={window()} />}</Show>
						</section>
					</Show>
				</div>
			</div>
		</div>
	);
}

/** Waiting for the round trip, or a runtime that will not make one. */
function Reading(props: { loading: boolean }) {
	return <p class="usage-empty">{props.loading ? "Reading…" : "Nothing to report."}</p>;
}

/**
 * The figures for the conversation, drawn only where there are figures.
 *
 * The four clocks are `number | null` in the report and null means *this runtime does not
 * count it* — which is not zero, and drawing it as zero would invent a fact. So a runtime
 * that keeps only tokens and a cost shows five facts, and one that keeps everything shows
 * nine.
 */
function Facts(props: { spend: SessionSpend }) {
	const rows = () => {
		const spend = props.spend;
		const out: { label: string; value: string }[] = [
			{ label: "Cost", value: money(spend.costUsd) },
			{ label: "In", value: tokens(spend.tokens.input) },
			{ label: "Out", value: tokens(spend.tokens.output) },
			{ label: "Cache read", value: tokens(spend.tokens.cacheRead) },
			{ label: "Cache write", value: tokens(spend.tokens.cacheWrite) },
		];
		if (spend.durationMs !== null) out.push({ label: "Elapsed", value: duration(spend.durationMs) });
		if (spend.apiDurationMs !== null) out.push({ label: "API time", value: duration(spend.apiDurationMs) });
		if (spend.linesAdded !== null || spend.linesRemoved !== null) {
			out.push({ label: "Lines", value: `+${spend.linesAdded ?? 0} / −${spend.linesRemoved ?? 0}` });
		}
		return out;
	};

	return (
		<dl class="usage-facts">
			<For each={rows()}>
				{(row) => (
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				)}
			</For>
		</dl>
	);
}

/** One plan window: how full, how long until it turns over. */
function Limit(props: { limit: PlanLimit; now: number }) {
	const until = () => resetsIn(props.limit.resetsAt, props.now);
	return (
		<li class="usage-limit">
			<div class="usage-limit-head">
				<span class="usage-limit-label">{props.limit.label}</span>
				<span class="usage-limit-value">{props.limit.percent === null ? "—" : `${Math.round(props.limit.percent)}%`}</span>
			</div>
			<Meter percent={props.limit.percent} />
			<Show when={until()}>
				{(left) => (
					/* The countdown is the answer; the wall-clock time is for deciding whether to
					   wait, so it is one hover away. */
					<span class="usage-limit-reset" title={resetsAt(props.limit.resetsAt, props.now) ?? undefined}>
						{left() === "now" ? "resetting now" : `resets in ${left()}`}
					</span>
				)}
			</Show>
		</li>
	);
}

/**
 * A share of something, drawn.
 *
 * The bands come from `usageLevel`, the same function the context ring uses, so a bar and a
 * ring a click apart cannot disagree about what nearly-full looks like.
 */
function Meter(props: { percent: number | null; flat?: boolean }) {
	const value = () => Math.max(0, Math.min(100, props.percent ?? 0));
	return (
		<div
			class="track"
			data-level={props.flat ? undefined : usageLevel(props.percent)}
			role="progressbar"
			aria-valuenow={Math.round(value())}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<i style={{ width: `${value()}%` }} />
		</div>
	);
}

/** The scan for one window: what the work looked like, then what it was. */
function Behaviors(props: { window: UsageWindow }) {
	const empty = () =>
		props.window.behaviors.length === 0 &&
		props.window.agents.length === 0 &&
		props.window.skills.length === 0 &&
		props.window.plugins.length === 0 &&
		props.window.mcpServers.length === 0;

	return (
		<div class="usage-pad">
			<p class="usage-note">
				{exact(props.window.requests)} requests across {props.window.sessions} {props.window.sessions === 1 ? "session" : "sessions"}.
			</p>

			<Show when={!empty()} fallback={<p class="usage-empty">Nothing recorded for this window.</p>}>
				<Show when={props.window.behaviors.length}>
					<ul class="usage-limits">
						<For each={props.window.behaviors}>
							{(behavior) => (
								<li class="usage-limit">
									<div class="usage-limit-head">
										<span class="usage-limit-label">{behaviorLabel(behavior.key)}</span>
										<span class="usage-limit-value">{Math.round(behavior.percent)}%</span>
									</div>
									{/* Never coloured: these overlap and do not sum to 100, so an amber bar
									    here would be reporting a limit that is not one. */}
									<Meter percent={behavior.percent} flat />
									<span class="usage-limit-reset">
										{exact(behavior.count)} {behavior.count === 1 ? "request" : "requests"}
									</span>
								</li>
							)}
						</For>
					</ul>
				</Show>

				<Shares title="Agents" shares={props.window.agents} />
				<Shares title="Skills" shares={props.window.skills} />
				<Shares title="Plugins" shares={props.window.plugins} />
				<Shares title="MCP servers" shares={props.window.mcpServers} />
			</Show>
		</div>
	);
}

/** One attribution list, drawn only when it has something in it. */
function Shares(props: { title: string; shares: UsageShare[] }) {
	return (
		<Show when={props.shares.length}>
			<div class="usage-shares">
				<h4 class="label">{props.title}</h4>
				<ul>
					<For each={props.shares}>
						{(share) => (
							<li>
								{/* A plugin id is `plugin:chrome-devtools-mcp:chrome-devtools` and will not
								    always fit. Truncated at the end rather than the start, unlike a path:
								    what identifies one of these is its first segment. */}
								<span class="usage-share-name" title={share.name}>
									{share.name}
								</span>
								<span class="usage-share-pct">{Math.round(share.percent)}%</span>
							</li>
						)}
					</For>
				</ul>
			</div>
		</Show>
	);
}
