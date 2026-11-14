import type { MessagePart } from "../runtimes/types/index.ts";

// An agent's two queues: the person's own, and mail handed over by others.
// The rules are README rules 5 to 7; the session says when a turn ends.

export type Mine = { id: string; text: string; parts?: MessagePart[] };
export type Mail = { id: string; from: string; task: string; cards: string[]; reply?: boolean };

export const QUEUE_LIMIT = 8;

export function quietMs(): number {
	const configured = Number(process.env.DECKS_QUEUE_IDLE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

export interface QueueHooks {
	idle(): boolean;
	/** Send a message as a new turn. */
	prompt(text: string, parts?: MessagePart[]): void;
	/** Run handed-over work, and come back when its turn ends. */
	run(mail: Mail): Promise<void>;
	changed(): void;
}

export class Queues {
	private mine: Mine[] = [];
	private held = false;
	private work: Mail[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private counter = 0;

	constructor(private readonly hooks: QueueHooks) {}

	view(): { items: Array<{ id: string; text: string }>; held: boolean } {
		return { items: this.mine.map((one) => ({ id: one.id, text: one.text })), held: this.held };
	}

	/** How many items wait, both queues together. */
	get length(): number {
		return this.mine.length + this.work.length;
	}

	add(text: string, parts?: MessagePart[]): void {
		const said = text.trim();
		if (!said) return;
		if (this.hooks.idle() && this.mine.length === 0) return this.hooks.prompt(said, parts);
		this.mine.push({ id: `q${(++this.counter).toString(36)}${Date.now().toString(36)}`, text: said, ...(parts?.length ? { parts } : {}) });
		this.hooks.changed();
	}

	remove(id: string): void {
		const before = this.mine.length;
		this.mine = this.mine.filter((one) => one.id !== id);
		if (this.mine.length === 0) this.held = false;
		if (this.mine.length !== before) this.hooks.changed();
	}

	sendNow(id: string): void {
		const found = this.mine.find((one) => one.id === id);
		if (!found) return;
		this.remove(id);
		this.hooks.prompt(found.text, found.parts);
	}

	release(): void {
		this.held = false;
		this.hooks.changed();
		if (this.hooks.idle()) this.turnEnded();
	}

	/** A stopped turn holds the person's queue and starts the mail's wait again. */
	hold(): void {
		this.cancel();
		if (this.mine.length > 0 && !this.held) {
			this.held = true;
			this.hooks.changed();
		}
	}

	mail(item: Mail): number {
		if (this.work.length >= QUEUE_LIMIT) throw Object.assign(new Error(`${QUEUE_LIMIT} items already wait; nothing was queued.`), { code: "conflict" });
		this.work.push(item);
		this.hooks.changed();
		this.arm();
		return this.work.length;
	}

	/** The agent is idle again: the person's next message, else the mail's wait. */
	turnEnded(): void {
		if (!this.held && this.mine.length > 0) {
			const next = this.mine.shift()!;
			this.hooks.changed();
			this.hooks.prompt(next.text, next.parts);
			return;
		}
		this.arm();
	}

	dispose(): void {
		this.cancel();
	}

	private arm(): void {
		if (this.mine.length > 0 && !this.held) return;
		if (this.timer || this.work.length === 0 || !this.hooks.idle()) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.drain();
		}, quietMs());
		this.timer.unref?.();
	}

	private cancel(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private async drain(): Promise<void> {
		if (!this.hooks.idle()) return;
		const item = this.work.shift();
		if (!item) return;
		this.hooks.changed();
		await this.hooks.run(item);
		this.arm();
	}
}
