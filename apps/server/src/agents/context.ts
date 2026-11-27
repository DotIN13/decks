import { processZone } from "../lib/clock.ts";
import { existsSync, readFileSync } from "node:fs";
import { agentsTemplate } from "@decks/runtime";
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
 * **This file does not know where anything is.** `runtimeDir`, `decksCommands` and the rest were
 * four levels of `../../..` computed here; they are `@decks/runtime`'s now, and there is a
 * test over there that the directories exist.
 */

/**
 * The person's timezone, as a fact that does not go stale.
 *
 * A system prompt is written once per session, so it says *which* clock the person is on
 * and how to read it, and leaves the time itself to the places written when work runs
 * (a handed-over brief carries "now") and to `decks now`. The zone is the process
 * clock's, which is the deck's Time setting once one is chosen (`settings.ts`).
 */
function timeLine(): string {
	const zone = processZone();
	return `**The person's timezone is ${zone}.** Times and dates they mention ("this afternoon", "by Friday", "every weekday at nine") are in it. \`date\` in your shell prints it, and \`decks now\` returns the time there. Timestamps from Decks are epoch milliseconds.`;
}

/**
 * The line about the person's shared Chrome tab, only while one is shared.
 *
 * The browser's verbs used to be described in full to every agent, shared tab or not; the index
 * now names them only when there is a tab to drive, and `decks help web …` has the rest.
 */
function webLine(web: boolean): string {
	return web ? "\nThe person is sharing a Chrome tab with you: the `decks web …` commands read and drive it (`decks help web read`).\n" : "";
}

export function deckContext(deck: Deck, options: { web?: boolean } = {}): string {
	const template = agentsTemplate();
	if (!existsSync(template)) {
		// A missing template is a broken install, not a reason to refuse to run: the
		// agent still has the skills and the deck.
		return `You are working in a deck at ${deck.path}. Each canvas keeps its cards in canvases/<name>/cards/<card>/index.html. The decks command in your shell reaches the canvas: decks --help.`;
	}
	// An index, not a manual: no list of the deck's cards (`decks card list` answers) and no command
	// reference (`decks help <command>` does); the details live in the skills it points to.
	return readFileSync(template, "utf8")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", deck.path)
		.replaceAll("{{WEB}}", webLine(options.web === true))
		.replaceAll("{{TIME}}", timeLine())
		.trimEnd();
}

/**
 * Everything Decks tells an agent once, as the start of its conversation: the deck's index and any
 * extra guidelines (`runtime/guidelines.txt`). One function, so every runtime gets the same words;
 * where each puts them is its own (a system prompt, a context file, a session instruction, or the
 * first prompt where a runtime has no other way in).
 */
export function agentBriefing(deck: Deck, context: { tool: { webShared(): boolean; guidelines: readonly string[] } }): string {
	const extra = context.tool.guidelines.map((line) => `- ${line}`);
	return [deckContext(deck, { web: context.tool.webShared() }), ...(extra.length ? ["", ...extra] : [])].join("\n");
}

