import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import type { Board } from "@decks/protocol";
import type { PenDocument } from "@decks/pen";
import { renderShell } from "../boards/shell.ts";
import { readMeta } from "../deck/meta.ts";
import type { ThumbScheme } from "../boards/thumbs.ts";
import { zip, type ZipEntry } from "./zip.ts";

/**
 * A canvas as one file: what a Decks with no server needs to draw it (`web/src/connections`).
 *
 * The zip holds three folders and a manifest:
 *
 * - `deck/` is files as they sit in the deck, at their deck paths: the stage's folder, the boards on
 *   it, every file those boards name by a relative path, and the whole of `lib/`, since a board's
 *   runtime and styles are there.
 * - `served/` is what the server *renders* rather than sends for a board: a `.md` or a foreign page
 *   wrapped in its shell (`boards/shell.ts`).
 * - `pictures/` is each board's whole picture in both schemes, so the canvas has something to draw
 *   for a board before its page is opened, which is what it always draws first.
 *
 * Nothing from the agents is in it: no transcript, no settings, no other stage. The manifest is
 * the greeting a server would have sent (`App.greet`), cut to the frames a reader needs.
 */
export const BUNDLE_VERSION = 1;

export interface BundleManifest {
	decks: typeof BUNDLE_VERSION;
	made: string;
	/** The deck it came from, by name: shown under the canvas's title in the switcher. */
	from: string;
	stage: { name: string; title: string; rev: number };
	/** The drawing with its imports resolved, and the folder its image fills are read against, deck-relative. */
	pen: { doc: PenDocument; base: string };
	/** Every board on the stage, placed where the stage has it. */
	boards: Board[];
	/** Board paths whose page is in `served/` rather than `deck/`. */
	served: string[];
	/** Board path → scheme → zip path of its picture. */
	pictures: Record<string, Partial<Record<ThumbScheme, string>>>;
}

export interface BundleSource {
	deckPath: string;
	deckName: string;
	board(path: string): Board | undefined;
	stage: {
		dir: string;
		title: string;
		rev: number;
		doc: PenDocument;
		boards: Array<{ path: string; x: number; y: number; w: number; h: number }>;
	};
	/** A picture of a board already on disk, or one taken within the time left; undefined when neither. */
	picture(board: Board, scheme: ThumbScheme): Promise<string | undefined>;
}

/** Larger files are left out: a bundle is for sending, and a video on a board can be fetched from where it lives. */
const MAX_FILE = 40 * 1024 * 1024;

/** A relative reference in markup or CSS: what an attribute or a `url()` names. */
const REFERENCE = /(?:\b(?:src|href|poster|data|data-embed|data-src)\s*=\s*["']([^"'<>]+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi;

function isRelative(ref: string): boolean {
	return !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\{|\$)/i.test(ref);
}

/** A reference, read against the file that made it, as a deck path; undefined when it leaves the deck. */
function resolveRef(fromFile: string, ref: string): string | undefined {
	const clean = ref.split(/[?#]/)[0] ?? "";
	if (!clean || !isRelative(clean)) return undefined;
	let decoded = clean;
	try {
		decoded = decodeURIComponent(clean);
	} catch {
		// A literal `%` in a name: keep it as written.
	}
	const joined = posix.normalize(posix.join(posix.dirname(fromFile), decoded));
	if (joined.startsWith("../") || joined === ".." || joined.startsWith("/")) return undefined;
	return joined;
}

/** Every deck path a text file names, by a relative path that exists. */
function referencesOf(deckPath: string, file: string, text: string): string[] {
	const out: string[] = [];
	for (const match of text.matchAll(REFERENCE)) {
		const ref = (match[1] ?? match[2] ?? "").trim();
		const target = resolveRef(file, ref);
		if (target && isFile(join(deckPath, target))) out.push(target);
	}
	return out;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function filesUnder(root: string, dir: string): string[] {
	const out: string[] = [];
	const walk = (folder: string) => {
		let names: string[];
		try {
			names = readdirSync(folder);
		} catch {
			return;
		}
		for (const name of names) {
			if (name.startsWith(".")) continue;
			const full = join(folder, name);
			const stat = statSync(full);
			if (stat.isDirectory()) walk(full);
			else if (stat.isFile()) out.push(relative(root, full).split(sep).join("/"));
		}
	};
	walk(join(root, dir));
	return out;
}

/** Every string under a `url` key in the drawing: an image fill, or a board's own `../../boards/x.html`. */
function penUrls(value: unknown, out: string[] = []): string[] {
	if (Array.isArray(value)) for (const one of value) penUrls(one, out);
	else if (value && typeof value === "object") {
		for (const [key, one] of Object.entries(value)) {
			if (key === "url" && typeof one === "string") out.push(one);
			else penUrls(one, out);
		}
	}
	return out;
}

const TEXTUAL = /\.(?:html?|css|svg|md|markdown)$/i;

export async function buildBundle(source: BundleSource): Promise<{ manifest: BundleManifest; bytes: Buffer }> {
	const { deckPath } = source;
	const stageRel = relative(deckPath, source.stage.dir).split(sep).join("/");
	const files = new Set<string>();
	const served: ZipEntry[] = [];
	const servedPaths: string[] = [];

	for (const file of filesUnder(deckPath, "lib")) files.add(file);
	for (const file of filesUnder(deckPath, stageRel)) files.add(file);
	for (const url of penUrls(source.stage.doc)) {
		const target = resolveRef(`${stageRel}/stage.pen`, url);
		if (target && !/\.x?html?$/i.test(target) && isFile(join(deckPath, target))) files.add(target);
	}

	const boards: Board[] = [];
	for (const spot of source.stage.boards) {
		const board = source.board(spot.path);
		if (!board) continue;
		// Who wrote it and who read it are this deck's, not the reader's: a file arrives read, so nothing in it glows as news.
		const { lastWrittenBy: _by, namedAt: _named, ...kept } = board;
		boards.push({ ...kept, seenAt: Date.now(), inContext: [], x: spot.x, y: spot.y, w: spot.w, h: spot.h });
	}
	const onStage = new Set(boards.map((board) => board.path));

	// Boards, and what they name, one level of CSS deep: a stylesheet's own `url()`s are fonts and pictures.
	const queue: string[] = [];
	for (const board of boards) {
		if (isFile(join(deckPath, board.path))) {
			files.add(board.path);
			queue.push(board.path);
		}
		if (board.shell) {
			let aspect: string | undefined;
			try {
				aspect = readMeta(board.path, readFileSync(join(deckPath, board.path), "utf8")).aspect;
			} catch {
				aspect = undefined;
			}
			const html = renderShell({ path: board.path, format: board.format, shell: board.shell, title: board.title, w: board.w, h: board.h, ...(aspect ? { aspect } : {}) });
			served.push({ name: `served/${board.path}`, data: Buffer.from(html, "utf8") });
			servedPaths.push(board.path);
		}
	}
	const scanned = new Set<string>();
	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (scanned.has(file) || !TEXTUAL.test(file)) continue;
		scanned.add(file);
		let text: string;
		try {
			text = readFileSync(join(deckPath, file), "utf8");
		} catch {
			continue;
		}
		for (const target of referencesOf(deckPath, file, text)) {
			// Another board is a link to open beside this one, not a part of it: only the canvas's own come along.
			if (/^(?:boards|stages\/[^/]+\/boards)\//.test(target) && /\.x?html?$/i.test(target) && !onStage.has(target)) continue;
			if (files.has(target)) continue;
			files.add(target);
			if (/\.css$/i.test(target) || /\.svg$/i.test(target)) queue.push(target);
		}
	}

	const pictures: BundleManifest["pictures"] = {};
	const pictureEntries: ZipEntry[] = [];
	for (const board of boards) {
		for (const scheme of ["light", "dark"] as const) {
			const file = await source.picture(board, scheme);
			if (!file || !isFile(file)) continue;
			const ext = file.endsWith(".webp") ? "webp" : "jpg";
			const name = `pictures/${scheme}/${board.path}.${ext}`;
			pictureEntries.push({ name, data: readFileSync(file) });
			(pictures[board.path] ??= {})[scheme] = name;
		}
	}

	const entries: ZipEntry[] = [];
	for (const file of [...files].sort()) {
		const full = join(deckPath, file);
		try {
			if (statSync(full).size > MAX_FILE) continue;
			entries.push({ name: `deck/${file}`, data: readFileSync(full) });
		} catch {
			// Gone between the scan and the read: a bundle is a moment, and it was not in it.
		}
	}

	const manifest: BundleManifest = {
		decks: BUNDLE_VERSION,
		made: new Date().toISOString(),
		from: source.deckName,
		stage: { name: posix.basename(stageRel), title: source.stage.title, rev: source.stage.rev },
		pen: { doc: source.stage.doc, base: `${stageRel}/` },
		boards,
		served: servedPaths,
		pictures,
	};
	const bytes = zip([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") }, ...entries, ...served, ...pictureEntries]);
	return { manifest, bytes };
}

/** A file name for the download: the canvas's title, with what a file system refuses taken out. */
export function bundleFileName(title: string): string {
	const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "canvas";
	return `${base}.decks`;
}

