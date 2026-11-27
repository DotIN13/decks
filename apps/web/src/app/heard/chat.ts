import { prepend, receiveToolResult } from "@decks/agent-ui/chat";
import { scratch } from "../../state/agent.ts";
import { ensureAgent, setState, state } from "../../state/deck.ts";
import { resolveEarlier } from "../../state/history.ts";
import { historyShown } from "@decks/agent-ui/edge";
import { releasePages, setDraft, setUnread } from "../../state/ui.ts";
import type { Of } from "../socket-messages.ts";

/** A conversation's transcript: the window of history, an earlier page of it, an item, its increments, a preview, a rewound draft. */
export function heardChat(message: Of<"chat">): void {
	switch (message.type) {
		case "chat.history":
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "transcript", message.items);
			setState("agents", message.agentId, "moreHistory", message.more ?? false);
			scratch.of(message.agentId).historyHeld = true;
			if (message.agentId === state.focused) releasePages();
			scratch.of(message.agentId).historyAsked = false;
			return;

		case "chat.tool":
			receiveToolResult(message.itemId, message.result);
			return;

		case "chat.earlier": {
			/*
			 * A page of scrollback, folded in at the front.
			 *
			 * `prepend` drops anything already held, which is not a hypothetical: a
			 * reader who keeps scrolling asks for a second page before the first has
			 * landed, and a rewind re-sends a window that can overlap a page already
			 * fetched. The held copy wins — it is the one a delta may be arriving into.
			 */
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "transcript", (held) => prepend(message.items, held));
			setState("agents", message.agentId, "moreHistory", message.more);
			// Whoever asked is waiting on the count, so it can hold the reader's place.
			resolveEarlier(message.before, message.items.length);
			return;
		}

		case "chat.item": {
			const item = message.item;
			/*
			 * A reply you cannot see is the thing an unread count is for — whether
			 * that is because you are in another conversation or because the panel
			 * is away. Your own messages are not news.
			 */
			const unseen = message.agentId !== state.focused || !historyShown();
			if (unseen && item.kind === "assistant") setUnread(message.agentId, (count = 0) => count + 1);
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "transcript", (items) => {
				const index = items.findIndex((existing) => existing.id === item.id);
				if (index === -1) return [...items, item];
				const next = [...items];
				next[index] = item;
				return next;
			});
			return;
		}

		case "chat.delta": {
			// Deltas are applied to the item in place: the server sends the whole
			// item at the start and the end, and the increments in between.
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "transcript", (items) =>
				items.map((item) => {
					if (item.id !== message.itemId || item.kind !== "assistant") return item;
					return message.field === "thinking"
						? { ...item, thinking: (item.thinking ?? "") + message.delta }
						: { ...item, text: item.text + message.delta };
				}),
			);
			return;
		}

		case "chat.preview":
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "preview", message.entryId ? { entryId: message.entryId, cards: message.cards } : undefined);
			return;

		case "chat.draft":
			// A rewound message, for the conversation that was rewound — the one on screen.
			setDraft({ text: message.text, at: Date.now(), ...(state.focused ? { agentId: state.focused } : {}) });
			return;
		default:
			return;
	}
}
