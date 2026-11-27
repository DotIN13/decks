import { randomUUID } from "node:crypto";
import type { ServerMessage, CanvasCall } from "@decks/protocol";

/**
 * What an agent asks the pages to do to a canvas (`decks view …`, a picture of a card as a browser
 * has it), and the wait for their answers.
 *
 * The harness cannot move a camera or read a screen: a page does, and says what happened. So a call
 * goes out to every page as `view.called` under an id, and whoever answers settles it: a page or
 * a canvas frame on the line, a frame over HTTP. A page that never answers
 * times out into a result rather than leaving the agent's call hanging on a tab that was closed.
 */

interface Waiting {
	resolve: (value: unknown) => void;
	timer: NodeJS.Timeout;
	many?: { answers: unknown[]; expected: number };
}

/** What the page calls need of the harness: how to tell every page, and how many could answer. */
export interface PageCallsHost {
	send(message: ServerMessage): void;
	/** The pages and frames connected now, on the line. */
	screens(): number;
}

export class PageCalls {
	private readonly pending = new Map<string, Waiting>();

	constructor(private readonly of: PageCallsHost) {}

	/**
	 * Ask the browser to do something to the canvas, and wait for it.
	 *
	 * Broadcast rather than addressed: two tabs on one deck are looking at the same
	 * canvas, and both should move. The first answer wins, and a browser that never
	 * answers times out into a result rather than leaving the agent's tool call
	 * hanging on a tab that was closed mid-gesture.
	 */
	ask(call: Omit<CanvasCall, "id">, timeoutMs = 5000): Promise<unknown> {
		const id = randomUUID();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ skipped: "the canvas did not answer in time" });
			}, timeoutMs);
			this.pending.set(id, { resolve, timer });
			this.of.send({ type: "view.called", call: { ...call, id } });
		});
	}

	/**
	 * Ask every browser, and wait for each to answer or for the time to run out: for a call whose
	 * answer is a count over all of them (`view.reload`). The answers that came are what it resolves with.
	 */
	askAll(call: Omit<CanvasCall, "id">, timeoutMs = 1500): Promise<unknown[]> {
		const id = randomUUID();
		// Every front end may answer: pages and canvas frames on the line. A line that
		// answers nothing (a script's, or a page leaving the call to its frame) only makes the wait run to its end.
		const expected = this.of.screens();
		if (expected === 0) return Promise.resolve([]);
		return new Promise((resolve) => {
			const many = { answers: [] as unknown[], expected };
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve(many.answers);
			}, timeoutMs);
			this.pending.set(id, { resolve: (value) => resolve(value as unknown[]), timer, many });
			this.of.send({ type: "view.called", call: { ...call, id } });
		});
	}

	/** A page's answer to a call: settles the call waiting on it, or adds to the answers when every page was asked. Says whether anything was waiting. */
	settle(result: { id: string; value?: unknown; error?: string }): boolean {
		const waiting = this.pending.get(result.id);
		if (!waiting) return false;
		const value = result.error ? { error: result.error } : (result.value ?? null);
		if (waiting.many) {
			waiting.many.answers.push(value);
			if (waiting.many.answers.length < waiting.many.expected) return true;
			this.pending.delete(result.id);
			clearTimeout(waiting.timer);
			waiting.resolve(waiting.many.answers);
			return true;
		}
		this.pending.delete(result.id);
		clearTimeout(waiting.timer);
		waiting.resolve(value);
		return true;
	}
}
