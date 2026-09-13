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

export function deckContext(deck: Deck, toolName: string): string {
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
		.replaceAll("{{STAGE_API}}", api ? ["```ts", api.trim(), "```"].join("\n") : "_The stage API is not available in this install._")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", deck.path)
		.replaceAll("{{BOARDS}}", boardList)
		.replaceAll("{{ROOTS}}", rootList)
		/*
		 * Last, and deliberately: the tool has a different name on each runtime — Pi
		 * registers `stage_eval`, while through the SDK's MCP server the model sees
		 * `mcp__decks__stage_eval` — and `{{STAGE_API}}` above inlines `stage.d.ts`, which
		 * names it too. Substituting after that insertion covers both places, so neither
		 * runtime reads instructions naming a tool it does not have.
		 */
		.replaceAll("{{STAGE_TOOL}}", toolName);
}
