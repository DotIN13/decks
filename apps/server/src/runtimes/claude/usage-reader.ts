import { query, type Query, type SDKControlGetUsageResponse, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "node:os";
import type { AgentUsage, UsageReport } from "@decks/protocol";
import type { AgentBackendContext } from "../../agents/backend.ts";
import { epochMs } from "./accounts.ts";
import { claudeIdentity } from "./auth-command.ts";
import { claudeExecutable } from "./available.ts";
import { eventPercent, toUsageReport } from "./usage.ts";

/**
 * What a Claude session has used, read from the session: the figures after each turn, the full
 * reading the usage panel asks for, and the rate-limit events the CLI sends as a subscription
 * nears its end. `usage.ts` maps what the CLI answers into Decks' report; this is the asking,
 * and it used to be a fifth of `backend.ts`.
 */
export class ClaudeUsageReader {
	/** Cached, because Decks reads usage synchronously and the CLI answers async. */
	private lastUsage: AgentUsage | null = null;
	/** Which limit window has already been warned about, so it is said once and not per turn. */
	private warnedAbout: string | undefined;

	constructor(
		private readonly context: AgentBackendContext,
		/** The open query, which a restart replaces. */
		private readonly session: () => Query,
		/**
		 * The account the session's process was started on. A switch reaches its *turns* (the CLI
		 * reads the credentials again for every message) but not its usage read, which keeps the
		 * login the process started with, so `report` asks a fresh process once the agent has moved.
		 */
		private readonly startedOn: () => string | undefined,
	) {}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	/**
	 * The full reading, for the usage panel.
	 *
	 * Read fresh rather than from the cache: the panel is opened deliberately, so the one
	 * moment it is worth a round trip to the CLI is this one — the cached figures are as old
	 * as the last turn, and a session left idle for an hour would report an hour-old plan
	 * window.
	 *
	 * The mapping lives in `usage.ts` and everything it reads is `unknown`. What this method
	 * adds is the subject: **which account these windows belong to**. An install can have
	 * several Claude subscriptions signed in at once, so "42% of the 5-hour window" is a
	 * reading with nobody attached until the report says whose it is.
	 */
	async report(): Promise<UsageReport> {
		/*
		 * Whose subscription this is, asked of the CLI rather than read off the row.
		 *
		 * The stored label is what the account was called when it was added, and it goes
		 * stale the moment somebody runs `claude auth login` in a terminal — which had the
		 * panel captioned with an account the machine was no longer signed in as. One short
		 * subprocess, and the stored label is still there as the answer when the CLI is slow.
		 */
		const accounts = this.context.accounts;
		/*
		 * This agent's account, not a machine-wide one. The meter says whose subscription is
		 * being spent, and with one per conversation the answer is the conversation's — a
		 * panel naming the install default while the turn bills somewhere else is worse than
		 * no panel.
		 */
		const mine = this.context.account?.id();

		/*
		 * One plan read, and everything else beside it.
		 *
		 * Measured against a live account: `get_usage` is a 2.0 s round trip through the CLI,
		 * `auth status` a 0.36 s subprocess, `getContextUsage` 0.35 s — and **two**
		 * `get_usage` calls are 4.0 s, because the CLI answers control requests one at a
		 * time. This method used to make two of them (`refresh` asks for the session's
		 * cost, and the mapping below asks for the windows) with the subprocess between, in a
		 * chain: 4.9 s of a panel saying "Reading…" for a question it had already asked.
		 *
		 * So the read is started once here and *handed* to `refresh`, rather than
		 * refreshed independently — passing the promise and not the value, because a
		 * `getContextUsage` that queues behind it finishes after the read has settled, and a
		 * value asked for then is a second round trip. Measured at 2.3 s, which is the one
		 * read plus the context reading queued behind it.
		 */
		const plan = this.planUsage();
		/*
		 * The windows of the account the agent is on *now*.
		 *
		 * Measured 2026-10-09 against two real subscriptions: a session moved from one at 60% to
		 * one at 0% sent its next turn on the new one (its rate-limit event said 0%, with the new
		 * account's reset time), while its usage read went on saying 60% for as long as it was
		 * asked. The CLI re-reads its credentials for a message but not for `/oauth/usage`. So
		 * after a switch the windows come from a process started on the new account, and only
		 * the session's own cost still comes from the session.
		 */
		const moved = accounts && mine && this.startedOn() !== undefined && mine !== this.startedOn();
		const windows = moved ? probeUsage(accounts.environmentFor(this.context.toolAgent.id, mine)).then((fresh) => fresh ?? plan) : plan;
		const [usage, identity] = await Promise.all([
			windows,
			accounts ? claudeIdentity(accounts.keychainDir(mine ?? accounts.active()?.id ?? "") || undefined) : Promise.resolve({} as Awaited<ReturnType<typeof claudeIdentity>>),
			this.refresh(plan),
		]);
		return toUsageReport(usage, identity.email ?? (mine ? accounts?.describe(mine)?.email : accounts?.active()?.email) ?? null);
	}

	/**
	 * A subscription reaching its limit — said, not worked around.
	 *
	 * **Nothing switches by itself.** This used to mark the account spent, move the
	 * conversation to the next subscription down the list, and re-send the prompt when the
	 * turn had not touched anything yet. Three things happened without being asked, one of
	 * them mid-turn, and the record of it was a line of transcript nobody was reading at the
	 * time. So what is left is the sentence: which window ran out, whose subscription it was,
	 * when it lifts, and that another one is a press away in the model picker.
	 *
	 * The press is cheap, which is what makes this the right trade: a switch is one `rename`
	 * of a symlink and the CLI re-reads its credentials per request, so choosing another
	 * account and pressing send again spends it on the very next turn — no restart, no lost
	 * conversation. And re-sending is the person's, which is the part a machine should not
	 * guess: Decks agents edit files, and a turn that got three tool calls in before the
	 * refusal cannot simply be replayed.
	 */
	rateLimit(info: SDKRateLimitInfo): void {
		const { notice } = this.context;
		const accounts = this.context.accounts;

		if (info.status === "allowed_warning") {
			/*
			 * Said once per window, not once per event.
			 *
			 * The CLI emits this whenever the figure moves, which near a limit is every turn —
			 * and a warning repeated every turn is one nobody reads. The window it is about is
			 * the key, so a fresh warning about the *seven-day* limit still gets through after
			 * one about the five-hour limit.
			 */
			const window = info.rateLimitType ?? "limit";
			if (this.warnedAbout !== window) {
				this.warnedAbout = window;
				// `eventPercent`, not `Math.round`: this event's figure is a fraction, and rounding it as a
				// percentage is what made every warning say "1% used". See the function for what is known
				// and what is inferred.
				const used = eventPercent(info.utilization);
				const share = used === null ? "" : ` (${used}% used)`;
				notice("warn", `This Claude subscription is close to its ${limitWindow(window)} limit${share}.`);
			}
			return;
		}
		if (info.status !== "rejected") {
			// Back under the limit: the next warning about this window is worth hearing again.
			this.warnedAbout = undefined;
			return;
		}

		// What *this* agent is on, not what the machine is on: two agents can be spending
		// two subscriptions, and the one that refused is the one this session was using.
		const mine = this.context.account?.id();
		const spent = mine ? accounts?.describe(mine) : accounts?.active();
		// Unix seconds on the event, milliseconds everywhere it is compared or shown.
		const reset = resetWords(epochMs(info.resetsAt));
		const window = limitWindow(info.rateLimitType);
		const whose = spent?.email ? `${spent.email}'s` : "This";
		/*
		 * Whether there is anywhere to go, which is the only thing the account list is asked
		 * here — and it decides one clause of a sentence rather than an account switch.
		 *
		 * `signed in and not this one` rather than `not spent`: nothing is marked spent any
		 * more, so the honest offer is "there is another subscription you could put this
		 * conversation on", and whether it has quota left is something only trying it can say.
		 */
		const elsewhere = accounts?.hasOther?.(mine) === true;
		notice(
			"error",
			elsewhere
				? `${whose} Claude subscription has reached its ${window} limit${reset}. Pick another one in the model picker and send again.`
				: `${whose} Claude subscription has reached its ${window} limit${reset}. Add another account in settings, or wait.`,
		);
	}

	/**
	 * Read after each turn, because Decks' `usage()` is synchronous and this is not.
	 *
	 * The plan read is a *promise* and has a default, so a caller with one already in the air
	 * hands it over (`report`) and a caller without one starts it here — started before the
	 * context reading is awaited either way, so the two go together rather than one after the
	 * other. Handing over the value instead of the promise would not work: the context read
	 * queues behind the plan read in the CLI, so by the time it answers the plan read has
	 * settled and asking again is a second two-second round trip.
	 */
	async refresh(plan: Promise<SDKControlGetUsageResponse | undefined> = this.planUsage()): Promise<void> {
		try {
			const context = await this.session().getContextUsage();
			this.lastUsage = {
				contextTokens: context.totalTokens,
				contextWindow: context.maxTokens,
				cost: sessionCost(await plan) ?? this.lastUsage?.cost ?? 0,
			};
		} catch {
			/* a query that has ended has no usage, which is not an error worth raising */
		}
	}

	/**
	 * The whole of what `/usage` knows, or nothing at all.
	 *
	 * Single-flight: a read already in the air is handed to the next caller rather than
	 * joined by a second one. Opening the panel asks this question twice over — once for the
	 * windows and once for the session's cost — and each ask is a two-second round trip to
	 * the CLI. Nothing is cached *past* the answer: the promise is forgotten when it settles,
	 * so a refresh press is always a fresh read.
	 */
	private planRead?: Promise<SDKControlGetUsageResponse | undefined>;

	private planUsage(): Promise<SDKControlGetUsageResponse | undefined> {
		if (this.planRead) return this.planRead;
		const session = this.session();
		const read = (session as Partial<Query>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return Promise.resolve(undefined);
		const pending = read.call(session).catch(() => undefined);
		this.planRead = pending;
		void pending.finally(() => {
			if (this.planRead === pending) this.planRead = undefined;
		});
		return pending;
	}
}

/**
 * What the session has cost, out of the payload behind the CLI's own `/usage`.
 *
 * Reported as zero for a while, on the grounds that the call is experimental — which left
 * the meter saying "3% ctx" beside a pi agent saying "3% ctx · $0.0018", and a cost of zero
 * is not more honest than no figure, it is a wrong one.
 *
 * `undefined` rather than zero when the payload has no figure, so the caller keeps the one
 * it had: the whole payload is held at arm's length, because the SDK's own name for the call
 * is an instruction — `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`.
 */
function sessionCost(usage: SDKControlGetUsageResponse | undefined): number | undefined {
	const cost = usage?.session?.total_cost_usd;
	return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

/** The window a limit is about, in words rather than the wire's name for it. */
function limitWindow(type: string | undefined): string {
	switch (type) {
		case "five_hour":
			return "5-hour";
		case "seven_day":
			return "weekly";
		case "seven_day_opus":
			return "weekly Opus";
		case "seven_day_sonnet":
			return "weekly Sonnet";
		case "overage":
		case "seven_day_overage_included":
			return "overage";
		default:
			return "usage";
	}
}

/**
 * When a limit lifts, said the way a person would say it.
 *
 * A bare timestamp is not information at a glance, and the reset is usually today — so a
 * time is enough, and a date is only added when it is not today. Empty when there is no
 * reset to report, because "resets undefined" is worse than saying nothing.
 */
function resetWords(at: number | undefined): string {
	if (!at || !Number.isFinite(at)) return "";
	const when = new Date(at);
	if (Number.isNaN(when.getTime())) return "";
	const today = new Date().toDateString() === when.toDateString();
	const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return today ? ` (resets ${time})` : ` (resets ${when.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time})`;
}

/**
 * One usage read from a process of its own, on the account `env` names, and then gone.
 *
 * For a session whose agent has changed account since it started (`ClaudeUsageReader.report`). A
 * query with no message never sends a turn, so this spends nothing: it is the process starting,
 * the usage request, and the process closing, about two and a half seconds. `undefined` when
 * it cannot answer, so the caller can fall back on what it had.
 */
export async function probeUsage(env: NodeJS.ProcessEnv | undefined): Promise<SDKControlGetUsageResponse | undefined> {
	if (!env) return undefined;
	const executable = claudeExecutable();
	// Never yields: the probe is a usage read, not a conversation.
	async function* nothing(): AsyncGenerator<SDKUserMessage> {
		await new Promise<never>(() => {});
	}
	const probe = query({ prompt: nothing(), options: { env, cwd: tmpdir(), ...(executable ? { pathToClaudeCodeExecutable: executable } : {}) } });
	void (async () => {
		try {
			for await (const _ of probe) {
				/* drained so the process is not left waiting on a reader */
			}
		} catch {
			/* closed below, which ends the loop with an error worth nothing */
		}
	})();
	try {
		const read = (probe as Partial<Query>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return undefined;
		return await Promise.race([read.call(probe), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 15_000).unref?.())]);
	} catch {
		return undefined;
	} finally {
		probe.close?.();
	}
}

/** The 5-hour window out of a usage read, as an account row shows it. */
export function fiveHourOf(read: SDKControlGetUsageResponse | undefined): { percent: number; resetsAt?: number } | undefined {
	const window = (read as { rate_limits?: { five_hour?: { utilization?: unknown; resets_at?: unknown } | null } } | undefined)?.rate_limits?.five_hour;
	if (!window || typeof window.utilization !== "number" || !Number.isFinite(window.utilization)) return undefined;
	const resetsAt = typeof window.resets_at === "string" ? Date.parse(window.resets_at) : typeof window.resets_at === "number" ? epochMs(window.resets_at) : undefined;
	return { percent: Math.max(0, Math.min(100, Math.round(window.utilization))), ...(resetsAt && Number.isFinite(resetsAt) ? { resetsAt } : {}) };
}
