import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { revisionOf } from "../deck/loader.ts";
import { pictureOf, thumbName } from "../pictures/ladder.ts";
import { boardIsItem } from "./2026-10-29-documents-and-apps.ts";
import { boardToCard, fileBoardSource, liveKind, measuredHeight } from "./2026-10-29-boards-to-cards.ts";

/**
 * 2026-10-30: the last boards on the deck's own canvases go.
 *
 * The boards-to-cards and documents-and-apps migrations left some boards behind on purpose, or missed
 * them (a board inside a frame, a board in a folder of `boards/`). This takes every one that is left on
 * the deck's own canvases (`canvases/<name>/canvas.pen`; a friend's, in `shared/canvases/`, is theirs
 * and is never touched), each by what its page is:
 *
 * - **one file edge to edge** (`data-embed` with `data-bare`, the old `newFileBoard`): a file card, the
 *   item a file dropped on the canvas makes (`packages/canvas/src/model/card-frame.ts`, `fileCard`),
 *   keeping the item's id and place, at a file card's width; a PDF's first page is drawn for its picture
 *   when poppler is there, as the server's `files/preview.ts` would, under the same name;
 * - **the shared Chrome tab** (`data-live="web"`, `your-chrome.html`): the item is removed;
 * - **one document or one app** that documents-and-apps did not reach (inside a frame): that item;
 * - **a board's page** (a `.board` body, taken for a document or an app before because it wrote
 *   `data-live` in its words): a card, by the boards-to-cards converter;
 * - **anything else** (its own `<iframe>`, no `.board` body, the agents list, a file from the web): a
 *   card that shows the board's last picture, copied into the card's folder, with a link to the old
 *   page, which is kept for it.
 *
 * Then every board file in a canvas's `boards/` that no item names any more is deleted (the document
 * and app boards documents-and-apps left, boards copied in and never placed), unless a card links to
 * it. The library in the deck's `boards/`, on no canvas, is left as it is: placing one of its boards on
 * a canvas makes a card of it (`stage/copy-in.ts`).
 *
 * Everything it changes or deletes is zipped first into `.decks/backups/`, and what it did, with every
 * board it could not convert and why, is written beside the zip as a report and in
 * `.decks/migrations.json`. It runs once, at start (`migrations/index.ts`).
 */
export const MIGRATION = "2026-10-30-board-leftovers";

interface Node {
	id?: unknown;
	type?: unknown;
	name?: unknown;
	url?: unknown;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	height?: unknown;
	metadata?: { type?: unknown; path?: unknown; [key: string]: unknown };
	children?: unknown;
	[key: string]: unknown;
}

type Becomes =
	| { kind: "file"; file: string; preview?: { path: string; w: number; h: number; pages?: number } }
	| { kind: "removed"; why: string }
	| { kind: "document"; path: string }
	| { kind: "app"; name: string }
	| { kind: "card"; card: string }
	| { kind: "picture"; card: string; picture?: string; why: string }
	| { kind: "kept"; why: string };

export interface BoardLeftoversPlan {
	canvases: Array<{
		canvas: string;
		/** Each board item left, by id: its board (canvas-relative) and what it becomes. */
		items: Array<{ id: string; board: string; becomes: Becomes }>;
		/** Board files no item names any more, canvas-relative, and why each goes or stays. */
		files: Array<{ board: string; deleted: boolean; why: string }>;
	}>;
}

const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

export function migrated(deck: string): boolean {
	return !!readJson<Record<string, unknown>>(join(deck, ".decks", "migrations.json"))?.[MIGRATION];
}

const isBoardItem = (node: Node) => node.type === "browser" && node.metadata?.type === "decks.board" && typeof node.metadata.path === "string";

/** Each node with the list it is in, so one can be taken out. */
const walk = (nodes: unknown, visit: (node: Node, list: Node[]) => void) => {
	if (!Array.isArray(nodes)) return;
	for (const node of [...(nodes as Node[])]) {
		if (!node || typeof node !== "object") continue;
		visit(node, nodes as Node[]);
		walk(node.children, visit);
	}
};

/** The deck's own canvases' drawings. */
function drawings(deck: string): Array<{ canvas: string; file: string }> {
	const canvases = join(deck, "canvases");
	if (!existsSync(canvases)) return [];
	return readdirSync(canvases, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => ({ canvas: entry.name, file: join(canvases, entry.name, "canvas.pen") }))
		.filter((one) => existsSync(one.file))
		.sort((a, b) => a.canvas.localeCompare(b.canvas));
}

/** A board item's path as its canvas names it (`boards/a.html`, `boards/files/a.html`), or undefined for one outside the canvas's own boards/. */
function ownBoard(canvas: string, given: string): string | undefined {
	const prefix = `canvases/${canvas}/`;
	const path = given.startsWith(prefix) ? given.slice(prefix.length) : given;
	if (!/^boards\/(?:[^/]+\/)*[^/]+\.html?$/i.test(path) || path.split("/").includes("..")) return undefined;
	return path;
}

/** Every page file in a canvas's boards/, canvas-relative. */
function boardFiles(folder: string, under = "boards"): string[] {
	const full = join(folder, under);
	if (!existsSync(full)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(full, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory()) out.push(...boardFiles(folder, `${under}/${entry.name}`));
		else if (/\.html?$/i.test(entry.name)) out.push(`${under}/${entry.name}`);
	}
	return out.sort();
}

/** A board's last picture on disk: of this revision if there is one, else the newest of any, light before dark. */
export function lastPicture(deck: string, path: string, html: string): string | undefined {
	const thumbs = join(deck, ".decks", "thumbs");
	if (!existsSync(thumbs)) return undefined;
	const rev = revisionOf(html);
	for (const scheme of ["light", "dark"] as const) {
		const exact = join(thumbs, thumbName(path, rev, scheme, "whole"));
		if (existsSync(exact)) return exact;
	}
	const names = readdirSync(thumbs);
	for (const scheme of ["light", "dark"] as const) {
		const match = pictureOf(path, scheme, "whole");
		const found = names.filter((name) => match.test(name)).map((name) => join(thumbs, name));
		if (found.length) return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	}
	return undefined;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A card that shows a board's picture, with a link to its old page: for a board no converter reads. */
export function pictureCard(title: string, board: string, picture: string | undefined, size: { w?: number; h?: number }): string {
	const meta = { ...(size.w ? { w: size.w } : {}), ...(size.h ? { h: size.h } : {}) };
	const link = `../../${board}`;
	return `<title>${escape(title)}</title>
<meta name="board" content='${JSON.stringify(meta)}' />
<style>.old-board { display: block; width: 100%; height: auto; } .old-board-link { display: block; padding: 8px 12px; font-size: 13px; }</style>
${picture ? `<a href="${escape(link)}" target="_blank"><img class="old-board" src="${escape(picture)}" alt="${escape(title)}, as it last looked" /></a>\n` : `<h2>${escape(title)}</h2>\n`}<a class="old-board-link" href="${escape(link)}" target="_blank">Open the old board</a>
`;
}

/** What a file card says it is, by extension (`card-frame.ts`, `fileKind`). */
function fileKind(path: string): { label: string; icon: string; tone: string } {
	const extension = (path.split(".").pop() ?? "").toLowerCase();
	if (extension === "pdf") return { label: "PDF", icon: "file-text", tone: "#d92e3c" };
	if (extension === "svg") return { label: "SVG", icon: "file-image", tone: "#c46a00" };
	if (extension === "html" || extension === "htm") return { label: "Web page", icon: "globe", tone: "#2f6fde" };
	return { label: extension ? extension.toUpperCase() : "File", icon: "file", tone: "#6b7280" };
}

/** A file card's width on the canvas (`FILE_CARD_W`). */
export const FILE_CARD_W = 320;

/**
 * A file card, as a file dropped on the canvas makes one (`fileCard` in `card-frame.ts`): a frame with
 * the file's picture on top and its name and kind under it, marked `decks.file`. `file` and the
 * preview are named from the canvas's own folder. Written here as it is today, so the migration stays
 * what it was when the card changes.
 */
export function fileCardNode(id: string, at: { x?: unknown; y?: unknown; name?: unknown }, file: string, preview?: { path: string; w: number; h: number; pages?: number }): Node {
	const name = file.split("/").pop() || file;
	const kind = fileKind(file);
	const sub = [kind.label, preview?.pages ? `${preview.pages} ${preview.pages === 1 ? "page" : "pages"}` : ""].filter(Boolean).join(", ");
	const tall = preview ? Math.round(Math.min(420, (FILE_CARD_W * preview.h) / Math.max(1, preview.w))) : 0;
	return {
		type: "frame", id, name: typeof at.name === "string" && at.name ? at.name : name,
		...(typeof at.x === "number" ? { x: at.x } : {}), ...(typeof at.y === "number" ? { y: at.y } : {}),
		layout: "vertical", gap: 0, padding: 0, width: FILE_CARD_W, cornerRadius: 12, clip: true, fill: "$decks-surface", stroke: "$decks-line-subtle", strokeWidth: 1,
		effect: { type: "shadow", shadowType: "outer", offset: { x: 0, y: 2 }, blur: 10, spread: 0, color: "#0000001a" },
		metadata: { type: "decks.file", path: file, ...(preview ? { preview: preview.path } : {}) },
		children: [
			...(preview && tall ? [{ type: "rectangle", id: `${id}-preview`, name: "Preview", width: "fill_container", height: tall, fill: { type: "image", url: preview.path, mode: "fill" } }] : []),
			{
				type: "frame", id: `${id}-label`, name: "Label", layout: "horizontal", gap: 10, padding: [10, 12], alignItems: "center", width: "fill_container", ...(tall ? { stroke: "$decks-line-subtle", strokeWidth: { top: 1 } } : {}),
				children: [
					{ type: "frame", id: `${id}-kind`, name: "Kind", width: 30, height: 30, cornerRadius: 7, fill: `${kind.tone}21`, layout: "horizontal", justifyContent: "center", alignItems: "center", children: [{ type: "icon", id: `${id}-icon`, library: "lucide", icon: kind.icon, width: 16, height: 16, fill: kind.tone }] },
					{
						type: "frame", id: `${id}-words`, name: "Words", layout: "vertical", gap: 2, width: "fill_container",
						children: [
							{ type: "text", id: `${id}-name`, content: name, fontSize: 14, fontWeight: "600", fill: "$decks-text", textGrowth: "fixed-width", width: "fill_container" },
							{ type: "text", id: `${id}-sub`, content: sub, fontSize: 12, fill: "$decks-text-muted", textGrowth: "fixed-width", width: "fill_container" },
						],
					},
				],
			},
		],
	};
}

function pngSize(file: string): { w: number; h: number } | undefined {
	try {
		const head = readFileSync(file).subarray(0, 24);
		return head.toString("ascii", 12, 16) === "IHDR" ? { w: head.readUInt32BE(16), h: head.readUInt32BE(20) } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * A file's picture for its card, deck-relative, as `files/preview.ts` names it (`<file>.preview.png`):
 * one already there and fresh, or, when `draw`, a PDF's first page drawn now by poppler. A web page's
 * needs a browser, which a migration does not start: its card shows its name until it is dropped again.
 */
function previewOf(deck: string, file: string, draw: boolean): { path: string; w: number; h: number; pages?: number } | undefined {
	const full = join(deck, file);
	const out = `${file}.preview.png`;
	const target = join(deck, out);
	const pdf = /\.pdf$/i.test(file);
	let pages: number | undefined;
	if (pdf && draw) {
		try {
			pages = Number(/^Pages:\s+(\d+)/m.exec(execFileSync("pdfinfo", [full], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }))?.[1]) || undefined;
			if (!(existsSync(target) && statSync(target).mtimeMs >= statSync(full).mtimeMs)) execFileSync("pdftoppm", ["-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to-x", "960", "-scale-to-y", "-1", full, target.replace(/\.png$/, "")], { timeout: 20_000, stdio: "ignore" });
		} catch {
			/* no poppler, or a PDF it cannot read: no picture */
		}
	}
	if (!existsSync(target) || statSync(target).mtimeMs < statSync(full).mtimeMs) return undefined;
	const size = pngSize(target);
	return size ? { path: out, ...size, ...(pages ? { pages } : {}) } : undefined;
}

/** A deck path as a canvas's drawing names it: from the canvas's folder when inside it, else up out of it. */
const fromCanvas = (canvas: string, deckPath: string) => {
	const folder = `canvases/${canvas}`;
	return deckPath.startsWith(`${folder}/`) ? deckPath.slice(folder.length + 1) : `../../${deckPath}`;
};

const titleOf = (html: string, board: string) => /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || posix.basename(board).replace(/\.html?$/i, "");

/** What one board item becomes, read off its page; `draw` lets it draw a PDF's picture. */
function decide(deck: string, canvas: string, given: string, cardName: (base: string) => string, draw: boolean): { board: string; becomes: Becomes } {
	const board = ownBoard(canvas, given);
	if (!board) return { board: given, becomes: { kind: "kept", why: "it names a board outside this canvas's own boards/" } };
	const full = join(deck, "canvases", canvas, board);
	if (!existsSync(full)) return { board, becomes: { kind: "kept", why: "its file is gone" } };
	const html = readFileSync(full, "utf8");
	const deckBoard = `canvases/${canvas}/${board}`;
	const base = posix.basename(board).replace(/\.html?$/i, "");
	const source = fileBoardSource(html);
	if (source) {
		const clean = source.replace(/[?#].*$/, "");
		if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("/")) return { board, becomes: { kind: "picture", card: cardName(base), why: `it shows ${clean}, which is not a deck file`, ...picture(deck, deckBoard, html) } };
		const deckPath = posix.normalize(posix.join(posix.dirname(deckBoard), clean));
		if (deckPath.startsWith("..") || !existsSync(join(deck, deckPath))) return { board, becomes: { kind: "picture", card: cardName(base), why: `the file it shows (${deckPath}) is gone`, ...picture(deck, deckBoard, html) } };
		const preview = previewOf(deck, deckPath, draw);
		return { board, becomes: { kind: "file", file: fromCanvas(canvas, deckPath), ...(preview ? { preview: { ...preview, path: fromCanvas(canvas, preview.path) } } : {}) } };
	}
	const live = liveKind(html);
	if (live === "web" || /^your-chrome\.html?$/i.test(posix.basename(board))) return { board, becomes: { kind: "removed", why: "it was the shared Chrome tab's status" } };
	const item = live === "doc" || live === "app" ? boardIsItem(html) : undefined;
	if (item && "document" in item) return { board, becomes: { kind: "document", path: item.document.startsWith("/") || item.document.startsWith("~") ? item.document : posix.normalize(posix.join(posix.dirname(deckBoard), item.document)) } };
	if (item && "app" in item) return { board, becomes: { kind: "app", name: item.app } };
	if (!live && /<body\b[^>]*class\s*=\s*["'][^"']*\bboard\b/i.test(html)) return { board, becomes: { kind: "card", card: cardName(base) } };
	const why = live === "agents" ? "its page is the agents list" : live ? `its ${live} box names nothing` : /<iframe\b/i.test(html) ? "its page frames another page" : "its page is not a board's";
	return { board, becomes: { kind: "picture", card: cardName(base), why, ...picture(deck, deckBoard, html) } };
}

const picture = (deck: string, deckBoard: string, html: string) => {
	const found = lastPicture(deck, deckBoard, html);
	return found ? { picture: found } : {};
};

function planCanvas(deck: string, canvas: string, doc: { children?: unknown }, draw: boolean): BoardLeftoversPlan["canvases"][number] {
	const folder = join(deck, "canvases", canvas);
	const taken = new Set(existsSync(join(folder, "cards")) ? readdirSync(join(folder, "cards")) : []);
	const cardName = (base: string) => {
		let card = base;
		for (let n = 2; taken.has(card); n++) card = `${base}-${n}`;
		taken.add(card);
		return card;
	};
	const items: BoardLeftoversPlan["canvases"][number]["items"] = [];
	const byBoard = new Map<string, Becomes>();
	walk(doc.children, (node) => {
		if (!isBoardItem(node)) return;
		const given = node.metadata!.path as string;
		const own = ownBoard(canvas, given);
		// A board placed twice becomes the same thing twice: one card for both.
		const already = own ? byBoard.get(own) : undefined;
		const { board, becomes } = already ? { board: own!, becomes: already } : decide(deck, canvas, given, cardName, draw);
		if (own) byBoard.set(own, becomes);
		items.push({ id: String(node.id), board, becomes });
	});
	// Board files nothing names any more: the boards still placed, and those a picture card opens, stay.
	const named = new Set(items.filter((one) => one.becomes.kind === "kept" || one.becomes.kind === "picture").map((one) => one.board));
	const linked = linkedBoards(folder);
	const files: BoardLeftoversPlan["canvases"][number]["files"] = [];
	for (const board of boardFiles(folder)) {
		if (named.has(board)) continue;
		if (linked.has(board)) {
			files.push({ board, deleted: false, why: "a card links to it" });
			continue;
		}
		const placed = items.find((one) => one.board === board);
		const is = placed ? undefined : boardIsItem(readFileSync(join(folder, board), "utf8"));
		const why = placed ? `its item became ${placed.becomes.kind === "removed" ? "nothing" : `a ${placed.becomes.kind === "card" ? "card" : placed.becomes.kind === "file" ? "file card" : placed.becomes.kind}`}` : is ? `${"document" in is ? "a document's" : "an app's"} board, which documents-and-apps left` : "no item names it";
		files.push({ board, deleted: true, why });
	}
	return { canvas, items, files };
}

/** Board files a card on this canvas links to (`../../boards/a.html`), canvas-relative. */
function linkedBoards(folder: string): Set<string> {
	const out = new Set<string>();
	const cards = join(folder, "cards");
	if (!existsSync(cards)) return out;
	for (const card of readdirSync(cards)) {
		const file = join(cards, card, "index.html");
		if (!existsSync(file)) continue;
		for (const match of readFileSync(file, "utf8").matchAll(/\b(?:href|src)\s*=\s*["']((?:\.\.\/)+boards\/[^"'#?]+\.html?)/gi)) {
			const path = posix.normalize(posix.join(`cards/${card}`, match[1]!));
			if (path.startsWith("boards/")) out.add(path);
		}
	}
	return out;
}

export function planBoardLeftovers(deck: string, options: { draw?: boolean } = {}): BoardLeftoversPlan {
	const canvases: BoardLeftoversPlan["canvases"] = [];
	for (const { canvas, file } of drawings(deck)) {
		const doc = readJson<{ children?: unknown }>(file);
		if (!doc) continue;
		const one = planCanvas(deck, canvas, doc, options.draw ?? false);
		if (one.items.length || one.files.length) canvases.push(one);
	}
	return { canvases };
}

/** Counts of what the plan does, for the log and the record. */
export function countsOf(plan: BoardLeftoversPlan) {
	const items = plan.canvases.flatMap((one) => one.items);
	const files = plan.canvases.flatMap((one) => one.files);
	const by = (kind: Becomes["kind"]) => items.filter((one) => one.becomes.kind === kind).length;
	return { fileCards: by("file"), removed: by("removed"), documents: by("document"), apps: by("app"), cards: by("card"), pictureCards: by("picture"), kept: by("kept"), deleted: files.filter((one) => one.deleted).length, keptFiles: files.filter((one) => !one.deleted).length };
}

export function describeBoardLeftovers(plan: BoardLeftoversPlan): string[] {
	const lines: string[] = [];
	for (const one of plan.canvases) {
		for (const item of one.items) {
			const b = item.becomes;
			const what =
				b.kind === "file" ? `file card for ${b.file}${b.preview ? "" : " (no picture)"}`
				: b.kind === "removed" ? `removed: ${b.why}`
				: b.kind === "document" ? `document ${b.path}`
				: b.kind === "app" ? `app ${b.name}`
				: b.kind === "card" ? `card cards/${b.card}`
				: b.kind === "picture" ? `picture card cards/${b.card}${b.picture ? "" : " (no picture found)"}: ${b.why}`
				: `kept: ${b.why}`;
			lines.push(`board    canvases/${one.canvas}/${item.board} (${item.id}) -> ${what}`);
		}
		for (const file of one.files) lines.push(`${file.deleted ? "delete" : "keep  "}   canvases/${one.canvas}/${file.board}: ${file.why}`);
	}
	const c = countsOf(plan);
	lines.push(`board leftovers: ${c.fileCards} file card(s), ${c.removed} removed, ${c.documents} document(s), ${c.apps} app(s), ${c.cards} card(s), ${c.pictureCards} picture card(s), ${c.kept} kept; ${c.deleted} board file(s) deleted, ${c.keptFiles} kept`);
	return lines;
}

/** Run it, once: back up what it changes, rewrite the drawings, write the cards, delete the board files, report and record. */
export function migrateBoardLeftovers(deck: string, options: { dryRun?: boolean; log?: (line: string) => void; now?: Date; draw?: boolean } = {}): { plan: BoardLeftoversPlan; ran: boolean; backup?: string; report?: string } {
	const log = options.log ?? (() => {});
	if (options.dryRun) {
		const plan = planBoardLeftovers(deck);
		for (const line of describeBoardLeftovers(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan: { canvases: [] }, ran: false };
	const plan = planBoardLeftovers(deck, { draw: options.draw ?? true });
	const now = options.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const changing = plan.canvases.filter((one) => one.items.some((item) => item.becomes.kind !== "kept"));
	const paths = [
		...changing.map((one) => `canvases/${one.canvas}/canvas.pen`),
		...plan.canvases.flatMap((one) => [...one.files.filter((f) => f.deleted).map((f) => f.board), ...one.items.filter((i) => i.becomes.kind === "card").map((i) => i.board)].map((board) => `canvases/${one.canvas}/${board}`)),
	].filter((path, index, all) => all.indexOf(path) === index && existsSync(join(deck, path)));
	let backup: string | undefined;
	if (paths.length) {
		backup = `.decks/backups/${stamp}-before-board-leftovers.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		execFileSync("zip", ["-q", join(deck, backup), ...paths], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up the drawings and board files it changes to ${backup}`);
	}
	for (const one of changing) {
		const folder = join(deck, "canvases", one.canvas);
		const file = join(folder, "canvas.pen");
		const text = readFileSync(file, "utf8");
		const doc = JSON.parse(text) as { children?: unknown };
		const byId = new Map(one.items.map((item) => [item.id, item]));
		const written = new Set<string>();
		const links = new Map(one.items.flatMap((item) => (item.becomes.kind === "card" ? [[posix.basename(item.board), item.becomes.card] as [string, string]] : [])));
		walk(doc.children, (node, list) => {
			if (!isBoardItem(node)) return;
			const item = byId.get(String(node.id));
			if (!item) return;
			const b = item.becomes;
			if (b.kind === "card" && typeof node.width === "number") {
				// As tall as its page last measured, as boards-to-cards gives its cards.
				const measured = measuredHeight(deck, `canvases/${one.canvas}/${item.board}`, readFileSync(join(folder, item.board), "utf8"), node.width);
				if (measured !== undefined && (typeof node.height !== "number" || node.height < measured)) node.height = measured;
			}
			const size = { ...(typeof node.width === "number" ? { w: node.width } : {}), ...(typeof node.height === "number" ? { h: node.height } : {}) };
			if (b.kind === "removed") list.splice(list.indexOf(node), 1);
			else if (b.kind === "file") list.splice(list.indexOf(node), 1, fileCardNode(String(node.id), node, b.file, b.preview));
			else if (b.kind === "document" || b.kind === "app") node.metadata = b.kind === "document" ? { type: "decks.document", path: b.path } : { type: "decks.app", name: b.name };
			else if (b.kind === "card" || b.kind === "picture") {
				const path = `cards/${b.card}/index.html`;
				node.metadata = { ...node.metadata, type: "decks.card", path };
				if (typeof node.url === "string") node.url = path;
				if (written.has(b.card)) return;
				written.add(b.card);
				const html = readFileSync(join(folder, item.board), "utf8");
				mkdirSync(join(folder, "cards", b.card), { recursive: true });
				if (b.kind === "card") {
					// A card is two folders into its canvas (`cards/<name>/`); a board in boards/ was one, in a folder of boards/ two, as deep as its card.
					const deeper = 3 - item.board.split("/").length;
					writeFileSync(join(folder, "cards", b.card, "index.html"), boardToCard(html, links, size, deeper));
				} else {
					let picture: string | undefined;
					if (b.picture) {
						picture = `picture${posix.extname(b.picture)}`;
						copyFileSync(b.picture, join(folder, "cards", b.card, picture));
					}
					writeFileSync(join(folder, "cards", b.card, "index.html"), pictureCard(titleOf(html, item.board), item.board, picture, size));
				}
			}
		});
		const indent = /\n\t/.test(text) ? "\t" : 2;
		writeFileSync(file, `${JSON.stringify(doc, null, indent)}\n`);
	}
	for (const one of plan.canvases) {
		const folder = join(deck, "canvases", one.canvas);
		const gone = new Set([...one.files.filter((f) => f.deleted).map((f) => f.board), ...one.items.filter((i) => i.becomes.kind === "card").map((i) => i.board)]);
		for (const board of gone) rmSync(join(folder, board), { force: true });
		// A boards/ folder (or one inside it) left empty goes too.
		for (const dir of [...new Set([...gone].map((board) => posix.dirname(board)))].sort((a, b) => b.length - a.length)) {
			for (let at = dir; at.startsWith("boards"); at = posix.dirname(at)) {
				try {
					rmdirSync(join(folder, at));
				} catch {
					break;
				}
			}
		}
	}
	const counts = countsOf(plan);
	const lines = describeBoardLeftovers(plan);
	let report: string | undefined;
	if (lines.length > 1) {
		report = `.decks/backups/${stamp}-board-leftovers.txt`;
		mkdirSync(dirname(join(deck, report)), { recursive: true });
		writeFileSync(join(deck, report), `The board leftovers migration, ${now.toISOString()}.\n${backup ? `What it changed is backed up in ${backup}.\n` : ""}\n${lines.join("\n")}\n`);
	}
	const record = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(record) ?? {};
	mkdirSync(dirname(record), { recursive: true });
	const notConverted = plan.canvases.flatMap((one) => one.items.filter((i) => i.becomes.kind === "picture" || i.becomes.kind === "kept").map((i) => ({ board: `canvases/${one.canvas}/${i.board}`, as: i.becomes.kind, why: (i.becomes as { why: string }).why })));
	writeFileSync(record, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), ...(report ? { report } : {}), ...counts, notConverted } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}), ...(report ? { report } : {}) };
}
