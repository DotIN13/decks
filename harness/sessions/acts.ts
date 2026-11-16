// An agent's own file tools changing a card, told to the server as that agent:
// when the tool begins, agent.act { phase: "start" } moves its cursor there; when
// it finishes, card.claim records it as the card's writer and shows the glow.
import { layout } from "@decks/protocol";
import type { Client } from "@decks/sdk";

export type ToolEvent = { callId: string; name: string; args: unknown; phase: "start" | "end"; ok?: boolean };

/** The tools that write a file, as each runtime names them, after any MCP prefix. */
const WRITERS = /^(write|edit|multi_?edit|patch|apply_patch|notebook_?edit|create_file|write_to_file|replace_file_content|multi_replace_file_content|str_replace_based_edit_tool)$/i;
/** Where each runtime's write and edit tools put the file's path. */
const PATH_KEYS = ["file_path", "path", "filePath", "file", "TargetFile", "target_file", "AbsolutePath", "notebook_path"];

/** The tool's own name, without an MCP server's prefix. */
const toolOf = (name: string): string => /^mcp__.+__(.+)$/.exec(name)?.[1] ?? name;

/** The card a writing tool's file belongs to, by deck path; none for another tool or a file outside a card. */
export function writtenCard(name: string, args: unknown, deckPath: string): string | undefined {
	if (!WRITERS.test(toolOf(name))) return undefined;
	const given = (args ?? {}) as Record<string, unknown>;
	const raw = PATH_KEYS.map((key) => given[key]).find((one): one is string => typeof one === "string" && one.length > 0);
	if (!raw) return undefined;
	const path = raw.startsWith("/") ? (raw.startsWith(`${deckPath}/`) ? raw.slice(deckPath.length + 1) : undefined) : raw.replace(/^\.\//, "");
	if (!path || path.startsWith("..")) return undefined;
	return layout.isCardPath(path) ? path : layout.cardOf(path);
}

/** What the act is called: a whole file written, or words in it changed. */
export function actWhat(name: string): "write" | "edit" {
	return /write|create/i.test(toolOf(name)) ? "write" : "edit";
}

/** Tell the server one tool event of the agent's; a refusal changes nothing in the turn. */
export async function tellWrite(client: Client, event: ToolEvent, deckPath: string): Promise<void> {
	const card = writtenCard(event.name, event.args, deckPath);
	if (!card) return;
	if (event.phase === "start") await client.call("agent.act", { cards: [card], phase: "start", what: actWhat(event.name) }).catch(() => {});
	else if (event.ok !== false) await client.call("card.claim", { cards: card }).catch(() => {});
}

/** One agent's tool events told in the order they happened: each call waits for the one before. */
export function writeTeller(client: () => Client, deckPath: string): (event: ToolEvent) => void {
	let last: Promise<void> = Promise.resolve();
	return (event) => {
		last = last.then(() => tellWrite(client(), event, deckPath));
	};
}
