import { Refused, events, type AnyEvent, type Caller, type Payload } from "../../protocol/index.ts";
import { LOCAL_PERSON } from "../kernel/index.ts";
import type { Context, Done, Kernel, Store, Tokens } from "../kernel/types.ts";
import { actOf, type Act } from "./acts.ts";
import { Answers } from "./answers.ts";
import { Presence } from "./presence.ts";
import { Hosts } from "./hosts.ts";
import { Mailboxes } from "./mail.ts";
import { Marks } from "./news.ts";
import { Roster, asAgent, type AgentRecord } from "./records.ts";
import { Screens } from "./screens.ts";

// Everything the feature keeps, made once when the server starts, and who a call
// is about. Records, mail and marks are stored; hosts and screens live with their connections.

export class People {
	readonly hosts = new Hosts();
	readonly screens = new Screens();
	readonly answers = new Answers();
	readonly presence = new Presence();
	private events: Kernel["events"] | undefined;
	readonly roster: Roster;
	readonly mail: Mailboxes;
	readonly marks: Marks;
	private seen = new Set<string>();
	private canvases: string[] = [];
	private revs = 0;

	constructor(store: Store, readonly tokens: Tokens, clock: () => number = Date.now) {
		this.roster = new Roster(store, clock);
		this.mail = new Mailboxes(store, clock);
		this.marks = new Marks(store);
	}

	static async start(kernel: Kernel): Promise<People> {
		const people = new People(kernel.store("people"), kernel.callers);
		people.events = kernel.events;
		await Promise.all([people.roster.load(), people.mail.load(), people.marks.load()]);
		kernel.callers.describe("agent", (id) => people.roster.callerOf(id));
		kernel.relay((call) => people.hosts.answerer(call));
		kernel.callers.describe("person", (_id, issued) => people.withHere(issued));
		kernel.after((done) => people.acted(done));
		const learn = () => void people.learnCanvases(kernel);
		kernel.events.on(events.canvasChanged, learn);
		learn();
		return people;
	}

	/** The deck's canvases, first first, kept for a person with no screen yet. */
	async learnCanvases(kernel: Kernel): Promise<void> {
		const listed = await kernel.call("canvas.list", {}, LOCAL_PERSON).catch(() => undefined);
		if (listed?.ok && Array.isArray(listed.value)) this.canvases = (listed.value as { name: string }[]).map((c) => c.name);
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
				this.answers.drop(client.id);
				this.left(client.id, ctx.caller);
			});
		}
		return client.id;
	}

	/** A line that spoke on a canvas has gone: the others there hear it leave, by the same kind and id
	 * they knew it by, so a listener drops the right cursor. */
	private left(client: string, who: Caller): void {
		const canvas = this.presence.leave(client);
		if (!canvas || !this.events) return;
		const others = this.screens.drawing(canvas).map((s) => s.client).filter((c) => c !== client);
		if (others.length) this.events.emit(events.viewChanged, { canvas, ids: [], by: who.id, rev: ++this.revs, gone: true, kind: who.kind === "agent" ? "agent" : "person" }, { clients: others });
	}

	/** An agent's change that worked is told as agent.acted, for its glow and cursor on what it touched. */
	acted({ call, args, caller, envelope }: Done): void {
		const done = { name: call.name, effect: call.effect, args, who: caller.kind, ok: envelope.ok, ...(envelope.ok ? { value: envelope.value } : {}) };
		const act = actOf(done, caller.canvas);
		const record = act ? this.roster.byIdOrUndefined(caller.id) : undefined;
		if (act && record) this.tellAct(record, act, "done");
	}

	/** One act, in the agent's name and colour. */
	tellAct(record: AgentRecord, act: Act, phase: "start" | "done"): void {
		const payload = { ...(act.canvas ? { canvas: act.canvas } : {}), ids: act.ids, by: record.id, rev: ++this.revs, phase, what: act.what, label: record.name, color: record.color };
		this.events?.emit(events.agentActed, payload);
	}

	/** A person's here: the home of the agent on their screen, else that screen's canvas, else the first. */
	withHere(person: Caller): Caller {
		const screen = this.screens.newestOf(person.id);
		const canvas = (screen?.follows ? this.roster.byIdOrUndefined(screen.follows)?.canvas : undefined) ?? screen?.canvas ?? this.canvases[0];
		return canvas && !person.canvas ? { ...person, canvas } : person;
	}

	/** The agent a call is about: the agent calling; for the person, the one their screen follows, else the
	 * newest; for a card, the agent whose home is the card's canvas. */
	actor(ctx: Context): AgentRecord {
		if (ctx.caller.kind === "card") return this.homedOn(ctx.caller.canvas);
		if (ctx.caller.kind !== "person") return this.self(ctx);
		const follows = this.screens.newestOf(ctx.caller.id)?.follows;
		const record = (follows ? this.roster.byIdOrUndefined(follows) : undefined) ?? this.roster.all().at(-1);
		if (!record) throw new Refused("not_found", "There is no agent yet to answer for.", "agent.list");
		return record;
	}

	/** The newest agent whose home is this canvas. */
	private homedOn(canvas: string | undefined): AgentRecord {
		const record = this.roster.all().filter((a) => canvas && a.canvas === canvas).at(-1);
		if (!record) throw new Refused("not_found", `No agent has the canvas ${canvas ?? "(none)"} as its home.`, "agent.list");
		return record;
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
