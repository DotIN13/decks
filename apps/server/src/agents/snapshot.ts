import type { StageSnapshot } from "../stage/tool.ts";

/**
 * What each agent was holding, showing and calling itself, over time (DESIGN §6.2).
 *
 * Pi used to carry this in the transcript: every `stage_eval` recorded its outcome in the
 * tool result's `details`, and `session_start` rebuilt from the newest one on the branch.
 * That is genuinely elegant — rewinding the conversation rewound the canvas, because the
 * transcript was the record of both — and it has no Claude counterpart. MCP tool results
 * carry no `details`, and the SDK's `structuredContent`, which looks like the equivalent,
 * *replaces* the text the model reads. So both runtimes use this instead, and there is one
 * mechanism to be wrong in rather than two.
 *
 * **In memory, not on disk.** Nothing recreates agents when the server restarts — a fresh
 * process has a fresh chat list — so a snapshot has nothing to survive *to*. What it does
 * have to survive is a rewind inside a session and a fork seeding its child, both of which
 * happen while the process is up. A file would be honest-looking machinery for a
 * capability that does not exist.
 *
 * Kept as a series rather than one value per agent, because a rewind asks a question about
 * the past: *what was on the canvas at that point?* Resolved by time, the same way
 * `App.boardsAt` resolves which revision of a board to show — one idea, used twice.
 */

interface Recorded {
	at: number;
	snapshot: StageSnapshot;
}

/** Enough to cover any conversation worth rewinding, and bounded so it cannot grow forever. */
const KEEP = 200;

export class SnapshotStore {
	private readonly series = new Map<string, Recorded[]>();

	/** Note what the stage looked like after a run. */
	record(agentId: string, snapshot: StageSnapshot, at = Date.now()): void {
		const kept = this.series.get(agentId) ?? [];
		kept.push({ at, snapshot });
		if (kept.length > KEEP) kept.splice(0, kept.length - KEEP);
		this.series.set(agentId, kept);
	}

	/** The most recent one, for an agent that has just started. */
	latest(agentId: string): StageSnapshot | undefined {
		return this.series.get(agentId)?.at(-1)?.snapshot;
	}

	/**
	 * What the stage looked like at a moment — the newest snapshot taken at or before it.
	 *
	 * Scanned rather than indexed, and not assuming the series is sorted: `record` is
	 * called from a tool run and a clock is not a guarantee of order.
	 */
	at(agentId: string, when: number): StageSnapshot | undefined {
		let best: Recorded | undefined;
		for (const entry of this.series.get(agentId) ?? []) {
			if (entry.at > when) continue;
			if (!best || entry.at > best.at) best = entry;
		}
		return best?.snapshot;
	}

	/**
	 * Give a forked agent its parent's history up to the fork point.
	 *
	 * A fork opens a conversation that already happened, so it should open with the canvas
	 * that conversation had — not with an empty context that makes the boards look lost.
	 */
	seed(fromAgentId: string, toAgentId: string, upTo: number): void {
		const source = (this.series.get(fromAgentId) ?? []).filter((entry) => entry.at <= upTo);
		if (source.length === 0) return;
		this.series.set(toAgentId, source.map((entry) => ({ ...entry })));
	}

	/** An agent that is gone keeps nothing. */
	forget(agentId: string): void {
		this.series.delete(agentId);
	}
}
