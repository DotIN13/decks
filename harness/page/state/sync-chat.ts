import { historyShown } from "../chat/edge.ts";
import { ensureAgent, nameOf, setState, state } from "./deck.ts";
import { on } from "./line.ts";
import type { Raise } from "./sync.ts";
import type { ChatItem } from "./types/index.ts";
import { setDraft, setUnread } from "./ui.ts";

// A conversation's events, from the harness through the server: an entry
// added or grown, a question put up or taken down, words for the composer.
// chat.added's ids are [agent, entry]; chat.answered's are [agent, question].

type Event = Record<string, unknown>;
const idsOf = (event: Event) => ((event.ids as string[] | undefined) ?? []) as [string?, string?];

/** The listeners for chat.added, chat.asked, chat.answered and chat.drafted. */
export function hearChat(raise: Raise): Array<() => void> {
	return [
		on("chat.added", (event) => {
			const [agent, entry] = idsOf(event);
			if (!agent) return;
			if (event.item) added(agent, event.item as ChatItem);
			else if (entry && typeof event.delta === "string") grown(agent, entry, event.delta, event.field === "thinking" ? "thinking" : "text");
		}),
		on("chat.asked", (event) => {
			const [agent] = idsOf(event);
			const question = event.question as { id: string; title?: string } | undefined;
			if (!agent || !question) return;
			ensureAgent(agent);
			setState("agents", agent, "dialog", question as never);
			raise("ask", { title: `${nameOf(agent)} is waiting for you`, ...(question.title ? { body: question.title } : {}), tag: `prompt:${question.id}`, agent });
		}),
		on("chat.answered", (event) => {
			const [agent, question] = idsOf(event);
			if (agent && state.agents[agent]) setState("agents", agent, "dialog", (current) => (current?.id === question ? undefined : current));
		}),
		on("chat.drafted", (event) => setDraft({ text: String(event.text ?? ""), at: Date.now(), ...(state.focused ? { agentId: state.focused } : {}) })),
	];
}

/** An entry added, or replacing the one with its id. An answer from an agent not on screen counts as unread. */
export function added(agent: string, item: ChatItem): void {
	const unseen = agent !== state.focused || !historyShown();
	if (unseen && item.kind === "assistant") setUnread(agent, (count = 0) => count + 1);
	ensureAgent(agent);
	setState("agents", agent, "transcript", (items) => {
		const at = items.findIndex((one) => one.id === item.id);
		if (at === -1) return [...items, item];
		const next = [...items];
		next[at] = item;
		return next;
	});
}

/** Words streamed onto an assistant's entry, into its text or its thinking. */
export function grown(agent: string, entry: string, delta: string, field: "text" | "thinking"): void {
	ensureAgent(agent);
	setState("agents", agent, "transcript", (items) =>
		items.map((item) => {
			if (item.id !== entry || item.kind !== "assistant") return item;
			return field === "thinking" ? { ...item, thinking: (item.thinking ?? "") + delta } : { ...item, text: item.text + delta };
		}),
	);
}
