import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canvasFolder } from "@decks/hub/layout";

/**
 * Where a deck's cards are: each canvas's own `cards/`, and each friend's canvas's.
 *
 * A card is the only kind of page there is. A deck from before cards may still hold a `cards/`
 * folder, or a canvas a `cards/` of its own: those are plain files now, read like any other file
 * of the deck, listed nowhere and watched by nobody.
 */

/** Every `cards/` folder in a deck that exists, deck-relative: each canvas's, then each friend's canvas's. */
export function cardFolders(deck: string): string[] {
	const folders: string[] = [];
	const visible = (entry: { isDirectory(): boolean; name: string }) => entry.isDirectory() && !entry.name.startsWith(".");
	const canvases = join(deck, "canvases");
	if (existsSync(canvases)) {
		for (const entry of readdirSync(canvases, { withFileTypes: true })) {
			if (visible(entry) && existsSync(join(canvases, entry.name, "cards"))) folders.push(`${canvasFolder(entry.name)}/cards`);
		}
	}
	const shared = join(deck, "shared", "canvases");
	if (!existsSync(shared)) return folders;
	for (const owner of readdirSync(shared, { withFileTypes: true })) {
		if (!visible(owner)) continue;
		for (const canvas of readdirSync(join(shared, owner.name), { withFileTypes: true })) {
			if (visible(canvas) && existsSync(join(shared, owner.name, canvas.name, "cards"))) folders.push(`shared/canvases/${owner.name}/${canvas.name}/cards`);
		}
	}
	return folders;
}
