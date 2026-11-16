import type { MessagePart } from "@decks/protocol";
import { PERSON, type QueuedWork } from "./work.ts";
import type { AgentRecord } from "./store.ts";
import type { Turns } from "./turns.ts";

/**
 * What waits for an agent when it asks: its mail, and the news of its canvases.
 *
 * For an agent Decks runs this is a look: its queue drains by itself, a turn at a time (`turns.ts`).
 * For an agent that works **outside Decks** (Claude Code in a terminal, claude.ai, joined through
 * MCP by `Registry.attach`) it is how anything reaches it at all. Decks runs no turn for it, so what
 * is sent to it waits here until its next call takes it, and that it called is how Decks knows it is
 * here. Its key, its app, when it last called and its waiting mail are kept on its record and
 * nowhere else, so they are written the moment they change.
 */

/** What the inbox needs of the agent it is the inbox of. */
export interface InboxHost {
	turns: Turns;
	name(): string;
	/** What others changed on its canvases since it last asked (`Seat.canvasNotes`). */
	canvasNotes(): string[];
	/** The person's words, shown in the conversation as theirs. */
	said(text: string, parts?: MessagePart[]): void;
	notice(level: "info" | "warn" | "error", text: string): void;
	/** Say the agent's row again: it carries when an outside agent last called and how much waits. */
	sayRow(): void;
	/** Something the record keeps changed: write it shortly. */
	save(): void;
	/** Write the record now, whatever was waiting to be written. */
	writeNow(): void;
}

export class Inbox {
	/** Set for an agent that joined from its own app: the key it joins by, the app, and when it last called. */
	private outside: { key: string; client: string; seen: number } | undefined;

	constructor(
		private readonly of: InboxHost,
		joined?: { key: string; client: string; seen?: number | undefined },
	) {
		if (joined) this.outside = { key: joined.key, client: joined.client, seen: joined.seen ?? Date.now() };
	}

	/** The key an outside agent joins by, or undefined for an agent Decks runs. */
	get outsideKey(): string | undefined {
		return this.outside?.key;
	}

	/** The app an outside agent runs in, or undefined for an agent Decks runs. */
	get client(): string | undefined {
		return this.outside?.client;
	}

	/** An outside agent called: it is here now. The row is said again at most every ten seconds. */
	touch(client?: string): void {
		if (!this.outside) return;
		const before = this.outside.seen;
		this.outside.seen = Date.now();
		if (client) this.outside.client = client;
		if (this.outside.seen - before > 10_000) {
			this.of.sayRow();
			this.of.save();
		}
	}

	/**
	 * What waits for this agent, taken: the messages in its inbox and what others changed on its
	 * canvases since it last asked. For an outside agent this is how mail arrives, so the messages
	 * leave the inbox; an agent Decks runs is only shown its queue, which still drains by itself.
	 */
	takeNews(): { messages: QueuedWork[]; changes: string[] } {
		const messages = this.outside ? this.of.turns.takeAll() : this.of.turns.queue();
		if (this.outside && messages.length > 0) this.changed();
		return { messages, changes: this.of.canvasNotes() };
	}

	/**
	 * The person wrote to an outside agent. It has no runtime to prompt: the words are shown here,
	 * wait in its inbox, and reach it with its next call.
	 */
	leave(text: string, parts?: MessagePart[]): void {
		if (!this.outside) return;
		this.of.said(text, parts);
		this.of.turns.leave({ from: PERSON, fromName: "The person", task: text, boards: [], at: Date.now(), person: true });
		this.of.notice("info", `${this.of.name()} works in ${this.outside.client}, outside Decks: it reads this with its next call.`);
		this.changed();
	}

	/** What an outside agent did, as a line in its conversation here: Decks has no transcript of its own to show. */
	noteAct(line: string): void {
		if (this.outside) this.of.notice("info", line);
	}

	/** The mail changed: the row counts what waits, and the record, which is all there is of an outside agent, is written now. */
	changed(): void {
		this.of.sayRow();
		this.keep();
	}

	/**
	 * Write an outside agent's record now, not a second from now: its key and its waiting mail are
	 * kept nowhere else, and the stop that matters gives no warning.
	 */
	keep(): void {
		if (this.outside) this.of.writeNow();
	}

	/** What the row says of an outside agent: its app, when it last called, how much waits. */
	row(): { client: string; seen: number; waiting: number } | undefined {
		return this.outside ? { client: this.outside.client, seen: this.outside.seen, waiting: this.of.turns.queued } : undefined;
	}

	/** What the record keeps of an outside agent: who it is to Decks, and its waiting mail. */
	record(): AgentRecord["outside"] {
		return this.outside ? { ...this.outside, inbox: this.of.turns.queue().map((item) => ({ ...item })) } : undefined;
	}
}
