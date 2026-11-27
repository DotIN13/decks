import { readFileSync, writeFileSync } from "node:fs";
import type { ServerMessage } from "@decks/protocol";
import { cleanLooking } from "../agents/looking-at.ts";
import { cleanParts } from "../agents/message-parts.ts";
import type { Registry } from "../agents/registry.ts";
import type { CardService } from "../cards/service.ts";
import type { Deck } from "../deck/loader.ts";
import { needAgent, notice, type PersonVerbs } from "./person-call.ts";

/**
 * The person's verbs about a conversation (`chat.*`): say something, stop, queue, read back, and go
 * back in it: rewind, fork, or put the boards back as they were at a message.
 */

/** What the chat verbs need of the harness: the agents, and the boards with their revisions on the deck. */
export interface ChatTableHost {
	readonly agents: Registry;
	readonly boards: CardService;
	readonly deck: Deck;
}

export function chatTable(host: ChatTableHost): PersonVerbs {
	const agents = host.agents;
	const need = (id: unknown) => needAgent(agents, id);
	return {
		"chat.send": async ([id, message]) => {
			const given = (message ?? {}) as { text?: string; parts?: unknown[]; at?: unknown };
			const agent = agents.get(String(id)) ?? agents.focused();
			void agent.prompt(String(given.text ?? ""), cleanParts(given.parts as never), cleanLooking(given.at));
			agent.sayRow();
		},
		"chat.abort": async ([id]) => {
			void agents.get(String(id))?.conversation.abort();
		},
		"chat.queue": async ([id, change]) => {
			const agent = need(id);
			const asked = (change ?? {}) as { action?: string; text?: string; parts?: unknown[]; item?: string; at?: unknown };
			if (asked.action === "add" && typeof asked.text === "string") agent.turns.queueMine(asked.text, cleanParts(asked.parts as never), cleanLooking(asked.at));
			else if (asked.action === "remove" && typeof asked.item === "string") agent.turns.unqueueMine(asked.item);
			else if (asked.action === "send" && typeof asked.item === "string") agent.turns.sendMineNow(asked.item);
			else if (asked.action === "release") agent.turns.releaseMine();
			agent.sayRow();
		},
		"chat.open": async ([id], call) => {
			const agent = need(id);
			const history = agent.conversation.historyMessage() as Extract<ServerMessage, { type: "chat.history" }>;
			call.tell(history);
			return { items: history.items, more: history.more ?? false };
		},
		"chat.earlier": async ([id, page], call) => {
			const asked = (page ?? {}) as { before?: string; limit?: number };
			const before = String(asked.before ?? "");
			const agent = agents.get(String(id));
			if (!agent) {
				call.tell({ type: "chat.earlier", agentId: String(id), before, items: [], more: false });
				return;
			}
			const got = agent.conversation.earlier(before, Math.min(Math.max(asked.limit ?? 60, 1), 200));
			call.tell({ type: "chat.earlier", agentId: agent.id, before, items: got.items, more: got.more });
			return { items: got.items, more: got.more };
		},
		"chat.tool": async ([id, item], call) => {
			const agent = agents.get(String(id));
			const result = agent?.conversation.toolResult(String(item)) ?? "";
			call.tell({ type: "chat.tool", agentId: String(id), itemId: String(item), result });
			return { result };
		},
		"chat.preview": async ([id, entry], call) => {
			const agent = need(id);
			const entryId = entry === null || entry === undefined ? null : String(entry);
			call.tell({ type: "chat.preview", agentId: agent.id, entryId, boards: entryId ? host.boards.cardsAt(agent.conversation, entryId) : {} });
		},
		"chat.rewind": async ([id, entry], call) => {
			const agent = need(id);
			const result = await agent.conversation.rewindTo(String(entry));
			agents.publish();
			if (result.cancelled) {
				notice(call, "info", "Rewind cancelled.");
				return { cancelled: true };
			}
			notice(call, "info", "Rewound.");
			// The words taken back go to the caller's composer as a draft; a caller with no line (Studio, over HTTP) gets them in the answer.
			if (result.editorText) call.tell({ type: "chat.draft", text: result.editorText });
			return { cancelled: false, ...(result.editorText ? { editorText: result.editorText } : {}) };
		},
		"chat.fork": async ([id, entry], call) => {
			const agent = need(id);
			const resumeRef = await agent.conversation.forkFrom(String(entry));
			if (!resumeRef) throw new Error("There is nothing before that message to fork from.");
			const at = agent.conversation.entryTime(String(entry));
			const child = agents.create({
				name: `${agent.chat().name} (fork)`,
				resumeRef,
				kind: agent.kind,
				...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
				...(agent.conversation.model ? { model: agent.conversation.model } : {}),
				...(agent.conversation.mode ? { mode: agent.conversation.mode } : {}),
			});
			if (call.view) call.view.focused = child.id;
			agents.focus(child.id);
			return { id: child.id, name: child.chat().name };
		},
		"chat.restore": async ([id, entry], call) => {
			const agent = need(id);
			const wanted = host.boards.cardsAt(agent.conversation, String(entry));
			let restored = 0;
			for (const [path, sha] of Object.entries(wanted)) {
				try {
					const content = host.boards.revisions.read(sha);
					if (content === readFileSync(host.deck.fileOf(path), "utf8")) continue;
					writeFileSync(host.deck.fileOf(path), content);
					host.boards.revisions.record(path, content);
					restored++;
				} catch (error) {
					notice(call, "warn", `Could not restore ${path}: ${(error as Error).message}`);
				}
			}
			notice(call, "info", restored === 0 ? "Those boards are already as they were." : `Restored ${restored} board${restored === 1 ? "" : "s"}.`);
			return { restored };
		},
	};
}
