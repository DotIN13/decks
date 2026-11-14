import { randomBytes } from "node:crypto";
import type { shapes, Infer } from "../../protocol/index.ts";
import type { Store } from "../kernel/types.ts";

// Each agent's mailbox, kept under mail/<agent id>. The server delivers
// nothing into a turn: mail waits here until the agent reads its news.

export type Message = Infer<typeof shapes.Message>;
const KEY = "mail/";
const enc = new TextEncoder();
const dec = new TextDecoder();

export class Mailboxes {
	private boxes = new Map<string, Message[]>();
	constructor(private store: Store, private clock: () => number = Date.now) {}

	async load(): Promise<void> {
		for (const key of await this.store.keys(KEY)) {
			const bytes = await this.store.get(key);
			if (bytes) this.boxes.set(key.slice(KEY.length), JSON.parse(dec.decode(bytes)) as Message[]);
		}
	}

	/** A new message, not yet kept anywhere. */
	make(from: string, to: string, work: { task: string; cards?: string[]; reply?: boolean }): Message {
		const cards = [...new Set(work.cards ?? [])];
		return { id: `m_${randomBytes(6).toString("hex")}`, from, to, task: work.task, cards, at: this.clock(), ...(work.reply ? { reply: true } : {}) };
	}

	/** Put a message in its agent's box; answers it with its place in the queue, from 1. */
	async keep(message: Message): Promise<Message> {
		const box = [...this.inbox(message.to), { ...message, state: "queued" as const }];
		const kept = { ...message, state: "queued" as const, position: box.length };
		box[box.length - 1] = kept;
		await this.write(message.to, box);
		return kept;
	}

	inbox(agent: string): Message[] {
		return this.boxes.get(agent) ?? [];
	}

	count(agent: string): number {
		return this.inbox(agent).length;
	}

	/** Everything waiting, taken out of the box. */
	async take(agent: string): Promise<Message[]> {
		const box = this.inbox(agent);
		if (box.length) await this.write(agent, []);
		return box;
	}

	async drop(agent: string): Promise<void> {
		this.boxes.delete(agent);
		await this.store.delete(KEY + agent);
	}

	private async write(agent: string, box: Message[]): Promise<void> {
		if (box.length === 0) {
			this.boxes.delete(agent);
			await this.store.delete(KEY + agent);
			return;
		}
		this.boxes.set(agent, box);
		await this.store.put(KEY + agent, enc.encode(JSON.stringify(box)));
	}
}
