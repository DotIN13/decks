import { Refused, calls, events, type Handled, type Args, type shapes } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/types.ts";
import { deliver, takeNews } from "./agent-mail.ts";
import type { AgentChange, AgentRecord } from "./records.ts";
import type { Holder, People } from "./state.ts";

// The agent calls: records, attach, hosts, mail and news. One short handler each.

const NO_HOST = "No harness is running to start an agent: start the Decks harness on this machine, then try again.";

export function agentCalls(holder: Holder): Handled<Context>[] {
	const p = () => holder.get();
	return handleAll(calls.agent, {
		me: (ctx) => p().shown(p().self(ctx)),
		list: (_ctx, { workspace }) => p().roster.all().filter((a) => workspace === undefined || (a.workspace ?? "") === workspace).map((a) => p().shown(a)),
		get: (_ctx, { agent }) => p().shown(p().roster.find(agent)),
		create: (ctx, spec) => create(p(), ctx, spec),
		update: (ctx, { agent, change }) => update(p(), ctx, agent, change),
		remove: (ctx, { agent }) => remove(p(), ctx, agent),
		attach: (ctx, args) => attach(p(), ctx, args),
		host: (ctx, { kinds }) => host(p(), ctx, kinds),
		send: (ctx, { agent, task, cards }) => deliver(p(), ctx, agent, { task, ...(cards ? { cards } : {}) }, "send"),
		queue: (ctx, { agent, task, cards, reply }) => deliver(p(), ctx, agent, { task, ...(cards ? { cards } : {}), ...(reply ? { reply } : {}) }, "queue"),
		inbox: (ctx) => p().mail.inbox(p().self(ctx).id),
		news: (ctx, { canvas }) => takeNews(p(), ctx, canvas),
	});
}

type CreateArgs = Args<typeof calls.agent.create>;

/** A host that offers the kind is asked to start the agent; with none, refused. */
async function create(people: People, ctx: Context, spec: CreateArgs): Promise<shapes.Agent> {
	const host = people.hosts.pick(spec.kind);
	if (!host) throw new Refused("unavailable", spec.kind ? `${NO_HOST} None offers ${spec.kind} agents.` : NO_HOST, "agent.host");
	const near = spec.near ? people.roster.find(spec.near).workspace : undefined;
	const workspace = spec.workspace ?? near;
	const record = await people.roster.create({
		...pick(spec, ["name", "model", "thinking", "mode", "tags", "canvas"]),
		...(workspace ? { workspace } : {}),
		kind: host.kind,
		host: host.client,
		state: "starting",
	});
	const token = people.tokens.issue(people.roster.callerOf(record.id)!, "agent.create");
	people.tell(ctx, events.agentRequested, { ids: [record.id], spec: { ...spec, id: record.id, name: record.name, kind: host.kind, token } }, [host.client]);
	people.tell(ctx, events.agentChanged, { ids: [record.id], state: "starting" });
	if (!spec.canvas) ctx.note("The host gives the agent a canvas of its own when it starts.");
	return people.shown(record);
}

async function update(people: People, ctx: Context, asked: string | undefined, change: AgentChange): Promise<shapes.Agent> {
	const target = asked === undefined ? people.self(ctx) : people.roster.find(asked);
	if (ctx.caller.kind === "agent" && target.id !== ctx.caller.id) throw new Refused("refused", "An agent changes only itself; the person may change any agent.", "agent.update");
	if (change.canvas !== undefined) change = { ...change, canvas: canvasName(ctx, change.canvas) };
	const { record, changed } = await people.roster.update(target.id, change);
	if (changed) people.tell(ctx, events.agentChanged, { ids: [record.id] });
	if (change.canvas !== undefined) followHome(people, ctx, record);
	return people.shown(record);
}

async function remove(people: People, ctx: Context, asked: string): Promise<{ deleted: string }> {
	const record = await people.roster.delete(people.roster.find(asked).id);
	people.tokens.revoke(record.id);
	await Promise.all([people.mail.drop(record.id), people.marks.drop(record.id)]);
	people.tell(ctx, events.agentDeleted, { ids: [record.id] });
	return { deleted: record.id };
}

/** The person's call becomes a new agent with its own token, for a terminal client. */
async function attach(people: People, ctx: Context, args: { name?: string; kind?: AgentRecord["kind"]; workspace?: string; canvas?: string }): Promise<shapes.Agent> {
	const canvas = args.canvas !== undefined ? canvasName(ctx, args.canvas) : ctx.caller.canvas;
	const record = await people.roster.create({ ...pick(args, ["name", "kind", "workspace"]), ...(canvas ? { canvas } : {}), attached: true });
	const token = people.tokens.issue(people.roster.callerOf(record.id)!, "agent.attach");
	people.tell(ctx, events.agentChanged, { ids: [record.id] });
	return { ...people.shown(record), token };
}

/** A connected client offers kinds; agents of those kinds with no host are its own. */
async function host(people: People, ctx: Context, kinds: AgentRecord["kind"][]): Promise<NonNullable<AgentRecord["kind"]>[]> {
	const client = people.meet(ctx);
	if (!client) throw new Refused("invalid", "agent.host needs a connection that stays open: call it on the socket.", "agent.host");
	const offered = people.hosts.offer(client, kinds.filter((k): k is NonNullable<typeof k> => !!k));
	for (const record of people.roster.all()) {
		if (record.attached || !record.kind || !offered.includes(record.kind) || people.hosts.has(record.host)) continue;
		await people.roster.update(record.id, { host: client });
	}
	return offered;
}

/** A canvas named by a call, checked to be there; ctx.canvas refuses one that is not. */
export function canvasName(ctx: Context, asked: string): string {
	ctx.canvas(asked);
	return asked;
}

/** The screens following an agent go to its new home. */
export function followHome(people: People, ctx: Context, record: AgentRecord): void {
	const screens = people.screens.following(record.id).map((s) => s.client);
	if (screens.length && record.canvas) people.tell(ctx, events.viewRequested, { ids: [record.id], canvas: record.canvas, call: "view.goto", args: { canvas: record.canvas } }, screens);
}

function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Partial<Pick<T, K>> {
	return Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]])) as Partial<Pick<T, K>>;
}
