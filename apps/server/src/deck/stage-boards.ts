import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canvasFolder } from "./layout.ts";

/**
 * Boards a canvas keeps for itself: `canvases/<name>/boards/`.
 *
 * A canvas keeps the boards it places in its own folder, so it stands alone (`deck/layout.ts`);
 * the deck's `boards/` is a library read and copied from. The deck lists these like any other board.
 */

/** The deck-relative folder a stage keeps its own boards in. */
export function stageBoardsDir(stage: string): string {
	return `${canvasFolder(stage)}/boards`;
}

/** True for a deck-relative path in any board folder: `boards/…`, `frames/…` or `canvases/<name>/boards/…`. */
export function inBoardFolder(path: string): boolean {
	return /^(?:boards|frames)\/.+/.test(path) || /^canvases\/[^/]+\/(?:boards|cards)\/.+/.test(path) || /^shared\/canvases\/[^/]+\/[^/]+\/(?:boards|cards)\/.+/.test(path);
}

/**
 * Every board folder in a deck, deck-relative: `boards`, `frames` when it is there (saved frames,
 * and any page kept beside them), then each stage's that exists.
 */
export function boardFolders(deck: string): string[] {
	const folders = ["boards"];
	if (existsSync(join(deck, "frames"))) folders.push("frames");
	const stages = join(deck, "canvases");
	if (existsSync(stages)) {
		for (const entry of readdirSync(stages, { withFileTypes: true })) {
			if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(stages, entry.name, "boards"))) folders.push(stageBoardsDir(entry.name));
			// A canvas's cards are boards drawn in the stage's own page (`isCardPath`), listed like its boards.
			if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(stages, entry.name, "cards"))) folders.push(`${canvasFolder(entry.name)}/cards`);
		}
	}
	// The canvases friends shared, each with its own boards (`deck/layout.ts`).
	const shared = join(deck, "shared", "canvases");
	if (!existsSync(shared)) return folders;
	for (const owner of readdirSync(shared, { withFileTypes: true })) {
		if (!owner.isDirectory() || owner.name.startsWith(".")) continue;
		for (const canvas of readdirSync(join(shared, owner.name), { withFileTypes: true })) {
			if (canvas.isDirectory() && !canvas.name.startsWith(".") && existsSync(join(shared, owner.name, canvas.name, "boards"))) folders.push(`shared/canvases/${owner.name}/${canvas.name}/boards`);
			if (canvas.isDirectory() && !canvas.name.startsWith(".") && existsSync(join(shared, owner.name, canvas.name, "cards"))) folders.push(`shared/canvases/${owner.name}/${canvas.name}/cards`);
		}
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
