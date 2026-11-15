import { randomUUID } from "node:crypto";
import { Refused } from "../../protocol/index.ts";

// Questions put to the screens of a canvas (view.requested with an id), each
// answered once by view.answer, or given up after a while or when the asked screen goes.

export const ANSWER_MS = 20_000;
type Waiting = { client: string; done: (got: { value?: unknown; error?: string }) => void };

export class Answers {
	private waiting = new Map<string, Waiting>();

	/** A new question's id, and the promise of its answer. */
	ask(client: string, what: string, ms = ANSWER_MS): { id: string; answer: Promise<unknown> } {
		const id = randomUUID();
		const answer = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				reject(new Refused("unavailable", `The screen did not answer ${what} in ${Math.round(ms / 1000)} s.`));
			}, ms);
			timer.unref?.();
			this.waiting.set(id, {
				client,
				done: (got) => {
					clearTimeout(timer);
					this.waiting.delete(id);
					if (got.error !== undefined) reject(new Refused("unavailable", `The screen could not answer ${what}: ${got.error}`));
					else resolve(got.value);
				},
			});
		});
		return { id, answer };
	}

	/** The first answer to an id counts, from any of the person's connections (the canvas frame's line
	 * answers for its page); false when nothing waits for it. */
	answer(id: string, got: { value?: unknown; error?: string }): boolean {
		const waiting = this.waiting.get(id);
		if (!waiting) return false;
		waiting.done(got);
		return true;
	}

	/** A screen gone answers nothing it was asked. */
	drop(client: string): void {
		for (const one of [...this.waiting.values()]) if (one.client === client) one.done({ error: "it closed" });
	}
}
