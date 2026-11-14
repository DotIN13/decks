import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { clientFor, type Client } from "@decks-next/sdk";
import type { DecksAccess } from "../runtimes/backend.ts";
import { decksEnv } from "../runtimes/env.ts";
import { deckContext, type DeckFacts } from "../runtimes/shared/context.ts";
import { guidelinesFile } from "../prompts/paths.ts";

// What an agent is given: the decks command with its own token, the deck
// told once from calls, and before each message what changed since its last.

/** The agent's shell's way to Decks: the server, its token, the variables. */
export function decksAccess(url: string, agentId: string, token: string | undefined): DecksAccess {
	return { url, ...(token ? { token } : {}), env: (path?: string) => decksEnv(url, agentId, token, path) };
}

/** A client that calls as the agent itself, with its own token. */
export function agentClient(url: string, token: string | undefined): Client {
	return clientFor(url, token);
}

type CardRow = { path: string; title: string; placements?: Array<{ box?: { x1: number; y1: number; x2: number; y2: number } }> };

/** The facts the briefing states, gathered by calls; a call that fails leaves its fact out. */
export async function deckFacts(client: Client, deckPath: string): Promise<DeckFacts> {
	const cards = (await client.call("card.list").then((a) => a.value as CardRow[]).catch(() => [])) ?? [];
	const tab = await client.call("tab.status").then((a) => a.value as { connected?: boolean }).catch(() => undefined);
	return {
		name: basename(deckPath),
		path: deckPath,
		web: tab?.connected === true,
		cards: cards.map((one) => {
			const box = one.placements?.[0]?.box;
			return { path: one.path, title: one.title, w: box ? Math.round(box.x2 - box.x1) : 0, h: box ? Math.round(box.y2 - box.y1) : 0 };
		}),
	};
}

export function guidelines(): string[] {
	const file = guidelinesFile();
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

/** What the agent is told once: the deck's context, then the guidelines as a list. */
export function briefingText(facts: DeckFacts): string {
	return [deckContext(facts), "", ...guidelines().map((line) => `- ${line}`)].join("\n");
}

type News = { changes: Array<{ canvas?: string; ids: string[]; by: string; event: string }> };

/** What others changed on the agent's canvases since its last message, as lines; none when nothing did. */
export function newsLines(news: News): string | undefined {
	const groups = new Map<string, { ids: Set<string>; count: number }>();
	for (const change of news.changes) {
		const key = `${change.event} on ${change.canvas ?? "the deck"} by ${change.by}`;
		const group = groups.get(key) ?? { ids: new Set<string>(), count: 0 };
		for (const id of change.ids) group.ids.add(id);
		group.count += 1;
		groups.set(key, group);
	}
	if (groups.size === 0) return undefined;
	const lines = [...groups].map(([key, { ids, count }]) => {
		const named = [...ids].slice(0, 8).join(", ") + (ids.size > 8 ? `, and ${ids.size - 8} more` : "");
		return `- ${key}${count > 1 ? ` (${count} times)` : ""}${named ? `: ${named}` : ""}`;
	});
	return `[Decks] Since your last message, others changed your canvas:\n${lines.join("\n")}`;
}

/** Ask the server for the agent's news; moves its mark on. Nothing when the call fails. */
export async function takeNews(client: Client): Promise<string | undefined> {
	const answered = await client.call("agent.news").catch(() => undefined);
	return answered ? newsLines(answered.value as News) : undefined;
}

/** A hand-off as the agent reads it: who sent it, the task, and the cards it names. */
export function brief(from: string, task: string, cards: string[], now: boolean): string {
	const lines = [`${from} ${now ? "sent you this, to act on now" : "queued this for you"}:`, "", task];
	if (cards.length) lines.push("", "The cards it names:", ...cards.map((path) => `- ${path}`));
	return lines.join("\n");
}
