import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { clipItems, clone, isArrow, pastedItems, walk, type PenDocument, type PenNode } from "@decks/pen";
import { copyBoardInto } from "../boards/copy-in.ts";
import { canvasFolder, canvasOfPath, isCardPath, isHidden, isSharedCanvas } from "../deck/layout.ts";

/**
 * Copy and paste of items between the canvases of one harness (`canvas.clip`, `canvas.paste`).
 *
 * A copy is held here, read off the drawing it was made on, not taken from whoever pastes it: the
 * clipboard's clip only names it (its `id`) and the canvas it came from. So a card's script that
 * writes a clip of its own names no file and no item it could not already reach: what a paste puts
 * in is what the person copied, as the drawing had it.
 *
 * A paste copies what the items need from the canvas they were copied on into the one they land on:
 * a card's folder (`cards/<name>-2/` when the name is taken there), a board in that canvas's folder,
 * a picture or a document in its folder (an identical file already there is used as it is). Every
 * path is held inside the source canvas's folder: one that climbs out, names another canvas or is
 * absolute refuses the paste. A deck file outside any canvas (`assets/…`) is left as it is named,
 * since the deck serves it beside every canvas of its own. Undo takes the items back; the files
 * copied stay, unused, so a redo has them.
 */

/** How long a copy is held, and how many at most. */
const HELD_MS = 24 * 60 * 60 * 1000;
const HELD_MAX = 64;

interface Held {
	canvas: string;
	items: PenNode[];
	box: { x: number; y: number; w: number; h: number };
	at: number;
}

const held = new Map<string, Held>();

function forget(now: number): void {
	for (const [id, one] of held) if (now - one.at > HELD_MS) held.delete(id);
	while (held.size > HELD_MAX) held.delete(held.keys().next().value!);
}

/** Hold a copy of the items `ids` names on `canvas`, as `doc` has them, under `id`. */
export function holdClip(id: unknown, canvas: string, doc: PenDocument, ids: readonly string[], placed: Parameters<typeof clipItems>[2]): { id: string; canvas: string; box: Held["box"]; items: number } {
	if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(id)) throw new Error("A copy's id is a fresh random one, 16 to 80 letters, digits, - or _.");
	if (held.has(id)) throw new Error("That copy's id is taken: make a fresh one.");
	if (!Array.isArray(ids) || ids.length === 0) throw new Error("Say which items to copy: their ids, from decks canvas read.");
	const taken = clipItems(doc, ids, placed);
	if (!taken) throw new Error(`Nothing on ${canvas} is ${ids.join(", ")}.`);
	const now = Date.now();
	forget(now);
	held.set(id, { canvas, items: taken.items, box: taken.box, at: now });
	return { id, canvas, box: taken.box, items: taken.items.length };
}

/** A copy held under `id`, or a sentence saying it is not. */
export function heldClip(id: unknown): Held {
	const one = typeof id === "string" ? held.get(id) : undefined;
	if (!one || Date.now() - one.at > HELD_MS) throw new Error("The harness no longer holds that copy (it was started again since, or the copy is a day old): copy the items again.");
	return one;
}

/** Forget every copy held: for the checks. */
export function forgetClips(): void {
	held.clear();
}

const PAGE_TAGS = new Set(["decks.card", "decks.board", "decks.document", "decks.app"]);
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const isFile = (file: string) => {
	try {
		return statSync(file).isFile();
	} catch {
		return false;
	}
};

/** A deck path's next free name, `a.png` → `a-2.png`, `cards/sales` → `cards/sales-2`, past `busy` too. */
function freeName(deck: string, path: string, busy: Set<string>, same?: (existing: string) => boolean): { path: string; reused: boolean } {
	for (let n = 1; n < 1000; n++) {
		const next = n === 1 ? path : path.replace(/(\.[^./]+)?$/, (ext) => `-${n}${ext ?? ""}`);
		if (busy.has(next)) continue;
		if (!existsSync(join(deck, next))) return { path: next, reused: false };
		if (same?.(next)) return { path: next, reused: true };
	}
	throw new Error(`Too many copies of ${path}.`);
}

/** Every plain file in a folder, as paths inside it; hidden ones and links are left out. */
function filesIn(dir: string, at = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const rel = at ? `${at}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...filesIn(dir, rel));
		else if (entry.isFile() && !lstatSync(join(dir, rel)).isSymbolicLink()) out.push(rel);
	}
	return out;
}

export interface PasteDeps {
	deck: string;
	/** Write a card's or a board's page, recorded and announced as any write of one is. */
	writePage(path: string, html: string): void;
	/** The pages placed on the target canvas now, by deck path. */
	placedPages(canvas: string): Set<string>;
}

/**
 * The items of a held copy as they land on `target`, their files copied there first: what goes in as
 * one edit, and what was said about it. Nothing is copied unless every path is in order.
 */
export function pasteItems(deps: PasteDeps, copy: Held, target: string, taken: Set<string>, at: { x: number; y: number } | undefined): { items: PenNode[]; notes: string[] } {
	const { deck } = deps;
	const source = copy.canvas;
	const from = canvasFolder(source);
	const to = canvasFolder(target);
	const same = source === target;
	const items = copy.items.map((item) => clone(item));
	const notes: string[] = [];
	/** Each copy to make, source deck path to target deck path; a folder's ends in `/`. */
	const plan = new Map<string, string>();
	/** Each page's new path, by its old one: what the items and arrows are pointed at. */
	const paths = new Map<string, string>();
	const busy = new Set<string>();
	const onTarget = deps.placedPages(target);

	/** A deck path held inside the source canvas's folder; undefined for a deck file outside every canvas; refused otherwise. */
	const inSource = (path: string, what: string): string | undefined => {
		if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(path) || path.includes("\0")) throw new Error(`${what} names ${path}, which is outside the deck: nothing was pasted.`);
		const clean = posix.normalize(path);
		if (clean.startsWith("../") || clean === ".." || isHidden(clean)) throw new Error(`${what} names ${path}, which climbs out of the deck: nothing was pasted.`);
		if (clean.startsWith(`${from}/`)) return clean;
		if (canvasOfPath(clean)) throw new Error(`${what} names ${path}, on another canvas than the one it was copied from: nothing was pasted.`);
		return undefined;
	};
	/** Where a file of the source canvas goes on the target: the same place in its folder, or the next free name, or an identical one there. */
	const fileTo = (path: string): string => {
		const known = plan.get(path);
		if (known) return known;
		if (!isFile(join(deck, path))) throw new Error(`${path} is not there any more to copy: nothing was pasted.`);
		const wanted = `${to}/${path.slice(from.length + 1)}`;
		const hash = sha(join(deck, path));
		const place = freeName(deck, wanted, busy, (existing) => isFile(join(deck, existing)) && sha(join(deck, existing)) === hash);
		busy.add(place.path);
		plan.set(path, place.reused ? `=${place.path}` : place.path);
		return place.reused ? `=${place.path}` : place.path;
	};
	const placeOf = (planned: string) => planned.replace(/^=/, "");
	/** A drawing's address (relative to the canvas's folder) of a file of the source canvas, as the target names its copy. */
	const urlOn = (url: string, what: string): string => {
		if (same || /^(?:https?|data|blob):/i.test(url) || url.startsWith("#")) return url;
		const path = inSource(posix.join(from, url.split(/[?#]/)[0]!), what);
		if (!path) return url;
		const placed = placeOf(fileTo(path));
		const rel = posix.relative(to, placed);
		return url.startsWith("./") ? `./${rel}` : rel;
	};
	/** A deck path an item names (a film's file, a file piece's path), as the target names its copy. */
	const deckPathOn = (path: string, what: string): string => {
		if (same) return path;
		const inside = inSource(path, what);
		return inside ? placeOf(fileTo(inside)) : path;
	};

	const dropped = new Set<PenNode>();
	for (const node of walk(items)) {
		const meta = (node.metadata ?? {}) as Record<string, unknown>;
		const what = `${typeof node.name === "string" && node.name ? `"${node.name}"` : node.id} (${String(meta.type ?? node.type)})`;
		if (node.type === "browser" && PAGE_TAGS.has(String(meta.type)) && typeof meta.path === "string") {
			const path = meta.path;
			if (meta.type === "decks.card") {
				const inside = inSource(path, what);
				if (!inside || !isCardPath(inside)) throw new Error(`${what} is a card outside the canvas it was copied from (${path}): nothing was pasted.`);
				// A card is placed once on a canvas: on its own canvas too, a copy is a card of its own.
				const folder = posix.dirname(inside);
				if (!existsSync(join(deck, folder))) throw new Error(`${path} is not there any more to copy: nothing was pasted.`);
				const place = freeName(deck, `${to}/cards/${posix.basename(folder)}`, busy);
				busy.add(place.path);
				plan.set(`${folder}/`, `${place.path}/`);
				paths.set(path, `${place.path}/index.html`);
				if (isSharedCanvas(source) && !isSharedCanvas(target)) node.metadata = { ...meta, scripts: false, from: source } as unknown as PenNode["metadata"];
			} else if (meta.type === "decks.board") {
				const inside = inSource(path, what);
				if (inside && (!same || onTarget.has(inside))) {
					plan.set(inside, `>board`);
					paths.set(path, inside);
				} else if (onTarget.has(path)) {
					notes.push(`${what} is on this canvas already, and a canvas holds a board once: it was left out.`);
					dropped.add(node);
				}
			} else if (meta.type === "decks.document") {
				// A document in the canvas's folder comes along; one elsewhere in the deck is named as it is.
				if (!same) {
					const inside = inSource(path, what);
					if (inside) paths.set(path, placeOf(fileTo(inside)));
				}
			}
			continue;
		}
		// What a drawn item names: a fill's picture (from the canvas's folder), a film's file and still, a file piece's path (deck paths).
		const visit = (value: unknown): void => {
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === "object") {
				const record = value as Record<string, unknown>;
				for (const [key, inner] of Object.entries(record)) {
					if (key === "children" || key === "metadata") continue;
					if (key === "url" && typeof inner === "string") record[key] = urlOn(inner, what);
					else if (inner && typeof inner === "object") visit(inner);
				}
			}
		};
		visit(node);
		if (node.metadata && !isArrow(node)) {
			const next = { ...meta };
			for (const key of ["path", "file", "poster"]) {
				const value = next[key];
				if (typeof value === "string" && value.includes("/")) next[key] = deckPathOn(value, what);
			}
			node.metadata = next as PenNode["metadata"];
		}
	}

	// Every path is in order: copy what the items need, then point them at it.
	for (const [path, place] of plan) {
		if (place.startsWith("=")) continue;
		if (place === ">board") {
			const copied = copyBoardInto(deck, path, target);
			deps.writePage(copied, readFileSync(join(deck, copied), "utf8"));
			paths.set(path, copied);
			continue;
		}
		if (path.endsWith("/")) {
			const files = filesIn(join(deck, path));
			for (const rel of files) {
				if (rel === "index.html") continue;
				mkdirSync(dirname(join(deck, place, rel)), { recursive: true });
				copyFileSync(join(deck, path, rel), join(deck, place, rel), constants.COPYFILE_FICLONE);
			}
			deps.writePage(`${place}index.html`, readFileSync(join(deck, path, "index.html"), "utf8"));
			continue;
		}
		mkdirSync(dirname(join(deck, place)), { recursive: true });
		copyFileSync(join(deck, path), join(deck, place), constants.COPYFILE_FICLONE);
	}
	for (const node of walk(items)) {
		const meta = node.metadata as Record<string, unknown> | undefined;
		if (node.type === "browser" && meta && typeof meta.path === "string" && paths.has(meta.path)) {
			const next = paths.get(meta.path)!;
			node.metadata = { ...meta, path: next } as unknown as PenNode["metadata"];
			node.url = `../../${next}`;
		}
	}

	const kept = items.filter((item) => !dropped.has(item));
	const dx = at ? Math.round(at.x - copy.box.x) : same ? 24 : 0;
	const dy = at ? Math.round(at.y - copy.box.y) : same ? 24 : 0;
	const pasted = pastedItems(kept, taken, { dx, dy, paths });
	return { items: pasted.items, notes };
}
