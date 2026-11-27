import { existsSync, readFileSync } from "node:fs";
import { guidelinesFile } from "@decks/runtime";

/** What an agent is told when `runtime/guidelines.txt` is missing: the one rule the rest hang from. */
const BUILT_IN_GUIDELINES = [
	"Answer on the canvas: draw designs, maps and diagrams with decks canvas batch (the canvas-design skill); write an HTML card for demos and interactive mockups (decks card create, write/edit, decks canvas insert, decks canvas fit); build an app for a reusable tool. decks view focus shows it.",
];

/**
 * The guidelines an agent is given: `runtime/guidelines.txt` when there is one, a line each,
 * and the list above when there is not. A file for the reason the description is one: the
 * words can then be changed, and tried in variants, without touching this module.
 */
function read(): string[] {
	const file = guidelinesFile();
	if (!existsSync(file)) return BUILT_IN_GUIDELINES;
	return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}
/** Read once, at start-up: every agent's briefing says the same lines (`agents/context.ts`). */
export const GUIDELINES: readonly string[] = read();
