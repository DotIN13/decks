import { processZone } from "../lib/clock.ts";
import { existsSync, readFileSync } from "node:fs";
import { agentsTemplate, decksCommands } from "@decks/runtime";
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
export function timeLine(): string {
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
	const start = api.indexOf("<!-- web -->");
	const end = api.indexOf("<!-- /web -->");
	if (start < 0 || end < 0) return api;
	const kept = options.web
		? api.slice(0, start) + api.slice(start + "<!-- web -->".length, end) + api.slice(end + "<!-- /web -->".length)
		: api.slice(0, start) +
			"**The person's Chrome**: nothing is shared now. `decks web status` says so, and `decks web pairing` says how to pair.\n" +
			api.slice(end + "<!-- /web -->".length);
	return kept.replace(/\n{3,}/g, "\n\n");
}

/**
 * What an isolated agent is told instead of the deck: the folder it runs in, and only the boards
 * on its stage (`agents/isolation.ts`). Everything else in the briefing is the same.
 */
export interface IsolatedBriefing {
	dir: string;
	data: string;
	boards: readonly string[];
}

/**
 * The isolation instructions, the one place their words live: the briefing carries them, a
 * switch mid-chat sends them, and opencode (whose briefing is shared) sends them with each turn.
 */
export function isolationNote(isolated: { dir: string; data: string }, boards: readonly string[]): string {
	const list = boards.length ? boards.map((path) => `\`${path}\``).join(", ") : "none yet";
	return [
		`**Isolated mode is on.** You are working in \`${isolated.dir}\`, a temporary folder holding only your stage: ${list}.`,
		"Your stage's boards are its own copies now, in its `canvases/<name>/boards/` folder; the paths above are those copies, at the same paths in your folder. Read and edit them there, and your edits reach the canvas. A board you make with `decks board create` and place on your canvas, or a new file you write in that folder, joins your stage.",
		`Do not read, list, search or change the Decks data in \`${isolated.data}\` (the original boards, other stages, other agents' files), with your file tools or your shell. Work only with what is in your folder.`,
	].join(" ");
}

export function deckContext(deck: Deck, options: { web?: boolean; isolated?: IsolatedBriefing } = {}): string {
	const template = agentsTemplate();
	if (!existsSync(template)) {
		// A missing template is a broken install, not a reason to refuse to run: the
		// agent still has the skills and the deck.
		return `You are working in a deck at ${deck.path}. Boards are HTML files under boards/. The decks command in your shell reaches the canvas: decks --help.`;
	}

	const isolated = options.isolated;
	const boards = isolated ? deck.boards.filter((board) => isolated.boards.includes(board.path)) : deck.boards;
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

	const reference = decksCommands();
	const api = existsSync(reference) ? readFileSync(reference, "utf8").replace(/^<!--[^\n]*-->\n+/, "") : "";

	return readFileSync(template, "utf8")
		.replaceAll("{{DECKS_COMMANDS}}", api ? apiFor(api, { web: options.web === true }).trim() : "_The command reference is not in this install: `decks --help` lists the commands._")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", isolated ? isolated.dir : deck.path)
		.replaceAll("{{BOARDS}}", isolated ? `${boardList}\n\n${isolationNote(isolated, isolated.boards)}` : boardList)
		.replaceAll("{{ROOTS}}", rootList)
		.replaceAll("{{TIME}}", timeLine());
}

/** The briefing options a backend passes, from its context: isolation included when it is on. */
export function briefingFor(context: { isolation?: { dir: string; data: string }; stageAgent: { inPlay(): readonly string[] }; tool: { webShared(): boolean } }): { web: boolean; isolated?: IsolatedBriefing } {
	return {
		web: context.tool.webShared(),
		...(context.isolation ? { isolated: { dir: context.isolation.dir, data: context.isolation.data, boards: context.stageAgent.inPlay() } } : {}),
	};
}
