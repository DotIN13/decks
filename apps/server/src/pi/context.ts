import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Deck } from "../deck/loader.ts";

/**
 * What the agent is told about the deck, once, as a context file.
 *
 * Pi injects it with the rest of the AGENTS.md discovery and owns it from there —
 * it is not re-sent per turn and must not pretend to be live. So it holds the
 * things that do not change under the agent's feet (what a board is, how to write
 * one, which roots exist) and points at `list`-style facts rather than embedding a
 * snapshot that will be wrong by the third turn.
 *
 * The board list is the one exception, and it is worth it: an agent that opens a
 * deck already knowing there are three boards called plan, risks and sources asks
 * a better first question.
 */
const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", "runtime");

export function runtimeDir(): string {
	return RUNTIME;
}

/**
 * Where Decks itself is installed — the directory `node_modules` sits in.
 *
 * The agent runs with the *deck* as its cwd, and a deck is not inside the install
 * (`~/.decks/decks` by default). So a helper script the agent writes cannot resolve
 * `playwright` — or anything else Decks depends on — by walking up from where it
 * runs, and the `board-debug` skill needs to. Exported as `DECKS_APP_DIR` so a
 * script can anchor `createRequire` here instead of guessing.
 */
export function installDir(): string {
	return resolve(RUNTIME, "..");
}

export function skillsDir(): string {
	return resolve(RUNTIME, "skills");
}

export function deckContext(deck: Deck): string {
	const template = resolve(RUNTIME, "AGENTS.md.tmpl");
	if (!existsSync(template)) {
		// A missing template is a broken install, not a reason to refuse to run: the
		// agent still has the skills and the deck.
		return `You are working in a deck at ${deck.path}. Boards are HTML files under boards/.`;
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

	const stageApi = resolve(RUNTIME, "stage.d.ts");
	const api = existsSync(stageApi) ? readFileSync(stageApi, "utf8") : "";

	return readFileSync(template, "utf8")
		.replaceAll("{{STAGE_API}}", api ? ["```ts", api.trim(), "```"].join("\n") : "_The stage API is not available in this install._")
		.replaceAll("{{DECK_NAME}}", deck.name)
		.replaceAll("{{DECK_PATH}}", deck.path)
		.replaceAll("{{BOARDS}}", boardList)
		.replaceAll("{{ROOTS}}", rootList);
}
