import { reconcile } from "solid-js/store";
import { ensureAgent, nameOf, setState, state } from "../deck.ts";
import { added, grown } from "../sync-chat.ts";
import { amendChat, heardState, tellChats, type SyncHooks } from "../sync.ts";
import type { AgentChat, AgentState, ChatItem } from "../types/index.ts";
import { setUsagePanel, tookReport } from "../ui.ts";
import type { Old } from "./socket.ts";

// Today's socket messages, applied as today's page applied them: the agent
// list, an agent's state, identity, row, usage, question and report, and a
// conversation's entries. Goes with compat, after stop 3.

type Row = AgentChat & { boards?: string[] };

/** The whole list, as the old agent.list said it: rows, the one on screen, the default kind. */
function list(message: Old, hooks: SyncHooks): void {
	const chats = ((message.chats as Row[] | undefined) ?? []).map((row) => ({ ...row, cards: row.cards ?? row.boards ?? [], inPlay: row.inPlay ?? [] }));
	tellChats(chats, hooks);
	if (typeof message.focused === "string") setState("focused", message.focused);
	if (typeof message.defaultKind === "string") setState("defaultKind", message.defaultKind as never);
	for (const chat of chats) {
		ensureAgent(chat.id);
		if (chat.identity) setState("identities", chat.id, reconcile(chat.identity));
		setState("contexts", chat.id, chat.cards);
		setState("agents", chat.id, "inPlay", chat.inPlay);
		setState("agents", chat.id, "model", chat.model);
		setState("agents", chat.id, "usage", chat.usage);
	}
}

const id = (message: Old) => String(message.id ?? message.agentId ?? "");

const APPLY: Record<string, (message: Old, hooks: SyncHooks) => void> = {
	"agent.list": list,
	"agent.state": (m, hooks) => {
		amendChat(id(m), { state: m.state as AgentState });
		heardState(id(m), m.state as AgentState, hooks);
	},
	"agent.identity": (m) => setState("identities", id(m), reconcile(m.identity as AgentChat["identity"])),
	"agent.row": (m) => amendChat(id(m), { ...(m.lastLine !== undefined ? { lastLine: m.lastLine as string } : {}), ...(m.lastAt !== undefined ? { lastAt: m.lastAt as number } : {}), ...(m.mode ? { mode: m.mode as AgentChat["mode"] } : {}), dormant: m.dormant ? true : (undefined as never) }),
	"agent.usage": (m) => (ensureAgent(id(m)), setState("agents", id(m), "usage", m.usage as never)),
	"agent.model": (m) => (ensureAgent(id(m)), setState("agents", id(m), "model", m.model as never)),
	"agent.prompt": (m, hooks) => {
		const prompt = m.prompt as { id: string; title?: string };
		ensureAgent(id(m));
		setState("agents", id(m), "dialog", prompt as never);
		hooks.raise("ask", { title: `${nameOf(id(m))} is waiting for you`, ...(prompt.title ? { body: prompt.title } : {}), tag: `prompt:${prompt.id}`, agent: id(m) });
	},
	"agent.promptClosed": (m) => state.agents[id(m)] && setState("agents", id(m), "dialog", (current) => (current?.id === m.id ? undefined : current)),
	"agent.report": (m) => {
		if (m.show) setUsagePanel(id(m));
		tookReport(id(m), { ...(m.report ? { report: m.report as never } : {}), ...(m.error ? { error: m.error as string } : {}) });
	},
	"chat.item": (m) => added(id(m), m.item as ChatItem),
	"chat.delta": (m) => grown(id(m), String(m.itemId), String(m.delta ?? ""), m.field === "thinking" ? "thinking" : "text"),
};

/** Apply one of today's messages; one the page never drew from is left alone. */
export function applyOld(message: Old, hooks: SyncHooks): void {
	APPLY[message.type]?.(message, hooks);
}
