import { front } from "./tabs.ts";

/**
 * What the person is looking at, said with each message they write.
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an
 * agent has no canvas of its own to take "here" for: its calls name the canvas they work on. So
 * every message is sent with the tab that was in front, its kind and what it is of. That is all the
 * page says. The harness writes the line the agent reads, before the words, with the other notes a
 * message is sent with (`apps/server/src/agents/looking-at.ts`), and writes none before a slash
 * command, which has to reach the runtime as the exact line it is. The composer shows nothing of it.
 */
export function lookingAt(): { kind: "canvas" | "card" | "document" | "app"; target: string } | undefined {
	const tab = front();
	// A chat on no canvas yet is looking at nothing.
	return tab.target === undefined ? undefined : { kind: tab.kind as "canvas" | "card" | "document" | "app", target: tab.target };
}
