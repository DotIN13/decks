import { constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { canvasFolder, canvasOfPath, isCardPath, isHidden, isSharedCanvas, servedAs } from "../deck/layout.ts";
import { rewriteLinks } from "../migrations/2026-10-20-standalone-canvases.ts";

/**
 * A board placed on a canvas from somewhere else (another canvas, the library, a friend's canvas) is
 * copied into the canvas's own `boards/`, with what it is made of, so the canvas still stands alone
 * (`deck/layout.ts`). The copy is the canvas's from then on, and changes apart from the original.
 *
 * What comes along, by where each link of the board leads:
 * - a file in the canvas it came from (its `files/`, a stylesheet beside it in `boards/`), or in the
 *   copies a friend's canvas came with (`assets/`, `docs/`): copied to the same place in this one;
 * - a sibling file beside a library board that is not a board (a stylesheet, a script): beside the copy;
 * - the runtime (`lib/`), and this deck's own `assets/`, `docs/` and `apps/`: nothing, they are served
 *   beside every canvas's boards;
 * - another board: the link is pointed at where that board is, from the copy's place.
 */

/** A link in a board's text: in quotes, `url(…)` or a markdown link, with a file extension. */
const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -￿][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;
const BOARD_FILE = /\.(?:x?html?|mdx?)$/i;

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

/** Where in the board folder a board sits: `boards/x/a.html` → `x/a.html`, `canvases/n/boards/a.html` → `a.html`. */
function insideBoards(path: string): string {
	const at = canvasOfPath(path);
	const rest = at ? at.rest : path;
	return rest.replace(/^boards\//, "");
}

/**
 * Copy the board at deck path `from` into `canvas`'s `boards/`, under the same name or the next free
 * one (`-2`), with what it uses. Answers the copy's deck path.
 */
export function copyBoardInto(deck: string, from: string, canvas: string): string {
	const source = join(deck, from);
	if (!isFile(source)) throw new Error(`There is no board ${from} to copy onto the canvas.`);
	if (isCardPath(from)) return copyCardInto(deck, from, canvas);
	const folder = canvasFolder(canvas);
	const inside = insideBoards(from);
	let to = `${folder}/boards/${inside}`;
	for (let n = 2; existsSync(join(deck, to)); n++) {
		to = `${folder}/boards/${inside.replace(/(\.[^./]+)?$/, (ext) => `-${n}${ext ?? ""}`)}`;
		if (n > 500) throw new Error(`Too many copies of ${inside} on ${canvas}.`);
	}
	const fromDir = posix.dirname(from);
	const toDir = posix.dirname(to);
	const origin = canvasOfPath(from);
	const text = readFileSync(source, "utf8");
	const links: Array<{ from: string; to: string }> = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(LINK)) {
		const link = match[2]!;
		if (seen.has(link)) continue;
		seen.add(link);
		const asked = posix.normalize(posix.join(fromDir, link));
		if (asked.startsWith("..") || isHidden(asked)) continue;
		const served = servedAs(asked);
		if (!("path" in served) || !isFile(join(deck, served.path))) continue;
		const real = served.path;
		let place: string | undefined;
		if (origin && real.startsWith(`${origin.folder}/`)) {
			// Its own canvas's file, or a copy its friend's canvas came with: the same place here.
			const rest = real.slice(origin.folder.length + 1);
			if (rest.startsWith("boards/") && BOARD_FILE.test(rest)) place = real;
			else {
				// A friend's copies of their assets/ and docs/ go in files/ here: this deck's own are served at assets/ and docs/.
				const kept = /^(?:assets|docs)\//.test(rest) && !isSharedCanvas(canvas) ? `files/${rest.replace(/^assets\//, "")}` : rest;
				place = `${folder}/${kept}`;
				clone(deck, real, place);
			}
		} else if (real.startsWith("boards/") && !BOARD_FILE.test(real)) {
			// A stylesheet or script beside a library board: beside the copy too.
			place = `${folder}/${real}`;
			clone(deck, real, place);
		} else if (/^(?:lib|assets|docs|apps)\//.test(real)) {
			place = `${folder}/${real}`;
		} else place = real;
		let next = posix.relative(toDir, place);
		if (link.startsWith("./") && !next.startsWith(".")) next = `./${next}`;
		if (next !== link) links.push({ from: link, to: next });
	}
	mkdirSync(dirname(join(deck, to)), { recursive: true });
	writeFileSync(join(deck, to), links.length ? rewriteLinks(text, links) : text);
	return to;
}

/**
 * Copy the card at deck path `from` (`canvases/a/cards/sales/index.html`) into `canvas`'s `cards/`,
 * its whole folder (its scripts, styles and data are its own), under the same name or the next free
 * one (`sales-2`). Answers the copy's deck path, a card too. A card's runtime is `../../lib/`, served
 * inside every canvas, so it needs no rewriting; a link out of its folder into its old canvas's
 * `files/` is left as it is, and finds that name in this canvas's `files/` or nothing.
 */
function copyCardInto(deck: string, from: string, canvas: string): string {
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
