import type { AgentState } from "@decks/protocol";

/**
 * Waiting for an agent's work to be done (`agent.wait`).
 *
 * Work reaching the agent marks it asked; its turn ending marks it idle and wakes whoever waits. A
 * wait is over once the agent is idle, nothing is queued for it, its last turn ended after it was last
 * asked, and it stays that way a moment (a queued task starts right after a turn ends). Tests and
 * agents used to poll the agent's state in sleep loops, which missed short turns and read a state that
 * had not caught up; the turn's own end wakes the wait instead.
 */
export class TurnWaits {
	private askedAt = 0;
	private idleAt = 0;
	private waiters: Array<() => void> = [];

	/** Work has just reached the agent: a wait from now on waits for it, even before its turn starts. */
	asked(): void {
		this.askedAt = Date.now();
	}

	/** The agent's turn ended. */
	wentIdle(): void {
		this.idleAt = Date.now();
		for (const wake of this.waiters.splice(0)) wake();
	}

	/** Wait for the work to be done, or `timeoutMs`; `now` reads the agent as it is. */
	async wait(now: () => { state: AgentState; queued: number; reply: string }, timeoutMs: number): Promise<{ state: AgentState; reply: string; waited: number; timedOut: boolean }> {
		const started = Date.now();
		const settled = () => {
			const agent = now();
			return agent.state === "idle" && agent.queued === 0 && this.idleAt >= this.askedAt;
		};
		const answer = (timedOut: boolean) => {
			const { state, reply } = now();
			return { state, reply, waited: Math.round((Date.now() - started) / 1000), timedOut };
		};
		while (Date.now() - started < timeoutMs) {
			if (settled()) {
				await new Promise((done) => setTimeout(done, 750));
				if (settled()) return answer(false);
				continue;
			}
			await new Promise<void>((done) => {
				const timer = setTimeout(done, Math.max(0, timeoutMs - (Date.now() - started)));
				this.waiters.push(() => {
					clearTimeout(timer);
					done();
				});
			});
		}
		return answer(true);
	}
}
