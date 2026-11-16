import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { emptyDocument, parse, serialize, type PenDocument } from "@decks/pen";
import { canvasFolder, isSharedCanvas } from "@decks/hub/layout";
import { rewriteLinks } from "./links.ts";
import { CANVAS_FILE, CANVAS_META } from "./canvas-files.ts";
import type { CanvasPens } from "./pens.ts";

/**
 * Your own copy of a canvas a friend shared with you (`shared/canvases/<owner>/<canvas>/`), made in a
 * new `canvases/<name>/` of this deck: the way a canvas shared with you to view is changed, and a way
 * for an editor to take one apart from theirs.
 *
 * The copy stands alone as every canvas does (`deck/layout.ts`):
 * - its `cards/`, `frames/` and `files/` come as they are;
 * - the owner's deck files that came with the share (`assets/…`, `docs/…`, mirrored in its folder)
 *   go into the copy's `files/` (`assets/a.png` → `files/a.png`, `docs/n.md` → `files/docs/n.md`),
 *   since in a canvas of yours `assets/` would be this deck's own, and every link to one, in a card
 *   or in the drawing, is pointed at its new place;
 * - an app (`decks.app`) stays the item it is: the app is the owner's and runs on their harness, so
 *   in the copy it shows as an app this deck does not have.
 *
 * It is titled "Copy of …", says what it was copied from (`canvas.json`'s `madeFrom`), and has no
 * Studio canvas yet: the sync takes it up as a new canvas of yours (`studio/sync.ts`), and it never
 * goes back to the owner.
 */

/** A link in a card's text: in quotes, `url(…)` or a markdown link, with a file extension. */
const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -￿][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;
/** Files whose links are read and re-pointed. */
const TEXT = /\.(?:x?html?|mdx?|css|svg|js|mjs|json|txt)$/i;
const COPIED = ["cards", "frames", "files"];
const MIRRORED = ["assets", "docs"];

/** Every plain file under `dir`, as paths relative to it; hidden files and symbolic links are left behind. */
function filesUnder(dir: string, at = ""): string[] {
	const out: string[] = [];
	let entries;
	try {
		entries = readdirSync(join(dir, at), { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const rel = at ? `${at}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
		else if (entry.isFile()) out.push(rel);
	}
	return out;
}

/** Where each file of the friend's folder lands in the copy, by its path in the folder. */
export function copyPlan(files: readonly string[]): Map<string, string> {
	const plan = new Map<string, string>();
	const taken = new Set<string>();
	// The canvas's own parts first, so a mirrored deck file never takes the place of one of them.
	for (const rel of files) {
		if (!COPIED.includes(rel.split("/")[0]!) || !rel.includes("/")) continue;
		plan.set(rel, rel);
		taken.add(rel);
	}
	for (const rel of files) {
		const [top, ...rest] = rel.split("/");
		if (!MIRRORED.includes(top!) || !rest.length) continue;
		const first = top === "assets" ? `files/${rest.join("/")}` : `files/${rel}`;
		let place = taken.has(first) ? `files/${rel}` : first;
		for (let n = 2; taken.has(place); n++) place = `files/${rel}`.replace(/(\.[^./]+)?$/, (ext) => `-${n}${ext ?? ""}`);
		plan.set(rel, place);
		taken.add(place);
	}
	return plan;
}

/** A file's text with each link to a file that moved pointed at its new place, from where the file itself now is. */
export function relinked(text: string, from: string, to: string, plan: ReadonlyMap<string, string>): string {
	const links: Array<{ from: string; to: string }> = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(LINK)) {
		const link = match[2]!;
		if (seen.has(link)) continue;
		seen.add(link);
		const asked = posix.normalize(posix.join(posix.dirname(from), link));
		if (asked.startsWith("..")) continue;
		const now = plan.get(asked);
		if (!now || (now === asked && posix.dirname(from) === posix.dirname(to))) continue;
		let next = posix.relative(posix.dirname(to), now);
		if (link.startsWith("./") && !next.startsWith(".")) next = `./${next}`;
		if (next !== link) links.push({ from: link, to: next });
	}
	return links.length ? rewriteLinks(text, links) : text;
}

/** Every string in a drawing that names a file of the folder that moved, pointed at its new place. */
export function relinkDrawing(value: unknown, plan: ReadonlyMap<string, string>): unknown {
	if (typeof value === "string") {
		if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return value;
		const asked = posix.normalize(value.replace(/^\.\//, ""));
		const now = plan.get(asked);
		return now && now !== asked ? now : value;
	}
	if (Array.isArray(value)) return value.map((one) => relinkDrawing(one, plan));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, relinkDrawing(inner, plan)]));
	return value;
}

/**
 * Copy the friend's canvas `from` into a new canvas of this deck, titled `title` or "Copy of …".
 * Answers the new canvas's name (its folder under canvases/).
 */
export function copySharedCanvas(deck: string, pens: CanvasPens, from: string, title?: string): string {
	if (!isSharedCanvas(from)) throw new Error(`${from} is not a canvas shared with you: a friend's canvas is named shared/<owner>/<canvas> (decks canvas list says which).`);
	if (!pens.has(from)) throw new Error(`There is no shared canvas ${from}: decks canvas list names them.`);
	const sharing = pens.rights.sharing(from);
	const owner = sharing?.ownerName || sharing?.owner || "its owner";
	const source = join(deck, canvasFolder(from));
	const wanted = (typeof title === "string" && title.trim()) || `Copy of ${pens.titleOf(from)}`;
	const name = pens.claim(wanted);
	const target = join(deck, canvasFolder(name));
	const files = filesUnder(source).filter((rel) => rel !== CANVAS_FILE && rel !== CANVAS_META);
	const plan = copyPlan(files);
	for (const [rel, to] of plan) {
		const full = join(source, rel);
		if (lstatSync(full).isSymbolicLink()) continue;
		const out = join(target, to);
		mkdirSync(dirname(out), { recursive: true });
		if (!TEXT.test(rel)) {
			copyFileSync(full, out, constants.COPYFILE_FICLONE);
			continue;
		}
		const text = readFileSync(full, "utf8");
		writeFileSync(out, relinked(text, rel, to, plan));
	}
	// The drawing, every file it names pointed at its place in the copy.
	try {
		const doc = parse(readFileSync(join(source, CANVAS_FILE), "utf8"));
		writeFileSync(join(target, CANVAS_FILE), serialize(relinkDrawing(doc, plan) as PenDocument));
	} catch {
		// A shared canvas with no drawing that reads yet: the copy starts empty, and still syncs as a canvas.
		writeFileSync(join(target, CANVAS_FILE), serialize(emptyDocument()));
	}
	// What it is called and where it came from; nothing of the share (`shared`, `studio`) comes along.
	let meta: Record<string, unknown> = {};
	try {
		meta = JSON.parse(readFileSync(join(target, CANVAS_META), "utf8")) as Record<string, unknown>;
	} catch {
		/* claim wrote none */
	}
	writeFileSync(join(target, CANVAS_META), `${JSON.stringify({ ...meta, title: pens.titleOf(name), madeFrom: { canvas: from, owner, ...(sharing?.studio ? { studio: sharing.studio } : {}), at: new Date().toISOString() } }, null, "\t")}\n`);
	return name;
}
