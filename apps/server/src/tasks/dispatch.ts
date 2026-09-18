import type { TaskRosterEntry, TaskSpec } from "@decks/protocol";

/**
 * The dispatcher's decision, as the rule makes it.
 *
 * An agent decision names the winner and a sentence saying why; a `none` decision
 * says why nobody should take it. The sentence is what travels: it lands on the task
 * as its `reason`, and the panel draws it next to a blocked row.
 */
export type DispatchDecision =
	| { outcome: "agent"; agentId: string; agentName: string; why: string }
	| { outcome: "none"; reason: string };

/**
 * The rule that decides which agent a task belongs to.
 *
 * This is the feature, so it has to be a pure function and it has to be tested like
 * one. The order is the rule:
 *
 * 1. **A person named an agent** (`agentId`). They have already made the decision
 *    the rule exists to make; the rule only checks that the agent still exists.
 * 2. **The workspace filter**, when the task names one. A workspace is the user's
 *    own grouping, the one thing a person can see, so it is the first cut. No
 *    candidate → "nobody should do this", honestly.
 * 3. **Board inference**, when the task names boards and no workspace. The agents
 *    holding those boards are where the work already is, so whoever holds the most
 *    of them is asked first: their workspace becomes the filter. Boards spanning
 *    several workspaces, or held by nobody, leave the field wide open.
 * 4. **Rank** the survivors: idle before busy (only an idle agent's queue drains),
 *    then fewest queued, then most of the task's boards held, then name, so the
 *    answer is stable between calls.
 *
 * Two runs of the rule cannot both win: the *service* owns assignment (the task is
 * marked `assigned` in the same tick as `registry.deliver`), and a cron tick that
 * overlaps the next starts from the same store. The rule itself only ever reads.
 */
export function dispatch(spec: TaskSpec, roster: readonly TaskRosterEntry[]): DispatchDecision {
	// A person said who. Their word wins; the roster only has to still contain them.
	if (spec.agentId) {
		const named = roster.find((entry) => entry.id === spec.agentId);
		if (named) return { outcome: "agent", agentId: named.id, agentName: named.name, why: `${named.name} was named for this task.` };
		return { outcome: "none", reason: "The agent named for this task is gone." };
	}

	// The workspace cut. An empty result is a sentence, not a shrug: the panel tells
	// the reader "nobody is in that workspace", and that is the honest answer asked for.
	const workspace = spec.workspace ?? inferWorkspace(spec.boards ?? [], roster);
	const inWorkspace = workspace ? roster.filter((entry) => entry.workspace === workspace) : [...roster];
	if (workspace && inWorkspace.length === 0) {
		return { outcome: "none", reason: `No agent is in ${workspace}.` };
	}
	if (inWorkspace.length === 0) {
		return { outcome: "none", reason: `There are no agents yet. Start one with the + button.` };
	}

	const held = heldCounts(spec.boards ?? [], inWorkspace);
	const pick = [...inWorkspace].sort((left, right) => {
		// Idle beats everything: a queue drains only while the agent is idle, so an
		// agent mid-turn is a task that waits however long the turn takes. Ordering
		// otherwise does not matter much — the queue waits regardless — but it matters
		// that the *busy* state never outranks idle.
		const li = left.state === "idle" ? 0 : 1;
		const ri = right.state === "idle" ? 0 : 1;
		if (li !== ri) return li - ri;
		if (left.queued !== right.queued) return left.queued - right.queued;
		const lb = held.get(left.id) ?? 0;
		const rb = held.get(right.id) ?? 0;
		if (lb !== rb) return rb - lb;
		return left.name.localeCompare(right.name);
	})[0]!;

	return {
		outcome: "agent",
		agentId: pick.id,
		agentName: pick.name,
		why: workspace
			? `${pick.name} is the best fit in ${workspace}${pick.state === "idle" ? "" : " (busy, so this task waits)"}.`
			: `${pick.name} is the best fit: ${pick.state === "idle" ? "idle" : "least busy"}, ${pick.queued} queued.`,
	};
}

/**
 * The workspace the task's boards live in, inferred from who holds them.
 *
 * The one "hybrid" smell allowed into a rule: the user's grouping is the primary
 * signal, and the boards are the secondary one. An agent holding two of a task's
 * three boards is where the work already is; when nobody holds any of them, there is
 * nothing to infer, and the rule drops to the whole roster rather than pretending.
 */
function inferWorkspace(boards: string[], roster: readonly TaskRosterEntry[]): string | undefined {
	const counts = heldCounts(boards, roster);
	const holders = new Set<string>();
	for (const entry of roster) if ((counts.get(entry.id) ?? 0) > 0) holders.add(entry.workspace ?? "");
	if (holders.size === 1 && !holders.has("")) return [...holders][0];
	return undefined;
}

/** Agent id → how many of `boards` the agent holds. */
function heldCounts(boards: string[], roster: readonly TaskRosterEntry[]): Map<string, number> {
	const counts = new Map<string, number>();
	const wanted = new Set(boards);
	for (const entry of roster) {
		const held = entry.context.filter((path) => wanted.has(path)).length;
		if (held > 0) counts.set(entry.id, held);
	}
	return counts;
}