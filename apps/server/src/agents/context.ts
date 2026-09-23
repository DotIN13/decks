import { processZone } from "../lib/clock.ts";
import { existsSync, readFileSync } from "node:fs";
import { agentsTemplate, stageDts } from "@decks/runtime";
import type { Deck } from "../deck/loader.ts";

/**
 * What the agent is told about the deck, once, as a context file.
 *
 * Each backend injects it once and owns it from there — Pi with the rest of its AGENTS.md
 * discovery, Claude as an appended system prompt — so it is not re-sent per turn and must
 * not pretend to be live. So it holds the
 * things that do not change under the agent's feet (what a board is, how to write
 * one, which roots exist) and points at `list`-style facts rather than embedding a
 * snapshot that will be wrong by the third turn.
 *
 * The board list is the one exception, and it is worth it: an agent that opens a
 * deck already knowing there are three boards called plan, risks and sources asks
 * a better first question.
 *
 * **This file does not know where anything is.** `runtimeDir`, `stageDts` and the rest were
 * four levels of `../../..` computed here; they are `@decks/runtime`'s now, and there is a
 * test over there that the directories exist.
 */

/**
 * The person's timezone, as a fact that does not go stale.
 *
 * A system prompt is written once per session, so it says *which* clock the person is on
 * and how to read it, and leaves the time itself to the places written when work runs
 * (a handed-over brief carries "now") and to `stage.now()`. The zone is the process
 * clock's, which is the deck's Time setting once one is chosen (`settings.ts`).
 */
export function timeLine(): string {
	const zone = processZone();
	return `**The person's timezone is ${zone}.** Times and dates they mention ("this afternoon", "by Friday", "every weekday at nine") are in it. \`date\` in your shell prints it, and \`await stage.now()\` returns the time there. Timestamps from the stage API are epoch milliseconds.`;
}

/**
 * The shared browser's verbs, taken out of the API unless there is a tab to drive.
 *
 * Thirteen verbs one agent has ever used, carried in every other agent's prompt: about 240
 * tokens of type text plus the paragraph that explains it, every turn, for a thing most
 * agents cannot do because nothing is paired. So the block is included when a browser is
 * shared and replaced by one line when it is not — the line names the verb that says how to
 * pair, which is the only thing an agent can usefully do about it.
 */
export function apiFor(api: string, options: { web: boolean }): string {
	if (options.web) return api;
	const start = api.indexOf("\n\tweb: {");
	if (start < 0) return api;
	const end = api.indexOf("\n\t};", start);
	if (end < 0) return api;
	return (
		api.slice(0, start) +
		"\n\t/** The person's own Chrome, when they are sharing a tab. Nothing is shared now; `stage.web.status()` says so and how to pair. */\n\tweb: { status(): Promise<{ paired: boolean; connected: boolean }>; pairing(): Promise<{ code: string; path: string; note: string }> };" +
		api.slice(end + "\n\t};".length)
	);
}

export function deckContext(deck: Deck, toolName: string, options: { web?: boolean } = {}): string {
	const template = agentsTemplate();
	if (!existsSync(template)) {
		// A missing template is a broken install, not a reason to refuse to run: the
		// agent still has the skills and the deck.
		return `You are working in a deck at ${deck.path}. Boards are HTML files under boards/. The canvas tool is \`${toolName}\`.`;
	}

	const boards = deck.boards;
	const boardList =
		boards.length === 0
			? "_None yet. Write the first one._"
			: boards
					.map((board) => `- \`${board.path}\` — ${board.title} (${board.w}×${board.h})`)
					.join("\n");

	const roots = deck.roots.roots;
	const rootList =
		roots.length === 0
			? "No roots are declared, so embeds can only reach files inside the deck."
			: [
					"Roots declared in `deck.json`, which embeds may reach:",
					"",
					...roots.map((root) => `- \`${root.path}\`${root.exists ? "" : " — **missing**"}`),
				].join("\n");

	const stageApi = stageDts();
	const api = existsSync(stageApi) ? readFileSync(stageApi, "utf8") : "";

	return readFileSync(template, "utf8")
		.replaceAll("{{STAGE_API}}", api ? ["```ts", apiFor(api, { web: options.web === true }).trim(), "```"].join("\n") : "_The stage API is not available in this install._")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", deck.path)
		.replaceAll("{{BOARDS}}", boardList)
		.replaceAll("{{ROOTS}}", rootList)
		.replaceAll("{{TIME}}", timeLine())
		/*
		 * Last, and deliberately: the tool has a different name on each runtime — Pi
		 * registers `stage_eval`, while through the SDK's MCP server the model sees
		 * `mcp__decks__stage_eval` — and `{{STAGE_API}}` above inlines `stage.d.ts`, which
		 * names it too. Substituting after that insertion covers both places, so neither
		 * runtime reads instructions naming a tool it does not have.
		 */
		.replaceAll("{{STAGE_TOOL}}", toolName);
}
