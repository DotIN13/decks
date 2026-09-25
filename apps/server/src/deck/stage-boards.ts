import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Boards a stage keeps for itself: `stages/<name>/boards/`.
 *
 * A board normally lives in the deck's `boards/`. When an agent is isolated
 * (`agents/isolation.ts`) its stage's boards are copied into the stage's own folder and the stage
 * points at the copies, so the agent's work never touches the originals and stays with the stage
 * afterwards. The deck lists these like any other board.
 */

/** The deck-relative folder a stage keeps its own boards in. */
export function stageBoardsDir(stage: string): string {
	return `stages/${stage}/boards`;
}

/** True for a deck-relative path in any board folder: `boards/…` or `stages/<name>/boards/…`. */
export function inBoardFolder(path: string): boolean {
	return /^boards\/.+/.test(path) || /^stages\/[^/]+\/boards\/.+/.test(path);
}

/** Every board folder in a deck, deck-relative: `boards`, then each stage's that exists. */
export function boardFolders(deck: string): string[] {
	const folders = ["boards"];
	const stages = join(deck, "stages");
	if (!existsSync(stages)) return folders;
	for (const entry of readdirSync(stages, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(stages, entry.name, "boards"))) folders.push(stageBoardsDir(entry.name));
	}
	return folders;
}

const depth = (folder: string) => folder.split("/").filter(Boolean).length;

/**
 * A board's text with its relative links re-pointed for a move between folders of different
 * depth: `../lib/board.css` from `boards/` is `../../../lib/board.css` from a stage's `boards/`.
 * Every quoted or `url(` value that starts with `../` is shifted, which covers the stylesheet,
 * `board.js`, the import map, assets and embeds; a link to a sibling board has no `../` and is
 * left alone.
 */
export function relink(text: string, fromFolder: string, toFolder: string): string {
	const extra = depth(toFolder) - depth(fromFolder);
	if (extra === 0) return text;
	if (extra > 0) return text.replace(/(["'(])((?:\.\.\/)+)/g, (_all, lead: string, ups: string) => `${lead}${"../".repeat(extra)}${ups}`);
	return text.replace(/(["'(])((?:\.\.\/)+)/g, (_all, lead: string, ups: string) => `${lead}${ups.slice(Math.min(ups.length - 3, -extra * 3))}`);
}
