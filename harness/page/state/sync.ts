import { reconcile } from "solid-js/store";
import { setTimeZone } from "@decks/ui";
import { finished, startedAsking } from "@decks/agent-ui/alerts";
import { scratch } from "./agent.ts";
import { setStages } from "./canvases.ts";
import { ensureAgent, nameOf, setState, state } from "./deck.ts";
import { call, on } from "./line.ts";
import { notice } from "./notices.ts";
import { setQueued } from "./queued.ts";
import { accountsOf, cardsOn, chatOf, pageOf, runtimeOf, stageRowOf, type AgentExtra } from "./rows.ts";
import type { AgentChat, AgentState, ClaudeAccount } from "./types/index.ts";
import { accountChanged, releasePages } from "./ui.ts";
import { hearChat } from "./sync-chat.ts";

// The page's state, kept from the server and the harness: a snapshot by call
// when the line comes up, and again for each event that says a part changed.
// Events carry ids, never the thing: the thing is read by its call.

export type Raise = (kind: "done" | "ask" | "problem", banner: { title: string; body?: string; tag?: string; agent?: string }) => void;

/** What the sync needs from the shell: how to raise an alert, and what to do when the deck has arrived. */
export interface SyncHooks {
	raise: Raise;
	landed(): void;
	hearCreated(request: string, path: string): void;
}

type Agent = Parameters<typeof chatOf>[0];
type Card = Parameters<typeof pageOf>[0];
type Canvas = Parameters<typeof stageRowOf>[0];

/** The latest answers the rows are made from; not drawn, so not reactive. */
const held = { agents: [] as Agent[], cards: [] as Card[], canvases: [] as Canvas[], extras: {} as Record<string, AgentExtra>, told: [] as AgentChat[] };

/** Rows told by today's socket messages (state/compat), drawn beside the server's until it has the same id. */
export function tellChats(chats: AgentChat[], hooks: SyncHooks): void {
	held.told = chats;
	drawAgents(hooks);
}

/** Change one row as today's socket said: the told copy too, so the next drawing keeps it. */
export function amendChat(id: string, patch: Partial<AgentChat>): void {
	held.told = held.told.map((one) => (one.id === id ? { ...one, ...patch } : one));
	setState("chats", (chats) => chats.map((one) => (one.id === id ? { ...one, ...patch } : one)));
}

/** A ring when a face turns green or starts waiting: keyed on the change, so a reload rings nothing. */
export function heardState(id: string, next: AgentState, hooks: SyncHooks): void {
	const mine = scratch.of(id);
	const was = mine.lastState;
	mine.lastState = next;
	if (finished(was, next)) hooks.raise("done", { title: `${nameOf(id)} finished`, tag: `done:${id}`, agent: id });
	else if (startedAsking(was, next)) hooks.raise("ask", { title: `${nameOf(id)} is waiting for you`, tag: `ask:${id}`, agent: id });
}

/** Rebuild the agent rows from what is held, writing only what changed. */
function drawAgents(hooks: SyncHooks): void {
	const served = held.agents.map((agent) => chatOf(agent, held.extras[agent.id], cardsOn(held.cards, agent.canvas)));
	const chats = [...served, ...held.told.filter((one) => !served.some((row) => row.id === one.id))];
	setState("chats", reconcile(chats, { key: "id", merge: true }));
	for (const chat of chats) {
		ensureAgent(chat.id);
		setState("identities", chat.id, reconcile(chat.identity));
		setState("contexts", chat.id, chat.cards);
		setState("agents", chat.id, "inPlay", chat.inPlay);
		setState("agents", chat.id, "model", chat.model);
		setState("agents", chat.id, "usage", chat.usage);
		setState("agents", chat.id, "spending", chat.account);
		heardState(chat.id, chat.state, hooks);
	}
	setStages(held.canvases.map((canvas) => stageRowOf(canvas, held.agents)));
	if (!state.focused && chats[0]) setState("focused", chats[0].id);
	if (!state.focused) releasePages();
}

/** What only the harness knows of one agent: its lines, usage, queue and questions. Quiet when no harness answers. */
async function readExtra(id: string): Promise<void> {
	const answer = await call<AgentExtra>("runtime.get", { agent: id });
	if (!answer.ok) return;
	held.extras[id] = answer.value;
	if (answer.value.queued) setQueued(id, answer.value.queued);
	const dialog = answer.value.dialogs?.[0] as { id: string } | undefined;
	ensureAgent(id);
	setState("agents", id, "dialog", dialog as never);
}

async function readAgents(hooks: SyncHooks): Promise<void> {
	const answer = await call<Agent[]>("agent.list", {});
	if (!answer.ok) return void notice("warn", answer.error);
	held.agents = answer.value;
	drawAgents(hooks);
	await Promise.all(held.agents.map((agent) => readExtra(agent.id)));
	drawAgents(hooks);
}

async function readCanvases(hooks: SyncHooks): Promise<void> {
	const answer = await call<Canvas[]>("canvas.list", {});
	if (answer.ok) held.canvases = answer.value;
	drawAgents(hooks);
}

async function readCards(hooks: SyncHooks): Promise<void> {
	const answer = await call<Card[]>("card.list", {});
	if (!answer.ok) return;
	held.cards = answer.value;
	setState("pages", reconcile(held.cards.map(pageOf), { key: "path", merge: true }));
	drawAgents(hooks);
	hooks.landed();
}

async function readDeck(): Promise<void> {
	const answer = await call<{ timezone?: string; warnings: string[] }>("deck.get", {});
	if (!answer.ok) return;
	if (answer.value.timezone) setTimeZone(answer.value.timezone);
	setState("settings", "timezone" as never, answer.value.timezone as never);
	for (const warning of answer.value.warnings) notice("warn", warning);
}

async function readRuntimes(): Promise<void> {
	const answer = await call<Parameters<typeof runtimeOf>[0][]>("runtime.list", {});
	if (answer.ok) setState("runtimes", answer.value.map(runtimeOf));
}

async function readAccounts(): Promise<void> {
	const answer = await call<Array<{ id: string; label: string; active: boolean; spending?: string }>>("account.list", {});
	if (!answer.ok) return;
	const { accounts, active } = accountsOf(answer.value);
	setState({ accounts: accounts as ClaudeAccount[], activeAccount: active });
}

async function readTab(): Promise<void> {
	const answer = await call<{ paired: boolean; connected: boolean }>("tab.status", {});
	if (answer.ok) setState("web", (was) => ({ status: answer.value as never, ...(was?.code ? { code: was.code } : {}) }));
}

/** Everything, read again: what the line coming up means. */
export async function readAll(hooks: SyncHooks): Promise<void> {
	await Promise.all([readDeck(), readRuntimes(), readAccounts(), readTab(), readCanvases(hooks)]);
	await readCards(hooks);
	await readAgents(hooks);
}

/** Hear every event the page draws from. Answers the stop. */
export function listen(hooks: SyncHooks): () => void {
	const stops = [
		on("agent.changed", (event) => {
			const ids = (event.ids as string[]) ?? [];
			void readAgents(hooks).then(() => Promise.all(ids.map(readExtra)).then(() => drawAgents(hooks)));
		}),
		on("agent.deleted", (event) => {
			for (const id of (event.ids as string[]) ?? []) forget(id);
			void readAgents(hooks);
		}),
		on("canvas.changed", () => void readCanvases(hooks)),
		on("card.changed", () => void readCards(hooks)),
		on("item.changed", () => void readCards(hooks)),
		on("deck.changed", () => void readDeck()),
		on("runtime.changed", () => void readRuntimes()),
		on("account.changed", (event) => {
			void readAccounts();
			for (const id of (event.ids as string[]) ?? []) accountChanged(id);
		}),
		on("tab.changed", (event) => {
			if (typeof event.code === "string") setState("web", (was) => (was ? { ...was, code: event.code as string } : was));
			void readTab();
		}),
		on("file.created", (event) => typeof event.request === "string" && hooks.hearCreated(event.request, ((event.ids as string[]) ?? [])[0] ?? "")),
		on("runtime.noticed", (event) => {
			notice(event.level as "info" | "warn" | "error", String(event.text));
			if (event.level === "error") hooks.raise("problem", { title: "Something went wrong", body: String(event.text), tag: "problem" });
		}),
		on("chat.changed", (event) => void Promise.all(((event.ids as string[]) ?? []).map(readExtra)).then(() => drawAgents(hooks))),
		...hearChat(hooks.raise),
	];
	return () => stops.forEach((stop) => stop());
}

/** Drop what was kept for an agent that is gone, whole. */
function forget(id: string): void {
	scratch.forget(id);
	delete held.extras[id];
	setState("agents", id, undefined);
	setState("identities", id, undefined as never);
	setState("contexts", id, undefined as never);
}
