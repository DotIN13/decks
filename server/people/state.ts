import { Refused, type AnyEvent, type Payload } from "../../protocol/index.ts";
import type { Context, Kernel, Store, Tokens } from "../kernel/types.ts";
import { Hosts } from "./hosts.ts";
import { Mailboxes } from "./mail.ts";
import { Marks } from "./news.ts";
import { Roster, asAgent, type AgentRecord } from "./records.ts";
import { Screens } from "./screens.ts";

// Everything the feature keeps, made once when the server starts. Records,
// mail and marks are stored; hosts and screens live with their connections.

export class People {
	readonly hosts = new Hosts();
	readonly screens = new Screens();
	readonly roster: Roster;
	readonly mail: Mailboxes;
	readonly marks: Marks;
	private seen = new Set<string>();
	private revs = 0;

	constructor(store: Store, readonly tokens: Tokens, clock: () => number = Date.now) {
		this.roster = new Roster(store, clock);
		this.mail = new Mailboxes(store, clock);
		this.marks = new Marks(store);
	}

	static async start(kernel: Kernel): Promise<People> {
		const people = new People(kernel.store("people"), kernel.callers);
		await Promise.all([people.roster.load(), people.mail.load(), people.marks.load()]);
		kernel.callers.describe("agent", (id) => people.roster.callerOf(id));
		return people;
	}

	/** Learn of the call's connection once, so its offer and screen end with it. */
	meet(ctx: Context): string | undefined {
		const client = ctx.client;
		if (!client) return undefined;
		if (!this.seen.has(client.id)) {
			this.seen.add(client.id);
			client.closed(() => {
				this.seen.delete(client.id);
				this.hosts.drop(client.id);
				this.screens.drop(client.id);
			});
		}
		return client.id;
	}

	/** The record of the agent calling; refused for anyone else. */
	self(ctx: Context): AgentRecord {
		if (ctx.caller.kind !== "agent") throw new Refused("refused", "Only an agent has a record of its own.", "agent.list");
		const record = this.roster.byIdOrUndefined(ctx.caller.id);
		if (!record) throw new Refused("not_found", "This agent has no record here any more.", "agent.attach");
		return record;
	}

	shown(record: AgentRecord) {
		return asAgent(record, this.mail.count(record.id));
	}

	/** Emit an event about agents, to everyone or to some clients only. */
	tell<E extends AnyEvent>(ctx: Context, event: E, more: Omit<Payload<E>, "by" | "rev">, clients?: string[]): void {
		const payload = { ...more, by: ctx.caller.id, rev: ++this.revs } as Payload<E>;
		ctx.events.emit(event, payload, clients ? { clients } : undefined);
	}
}

/** The feature's state, there once start has run. */
export class Holder {
	private people: People | undefined;
	set(people: People): void {
		this.people = people;
	}
	get(): People {
		if (!this.people) throw new Refused("unavailable", "The people feature has not started yet.", "deck.get");
		return this.people;
	}
}
