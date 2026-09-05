/**
 * Numbers in the usage panel, said the way a person would say them.
 *
 * Apart from the panel because every one of them has an edge that is easy to get wrong and
 * easy to test: a window that resets in the past, a quarter of a cent, a session that has
 * run for four hours, a model id with a bracket in it.
 *
 * Ported from picone's `lib/usage-format.ts` and kept close to it — the arguments in these
 * comments were worked out there against the same figures.
 */

/** Token counts read at a glance rather than counted digit by digit. */
export function tokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1000) return `${Math.round(count)}`;
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 2 : 1)}M`;
}

/** Every digit, for the one figure that is a count and not a magnitude. */
export function exact(count: number): string {
	return Math.round(count).toLocaleString("en-US");
}

/**
 * Dollars, at the precision the amount deserves.
 *
 * Two decimals hides the difference between a free session and a third of a cent, and four
 * decimals on eleven dollars is noise. Nothing rounds a real amount down to `$0.00`: a
 * session that cost something should not read as one that cost nothing.
 */
export function money(usd: number): string {
	if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	if (usd >= 0.01) return `$${usd.toFixed(3)}`;
	return `$${Math.max(usd, 0.0001).toFixed(4)}`;
}

/**
 * How long something took, in the two largest units it has.
 *
 * Two and not three: "1h 4m 22s" is a stopwatch reading, and what is being answered here is
 * roughly how long, not exactly.
 */
export function duration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

/**
 * How long until a window resets, from a fixed `now` so it can be tested.
 *
 * Null when there is no reset to report — some windows genuinely have none, and an em dash
 * is a better answer there than a made-up one. A reset already in the past reads as "now"
 * rather than as a negative: the panel is a snapshot, and a window that turned over while it
 * was open has not gone wrong.
 */
export function resetsIn(iso: string | null, now: number): string | null {
	if (!iso) return null;
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return null;

	const minutes = Math.round((at - now) / 60_000);
	if (minutes <= 0) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	return `${Math.round(hours / 24)}d`;
}

/**
 * The wall-clock time a window resets, in whatever zone this browser is in.
 *
 * The server sends UTC; nobody plans their afternoon in UTC. Days are included only when
 * the reset is not today, since most are within the next few hours and the date is then just
 * something else to read past.
 */
export function resetsAt(iso: string | null, now: number): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;

	const sameDay = at.toDateString() === new Date(now).toDateString();
	return at.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", ...(sameDay ? {} : { month: "short", day: "numeric" }) });
}

/** What the runtime's behaviour keys mean in words. */
const BEHAVIOR_LABEL: Record<string, string> = {
	cache_miss: "Cache misses",
	long_context: "Long context",
	subagent_heavy: "Subagent-heavy",
	high_parallel: "Highly parallel",
	cron: "Scheduled runs",
};

export function behaviorLabel(key: string): string {
	return BEHAVIOR_LABEL[key] ?? key.replace(/_/g, " ");
}

/**
 * A plan's name, capitalised.
 *
 * Not a lookup table: the CLI documents four values and clearly ships more, and an unknown
 * one should appear as itself rather than disappear.
 */
export function planLabel(subscription: string | null): string | null {
	if (!subscription) return null;
	return `${subscription.charAt(0).toUpperCase()}${subscription.slice(1)} plan`;
}

/**
 * A model id, short enough for a table.
 *
 * The provider prefix and the date suffix are the same on every row, so they carry nothing:
 * `claude-sonnet-4-5-20250929` is `sonnet-4-5` next to `opus-4-1`. A bracketed variant
 * stays — `opus-5[1m]` is a different context window and a different price, which is the
 * whole subject of the table.
 */
export function modelLabel(model: string): string {
	return model.replace(/^claude-/, "").replace(/-\d{8}(?=$|\[)/, "");
}
