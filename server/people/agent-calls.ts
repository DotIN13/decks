import { CALL_BY_NAME, Refused, calls, events, type Handled, type Args, type shapes } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/types.ts";
import { deliver, takeNews } from "./agent-mail.ts";
import type { AgentChange, AgentRecord } from "./records.ts";
import type { Holder, People } from "./state.ts";

/** The calls this feature handles, named, so a call added to the noun for another feature stays unhandled. */
const AGENT_CALLS = (({ me, list, get, create, update, remove, attach, host, send, queue, inbox, news }: typeof calls.agent) => ({ me, list, get, create, update, remove, attach, host, send, queue, inbox, news }))(calls.agent);

// The agent calls: records, attach, hosts, mail and news. One short handler each.

const NO_HOST = "No harness is running to start an agent: start the Decks harness on this machine, then try again.";

export function agentCalls(holder: Holder): Handled<Context>[] {
	const p = () => holder.get();
	return handleAll(AGENT_CALLS, {
		me: (ctx) => p().shown(p().actor(ctx)),
		list: (_ctx, { workspace }) => p().roster.all().filter((a) => workspace === undefined || (a.workspace ?? "") === workspace).map((a) => p().shown(a)),
		get: (_ctx, { agent }) => p().shown(p().roster.find(agent)),
		create: (ctx, spec) => create(p(), ctx, spec),
		update: (ctx, { agent, change }) => update(p(), ctx, agent, change),
		remove: (ctx, { agent }) => remove(p(), ctx, agent),
		attach: (ctx, args) => attach(p(), ctx, args),
		host: (ctx, { kinds, calls: answers }) => host(p(), ctx, kinds, answers ?? []),
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
	const made = await people.roster.create({
		...pick(spec, ["name", "model", "thinking", "mode", "tags"]),
		...(workspace ? { workspace } : {}),
		kind: host.kind,
		host: host.client,
		state: "starting",
	});
	const joined = spec.canvas ?? (ctx.caller.kind === "person" ? latestCanvas(people, ctx, made) : undefined);
	const record = await giveHome(people, ctx, made, joined);
	const token = people.tokens.issue(people.roster.callerOf(record.id)!, "agent.create");
	people.tell(ctx, events.agentRequested, { ids: [record.id], spec: { ...spec, id: record.id, name: record.name, kind: host.kind, canvas: record.canvas, token } }, [host.client]);
	people.tell(ctx, events.agentChanged, { ids: [record.id], state: "starting" });
	return people.shown(record);
}

async function update(people: People, ctx: Context, asked: string | undefined, change: AgentChange): Promise<shapes.Agent> {
	const target = asked === undefined ? people.actor(ctx) : people.roster.find(asked);
	if (ctx.caller.kind === "agent" && target.id !== ctx.caller.id) throw new Refused("refused", "An agent changes only itself; the person may change any agent.", "agent.update");
	if (change.state !== undefined || change.queued !== undefined) hostOnly(people, ctx, target);
	if (change.canvas !== undefined) change = { ...change, canvas: canvasName(ctx, change.canvas) };
	const { record, changed } = await people.roster.update(target.id, change);
	if (changed) people.tell(ctx, events.agentChanged, { ids: [record.id], ...(record.state ? { state: record.state } : {}) });
	if (change.canvas !== undefined) followHome(people, ctx, record);
	return people.shown(record);
}

/** State and queue come only from the socket that hosts the agent. */
function hostOnly(people: People, ctx: Context, target: AgentRecord): void {
	const client = ctx.client?.id;
	if (ctx.caller.kind !== "person" || !client || client !== target.host || !people.hosts.has(client)) {
		throw new Refused("refused", `Only the harness hosting ${target.name} reports its state and queue.`, "agent.host");
	}
}

const WORKING = ["thinking", "tool"];

async function remove(people: People, ctx: Context, asked: string): Promise<{ deleted: string }> {
	const found = people.roster.find(asked);
	if (found.state && WORKING.includes(found.state) && people.hosts.has(found.host)) {
		throw new Refused("conflict", `${found.name} is working (${found.state}); stop it first, then delete it.`, "agent.get");
	}
	const record = await people.roster.delete(found.id);
	people.tokens.revoke(record.id);
	await Promise.all([people.mail.drop(record.id), people.marks.drop(record.id)]);
	people.tell(ctx, events.agentDeleted, { ids: [record.id] });
	return { deleted: record.id };
}

/** The person's call becomes a new agent with its own token, for a terminal client. */
async function attach(people: People, ctx: Context, args: { name?: string; kind?: AgentRecord["kind"]; workspace?: string; canvas?: string }): Promise<shapes.Agent> {
	const made = await people.roster.create({ ...pick(args, ["name", "kind", "workspace"]), attached: true });
	const record = await giveHome(people, ctx, made, args.canvas);
	const token = people.tokens.issue(people.roster.callerOf(record.id)!, "agent.attach");
	people.tell(ctx, events.agentChanged, { ids: [record.id] });
	return { ...people.shown(record), token };
}

/** The person's new agent joins the canvas of its workspace changed last; no workspace is a group too. */
function latestCanvas(people: People, ctx: Context, made: AgentRecord): string | undefined {
	let best: { name: string; at: number; order: number } | undefined;
	people.roster.all().forEach((one, order) => {
		if (one.id === made.id || !one.canvas || one.workspace !== made.workspace) return;
		const changes = safeSince(ctx, one.canvas);
		if (!changes) return;
		const at = changes.reduce((top, c) => Math.max(top, c.at ?? 0), 0);
		if (!best || at > best.at || (at === best.at && order > best.order)) best = { name: one.canvas, at, order };
	});
	return best?.name;
}

function safeSince(ctx: Context, canvas: string) {
	try {
		return ctx.canvas(canvas).since(0);
	} catch {
		return undefined;
	}
}

/** The canvas named, else a new one titled with the agent's name; a failure takes the record back. */
async function giveHome(people: People, ctx: Context, record: AgentRecord, asked: string | undefined): Promise<AgentRecord> {
	try {
		const canvas = asked !== undefined ? canvasName(ctx, asked) : (await ctx.call<{ name: string }>("canvas.create", { title: record.name })).name;
		return (await people.roster.update(record.id, { canvas })).record;
	} catch (error) {
		await people.roster.delete(record.id);
		throw error;
	}
}

/** A socket client offers kinds and harness calls; agents of its kinds with no host become its own,
 * each told to it as agent.requested with a fresh token and adopted: true. */
async function host(people: People, ctx: Context, kinds: AgentRecord["kind"][], answers: string[]): Promise<NonNullable<AgentRecord["kind"]>[]> {
	const client = people.meet(ctx);
	if (!client) throw new Refused("invalid", "agent.host needs a connection that stays open: call it on the socket.", "agent.host");
	const odd = answers.filter((name) => CALL_BY_NAME.get(name)?.side !== "harness");
	if (odd.length) throw new Refused("invalid", `A host answers only the calls the harness answers itself, such as chat.list; ${odd.join(", ")} is not one.`, "agent.host");
	const offered = people.hosts.offer(client, kinds.filter((k): k is NonNullable<typeof k> => !!k), answers);
	for (const record of people.roster.all()) {
		if (record.attached || !record.kind || !offered.includes(record.kind) || people.hosts.has(record.host)) continue;
		const { record: taken } = await people.roster.update(record.id, { host: client });
		const token = people.tokens.issue(people.roster.callerOf(taken.id)!, "agent.host");
		const spec = { ...pick(taken, ["id", "name", "kind", "canvas", "model", "thinking", "mode"]), token, adopted: true };
		people.tell(ctx, events.agentRequested, { ids: [taken.id], spec }, [client]);
	}
	return offered;
}

/** A canvas's name from a name or a title; refused when there is none. */
export function canvasName(ctx: Context, asked: string): string {
	return ctx.canvasName(asked);
}

/** The screens following an agent go to its new home. */
export function followHome(people: People, ctx: Context, record: AgentRecord): void {
	const screens = people.screens.following(record.id).map((s) => s.client);
	if (screens.length && record.canvas) people.tell(ctx, events.viewRequested, { ids: [record.id], canvas: record.canvas, call: "view.goto", args: { canvas: record.canvas } }, screens);
}

function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Partial<Pick<T, K>> {
	return Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]])) as Partial<Pick<T, K>>;
}
