import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import { For, Show, type JSX } from "solid-js";
import { Icon } from "@decks/ui";
import { contextLevel, contextPercent, usageLevel } from "../../lib/context-usage.ts";
import type { AgentUsage, PlanLimit, SessionSpend, UsageReport, UsageShare, UsageWindow } from "../../state/types/index.ts";
import { ago, behaviorLabel, duration, exact, modelLabel, money, planLabel, resetsAt, resetsIn, tokens } from "../usage-format.ts";
import { createUsage } from "./actions.ts";
import { noLimitsWords, whoseLimits } from "./model.ts";

// The usage panel: this conversation's context and spend, the plan's limits and
// whose they are, and what has been using them over a day or a week.

export type UsageProps = { usage: AgentUsage | undefined; report: UsageReport | undefined; error: string | undefined; loading: boolean; at: number | undefined; onRefresh: () => void; onClose: () => void };
type U = { props: UsageProps; u: ReturnType<typeof createUsage> };

export function UsageModal(props: UsageProps): JSX.Element {
	const u = createUsage(() => props.onClose());
	return (
		<div class="picker-backdrop" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
			<div class="panel-float usage-modal static flex max-h-[86%] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden p-0" role="dialog" aria-label="Usage">
				<Head props={props} u={u} />
				<div class="set-body">
					<Show when={props.error}>{(message) => <p class="usage-stale">Could not read usage: {message()}</p>}</Show>
					<Show when={props.loading && props.report && props.at}>{(at) => <p class="usage-reading">Reading again — figures from {ago(at(), u.now())}.</p>}</Show>
					<Conversation props={props} u={u} />
					<Limits props={props} u={u} />
					<Uses props={props} u={u} />
				</div>
			</div>
		</div>
	);
}

function Head(p: U): JSX.Element {
	return (
		<header class="set-head">
			<span class="set-head-title">Usage</span>
			<span class="flex-1" />
			<button class="icon-button [--control:26px]" classList={{ "usage-spin": p.props.loading }} type="button" title="Read again" aria-label="Read again" disabled={p.props.loading} onClick={p.props.onRefresh}>
				<Icon of={RefreshCw} size={14} />
			</button>
			<button class="icon-button [--control:26px]" type="button" title="Close" aria-label="Close" onClick={p.props.onClose}>
				<Icon of={X} size={15} />
			</button>
		</header>
	);
}

// This conversation: its figures and its models.
function Conversation(p: U): JSX.Element {
	const percent = () => contextPercent(p.props.usage);
	return (
		<section class="set-group" data-group="conversation">
			<header>
				<span class="set-title">This conversation</span>
				<span class="set-note">what it has spent, and how full its window is</span>
			</header>
			<div class="usage-pad">
				<Show when={percent() !== undefined} fallback={<p class="usage-empty">No reading yet. An agent reports its context after its first reply.</p>}>
					<div class="usage-headline">
						<span class="big">{Math.round(percent() ?? 0)}%</span>
						<span class="meta">of the context window</span>
					</div>
					<div class="track" data-level={contextLevel(p.props.usage)}>
						<i style={{ width: `${Math.min(percent() ?? 0, 100)}%` }} />
					</div>
					<p class="usage-note">
						{exact(p.props.usage?.contextTokens ?? 0)} of {exact(p.props.usage?.contextWindow ?? 0)} tokens
					</p>
				</Show>
				<Show when={p.props.report?.session} fallback={<Reading loading={p.props.loading} />}>
					{(spend) => <Facts spend={spend()} />}
				</Show>
			</div>
			<Models {...p} />
		</section>
	);
}

function Models(p: U): JSX.Element {
	return (
		<Show when={p.props.report?.session.models.length}>
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
					<For each={p.props.report?.session.models ?? []}>
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
	);
}

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

// The plan's windows.
function Limits(p: U): JSX.Element {
	return (
		<section class="set-group" data-group="limits">
			<header>
				<span class="set-title">Plan limits</span>
				<Show when={whoseLimits(p.props.report)} fallback={<span class="set-note">what the subscription has left</span>}>
					{(subject) => <span class="set-note">{subject()}</span>}
				</Show>
			</header>
			<div class="usage-pad">
				<Show when={p.props.report} fallback={<Reading loading={p.props.loading} />}>
					{(report) => (
						<Show when={report().limits?.length} fallback={<p class="usage-empty">{noLimitsWords(report())}</p>}>
							<ul class="usage-limits">
								<For each={report().limits ?? []}>{(limit) => <Limit limit={limit} now={p.u.now()} />}</For>
							</ul>
						</Show>
					)}
				</Show>
			</div>
		</section>
	);
}

/** One plan window: how full, how long until it turns over, and whether it is in force. */
function Limit(props: { limit: PlanLimit; now: number }) {
	const until = () => resetsIn(props.limit.resetsAt, props.now);
	/**
	 * The line under the bar: the countdown, or why there is not one.
	 *
	 * A window the account is not currently subject to is drawn and marked rather than left
	 * out, because "which limits does this account have" is a question the panel should be
	 * able to answer — but it is not the one you are about to hit, so it says so and its bar
	 * is uncoloured.
	 */
	const foot = () => {
		const left = until();
		if (!props.limit.active) return left ? `not in force · turns over in ${left}` : "not in force";
		if (!left) return null;
		return left === "now" ? "resetting now" : `resets in ${left}`;
	};

	return (
		<li class="usage-limit" classList={{ dormant: !props.limit.active }}>
			<div class="usage-limit-head">
				<span class="usage-limit-label">{props.limit.label}</span>
				<span class="usage-limit-value">{props.limit.percent === null ? "—" : `${Math.round(props.limit.percent)}%`}</span>
			</div>
			<Meter percent={props.limit.percent} flat={!props.limit.active} />
			<Show when={foot()}>
				{(line) => (
					/* The countdown is the answer; the wall-clock time is for deciding whether to
					   wait, so it is one hover away. */
					<span
						class="usage-limit-reset"
						title={props.limit.active ? (resetsAt(props.limit.resetsAt, props.now) ?? undefined) : "A window this plan carries and this account is not on right now"}
					>
						{line()}
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

// What has been using them, over a day or a week.
function Uses(p: U): JSX.Element {
	const scan = () => (p.u.span() === "day" ? p.props.report?.behaviors?.day : p.props.report?.behaviors?.week);
	return (
		<Show when={p.props.report?.behaviors}>
			<section class="set-group" data-group="behaviors">
				<header>
					<span class="set-title">What's using it</span>
					<span class="set-note">as the runtime scans this machine</span>
					<span class="flex-1" />
					<div class="segmented">
						<For each={["day", "week"] as const}>
							{(option) => (
								<button type="button" data-on={p.u.span() === option} onClick={() => p.u.setSpan(option)}>
									{option === "day" ? "24 hours" : "7 days"}
								</button>
							)}
						</For>
					</div>
				</header>
				<Show when={scan()}>{(window) => <Behaviors window={window()} />}</Show>
			</section>
		</Show>
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
