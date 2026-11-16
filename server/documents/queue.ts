// One piece of work at a time per key, in the order asked: a document typesetting, a repository pulls.
export class Queues {
	private tails = new Map<string, Promise<unknown>>();

	/** Run work after everything queued under key; a failure does not stop the next. */
	run<T>(key: string, work: () => Promise<T>): Promise<T> {
		const next = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
		const settled = next.then(() => undefined, () => undefined);
		this.tails.set(key, settled);
		void settled.then(() => this.tails.get(key) === settled && this.tails.delete(key));
		return next;
	}
}
