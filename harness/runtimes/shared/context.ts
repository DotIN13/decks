import { existsSync, readFileSync } from "node:fs";
import { agentsTemplate, decksCommands } from "../../prompts/paths.ts";

/** What the briefing says about the deck, gathered by calls (sessions/tools.ts). */
export interface DeckFacts {
	name: string;
	path: string;
	cards: { path: string; title: string; w: number; h: number }[];
	/** Whether a Chrome tab is shared, so the tab calls are worth telling. */
	web?: boolean;
}

const processZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const isCardPath = (path: string): boolean => /(^|\/)cards\/[^/]+\/index\.html$/.test(path);

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
	const start = api.indexOf("\n## tab\n");
	if (start < 0) return api;
	const next = api.indexOf("\n## ", start + 1);
	const line = "\n## tab\n\nThe person's Chrome: nothing is shared now. `tab.status` says so, and `tab.pair` says how to pair.\n";
	return api.slice(0, start) + line + (next < 0 ? "" : api.slice(next));
}

export function deckContext(deck: DeckFacts): string {
	const template = agentsTemplate();
	if (!existsSync(template)) {
		// A missing template is a broken install, not a reason to refuse to run: the
		// agent still has the skills and the deck.
		return `You are working in a deck at ${deck.path}. Each canvas keeps its cards in canvases/<name>/cards/<card>/index.html. The decks command in your shell reaches the canvas: decks --help.`;
	}

	// The cards, then any old boards a canvas still holds, which show and can be read but get no new work.
	const line = (one: { path: string; title: string; w: number; h: number }) => `- \`${one.path}\` — ${one.title} (${one.w}×${one.h})`;
	const cards = deck.cards.filter((one) => isCardPath(one.path));
	const boards = deck.cards.filter((one) => !isCardPath(one.path));
	const cardList = [
		cards.length === 0 ? "_None yet. Write the first one._" : cards.map(line).join("\n"),
		...(boards.length ? ["", "Old boards, which show and can be read (new work is a card):", "", boards.map(line).join("\n")] : []),
	].join("\n");

	const rootList = "Embeds reach files inside the deck.";

	const reference = decksCommands();
	const api = existsSync(reference) ? readFileSync(reference, "utf8").replace(/^<!--[^\n]*-->\n+/, "") : "";

	return readFileSync(template, "utf8")
		.replaceAll("{{DECKS_COMMANDS}}", api ? apiFor(api, { web: deck.web === true }).trim() : "_The command reference is not in this install: `decks --help` lists the commands._")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", deck.path)
		.replaceAll("{{CARDS}}", cardList)
		.replaceAll("{{ROOTS}}", rootList)
		.replaceAll("{{TIME}}", timeLine());
}
