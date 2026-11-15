import type { Caller } from "../../protocol/index.ts";
import { toDeckPath, type Client, type Deck, type Peer, type Route, type SocketDoor, type Stop } from "../kernel/index.ts";
import { itemOp } from "./args.ts";
import { pagesOf, readDrawing } from "./drawing.ts";

// Today's tab socket at /ws?decks_token=: the roster as "agents", an agent's drawing as
// "stage.pen", its cards as "context.changed", and the dozen messages today's checks send.
// Each message becomes a new call; nothing here keeps state but which agent this socket is on.

export const TAB_PATH = "/ws";
type Said = Record<string, unknown>;
type AgentRow = { id: string; name: string; color?: string; kind?: string; state?: string; canvas?: string; workspace?: string; tags?: string[] };
/** held: every card each agent has had in play, as today's context kept it (boards), for this server's life. */
type Tab = { door: SocketDoor; deck: () => Deck; caller: Caller; client: Client; send(m: Said): void; focused?: string; held: Map<string, Set<string>> };

export function tabRoute(deck: () => Deck): Route {
	const held = new Map<string, Set<string>>();
	return {
		method: "GET",
		prefix: TAB_PATH,
		upgrade(req, socket, _head, door) {
			const token = new URL(req.url ?? "/", "http://decks.local").searchParams.get("decks_token") ?? undefined;
			const caller = door.resolve(token);
			if (!caller || caller.kind !== "person") return void socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
			const peer = door.accept();
			if (peer) openTab(peer, { door, deck, caller, client: door.client(), send: (m) => peer.send(JSON.stringify(m)), held });
		},
	};
}

function openTab(peer: Peer, tab: Tab): void {
	const stops: Stop[] = [];
	stops.push(tab.door.subscribe({ caller: tab.caller, client: tab.client.id, events: ["agent.changed", "agent.deleted"] }, (e) => void agentHeard(tab, e.name, e.payload)));
	stops.push(tab.door.subscribe({ caller: tab.caller, client: tab.client.id, events: ["item.changed", "card.changed"] }, (e) => void drawingChanged(tab, String(e.payload.canvas ?? ""))));
	peer.onClose(() => (stops.forEach((stop) => stop()), (tab.client as Client & { end?: () => void }).end?.()));
	peer.onText((text) => {
		let message: Said;
		try {
			message = JSON.parse(text) as Said;
		} catch {
			return;
		}
		void heard(tab, message).catch((error: Error) => tab.send({ type: "notice", level: "error", text: error.message }));
	});
	void roster(tab);
}

const call = async <T>(tab: Tab, name: string, args: Record<string, unknown>): Promise<T> => {
	const envelope = await tab.door.call(name, args, tab.caller, tab.client);
	if (!envelope.ok) throw new Error(envelope.error.message);
	return envelope.value as T;
};

/**
 * An agent's held cards (today's boards): what it has in play now, and every card it had before.
 * A card hidden from the canvas leaves inPlay and stays held, as today; the new protocol keeps no such list.
 */
function heldBy(tab: Tab, agent: string, now: string[]): string[] {
	const set = tab.held.get(agent) ?? new Set<string>();
	for (const path of now) set.add(path);
	tab.held.set(agent, set);
	return [...set];
}

async function inPlay(tab: Tab, canvas: string | undefined): Promise<string[]> {
	if (!canvas) return [];
	const read = await readDrawing(tab.deck(), canvas, "");
	return read ? pagesOf(canvas, read.doc, true).map((page) => String(page.path)) : [];
}

async function context(tab: Tab, agent: string, canvas: string | undefined): Promise<{ boards: string[]; inPlay: string[] }> {
	const now = await inPlay(tab, canvas);
	return { boards: heldBy(tab, agent, now), inPlay: now };
}

/** The roster today's page and checks read: every agent as a chat row, and which is focused. */
async function roster(tab: Tab): Promise<AgentRow[]> {
	const agents = await call<AgentRow[]>(tab, "agent.list", {});
	if (!tab.focused || !agents.some((a) => a.id === tab.focused)) tab.focused = agents[0]?.id;
	const chats = await Promise.all(agents.map(async (a) => ({ id: a.id, name: a.name, color: a.color, kind: a.kind ?? "pi", state: a.state ?? "idle", stage: a.canvas, workspace: a.workspace, tags: a.tags ?? [], unread: 0, ...(await context(tab, a.id, a.canvas)) })));
	tab.send({ type: "agents", chats, ...(tab.focused ? { focused: tab.focused } : {}), defaultKind: "pi" });
	await stages(tab, agents);
	return agents;
}

/** An agent's state is told as today's agent.state, one per agent; then the roster and stages again. */
async function agentHeard(tab: Tab, name: string, payload: Record<string, unknown>): Promise<void> {
	const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
	// A state rides on every change of an agent, its canvas too, so the roster and stages follow each one.
	if (name === "agent.changed" && typeof payload.state === "string") for (const id of ids) tab.send({ type: "agent.state", id, state: payload.state });
	if (name === "agent.deleted") for (const id of ids) tab.send({ type: "agent.removed", id });
	await roster(tab);
}

/** Today's canvas list: each canvas with the agents at home on it. */
async function stages(tab: Tab, agents?: AgentRow[]): Promise<void> {
	const list = await call<Array<{ name: string; title: string; rev?: number }>>(tab, "canvas.list", {});
	const all = agents ?? (await call<AgentRow[]>(tab, "agent.list", {}));
	const on = (name: string) => all.filter((a) => a.canvas === name).map((a) => ({ id: a.id, name: a.name, color: a.color }));
	tab.send({ type: "stages", stages: list.map((c) => ({ name: c.name, title: c.title, rev: c.rev ?? 0, agents: on(c.name) })) });
}

/** An agent's drawing, whole, as today's stage.pen. */
async function stagePen(tab: Tab, agentId: string): Promise<void> {
	const agent = (await call<AgentRow[]>(tab, "agent.list", {})).find((a) => a.id === agentId);
	if (!agent?.canvas) return;
	const got = await call<{ rev?: number }>(tab, "canvas.get", { canvas: agent.canvas });
	const read = await readDrawing(tab.deck(), agent.canvas, `/files/canvases/${agent.canvas}/`);
	if (read) tab.send({ type: "stage.pen", agentId, stage: agent.canvas, rev: got.rev ?? 0, doc: read.doc, base: read.base });
}

async function drawingChanged(tab: Tab, canvas: string): Promise<void> {
	const agents = await call<AgentRow[]>(tab, "agent.list", {});
	for (const agent of agents.filter((a) => a.canvas === canvas)) {
		await stagePen(tab, agent.id);
		tab.send({ type: "context.changed", agentId: agent.id, ...(await context(tab, agent.id, canvas)) });
	}
}

async function canvasOf(tab: Tab, message: Said): Promise<string | undefined> {
	if (typeof message.stage === "string") return message.stage;
	const id = String(message.agentId ?? tab.focused ?? "");
	return (await call<AgentRow[]>(tab, "agent.list", {})).find((a) => a.id === id)?.canvas;
}

async function heard(tab: Tab, m: Said): Promise<void> {
	const canvas = async () => ({ canvas: await canvasOf(tab, m) });
	switch (m.type) {
		case "agent.focus": return void ((tab.focused = String(m.id)), await roster(tab));
		case "agent.stage": return void (await call(tab, "agent.update", { agent: m.id, change: { canvas: m.stage } }), await roster(tab), await drawingChanged(tab, String(m.stage)));
		case "stage.pen.get": return stagePen(tab, String(m.agentId ?? tab.focused));
		case "stage.pen.edit": return void (await call(tab, "item.batch", { ops: (m.ops as unknown[]).map(itemOp), ...(await canvas()) }));
		case "card.move": return void (await call(tab, "item.move", { id: m.path, at: { x: m.x, y: m.y }, ...(await canvas()) }));
		case "card.resize": return void (await call(tab, "item.update", { id: m.path, size: { ...(m.w !== undefined ? { w: m.w } : {}), ...(m.h !== undefined ? { h: m.h } : {}) }, ...(await canvas()) }));
		case "card.play": return void (await call(tab, "item.insert", { item: { type: "card", card: m.path }, ...(await canvas()) }));
		case "card.hide": return void (await call(tab, "item.delete", { id: m.path, ...(await canvas()) }));
		case "agent.create": return agentCreate(tab, m);
		case "agent.remove": return void (await call(tab, "agent.delete", { agent: m.id }));
		case "agent.rename": return identity(tab, await call<AgentRow>(tab, "agent.update", { agent: m.id, change: { name: m.name } }));
		case "document.create": return documentCreate(tab, m, (await canvas()).canvas);
	}
}

/** A new agent, and this socket on it, as today: the browser that asked is focused on what it made. */
async function agentCreate(tab: Tab, m: Said): Promise<void> {
	const made = await call<AgentRow>(tab, "agent.create", { ...(m.kind ? { kind: m.kind } : {}), ...(m.workspace ? { workspace: m.workspace } : {}), ...(m.near ? { near: m.near } : {}) });
	tab.focused = made.id;
	await roster(tab);
}

/** A rename is answered with the agent's identity, as today. */
function identity(tab: Tab, agent: AgentRow): void {
	tab.send({ type: "agent.identity", id: agent.id, identity: { name: agent.name, color: agent.color, tags: agent.tags ?? [] } });
}

async function documentCreate(tab: Tab, m: Said, canvas: string | undefined): Promise<void> {
	// Today's picker opened only a file that is there; canvas insert (a call) still makes a missing one.
	if (typeof m.document === "string" && !(await tab.deck().read(toDeckPath(m.document)).then(() => true, () => false))) {
		return tab.send({ type: "notice", level: "error", text: `There is no file ${m.document} in the deck to open as a document.` });
	}
	const at = m.at && typeof m.at === "object" ? { at: m.at } : {};
	const item = (await call<{ id?: string }>(tab, "item.insert", { item: { type: "document", ...(typeof m.document === "string" ? { path: m.document } : {}) }, canvas, ...at })) ?? {};
	// Today's answer named the item on the canvas, item:<id>, which the page selects and flies to.
	if (typeof m.request === "string") tab.send({ type: "document.created", request: m.request, path: `item:${item.id ?? ""}` });
}
