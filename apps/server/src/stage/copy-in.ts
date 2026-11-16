import { constants, copyFileSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { canvasFolder, canvasOfPath, isCardPath, isHidden } from "@decks/hub/layout";

/**
 * What a canvas takes in when it is given something from elsewhere, so its folder still stands alone
 * (`deck/layout.ts`): a card from another canvas (its own or a friend's) is copied into its `cards/`,
 * a saved frame into its `frames/`, and a deck file its drawing fills with into its `files/`. The
 * copy is the canvas's from then on, and changes apart from the original.
 */

function clone(deck: string, from: string, to: string): void {
	if (existsSync(join(deck, to))) return;
	mkdirSync(dirname(join(deck, to)), { recursive: true });
	copyFileSync(join(deck, from), join(deck, to), constants.COPYFILE_FICLONE);
}

const isFile = (full: string): boolean => {
	try {
		return statSync(full).isFile();
	} catch {
		return false;
	}
};

/**
 * Copy the card at deck path `from` (`canvases/a/cards/sales/index.html`) into `canvas`'s `cards/`,
 * its whole folder (its scripts, styles and data are its own), under the same name or the next free
 * one (`sales-2`). Answers the copy's deck path, a card too. A card's runtime is `../../lib/`, served
 * inside every canvas, so it needs no rewriting; a link out of its folder into its old canvas's
 * `files/` is left as it is, and finds that name in this canvas's `files/` or nothing.
 */
export function copyCardInto(deck: string, from: string, canvas: string): string {
	if (!isCardPath(from) || !isFile(join(deck, from))) throw new Error(`There is no card ${from} to copy onto the canvas.`);
	const name = from.split("/").at(-2)!;
	const folder = canvasFolder(canvas);
	let to = `${folder}/cards/${name}`;
	for (let n = 2; existsSync(join(deck, to)); n++) {
		to = `${folder}/cards/${name}-${n}`;
		if (n > 500) throw new Error(`Too many copies of the card ${name} on ${canvas}.`);
	}
	mkdirSync(dirname(join(deck, to)), { recursive: true });
	cpSync(join(deck, posix.dirname(from)), join(deck, to), { recursive: true });
	return `${to}/index.html`;
}

/** Copy a saved frame (`frames/<name>`, from the deck's library) into the canvas, when it is not there yet. */
export function copyFrameInto(deck: string, ref: string, canvas: string): void {
	const target = `${canvasFolder(canvas)}/${ref}.pen`;
	if (existsSync(join(deck, target)) || !existsSync(join(deck, `${ref}.pen`))) return;
	clone(deck, `${ref}.pen`, target);
}

/**
 * Copy a deck file a canvas's drawing fills with into its `files/` (`assets/a.png` → `files/a.png`,
 * `exports/x.png` → `files/exports/x.png`), once; answers its path in the canvas's folder, or
 * undefined for a path that is no plain deck file (hidden, missing, another canvas's).
 */
export function copyFileInto(deck: string, deckPath: string, canvas: string): string | undefined {
	if (isHidden(deckPath) || canvasOfPath(deckPath) || /^(?:shared|lib)\//.test(deckPath) || !isFile(join(deck, deckPath))) return undefined;
	const inside = deckPath.startsWith("assets/") ? `files/${deckPath.slice("assets/".length)}` : `files/${deckPath}`;
	clone(deck, deckPath, `${canvasFolder(canvas)}/${inside}`);
	return inside;
}
