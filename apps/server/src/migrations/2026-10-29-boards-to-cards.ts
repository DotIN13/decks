import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { revisionOf } from "../deck/loader.ts";
import { SMALL_TAKEN, smallName, thumbName, webpSize } from "../pictures/ladder.ts";
import { BOARD_W } from "../cards/size.ts";

/**
 * 2026-10-29: every board on a canvas becomes a card.
 *
 * A board was a page of its own, framed on the canvas; a card is a piece of HTML the stage draws in a
 * shadow root of its own page (`packages/canvas/src/items/card.ts`). Each board placed on one of the deck's
 * own canvases (`canvases/<name>/canvas.pen`) is rewritten into `canvases/<name>/cards/<board>/index.html`,
 * and its item in the drawing becomes `decks.card`, keeping its id, place and size so arrows to it still
 * join. It is not lossless, and need not be:
 *
 * - its head's styles and stylesheets come along, `body` and `:root` read as the card's root; board.css
 *   and board.js are the card's already, and are dropped;
 * - each inline script becomes a module the card calls with itself, `document` being the card's;
 * - its `data-eval` buttons are wired by one more module, which runs each `text/decks-eval` block as the
 *   board did, with `stage` the card's SDK (`card.decks`, old names such as `stage.send` mapped) and
 *   `event` what was pressed;
 * - every relative address gains one `../`, the card's folder being one deeper; a link to a board that
 *   became a card points at the card;
 * - an embedded file (`data-embed`) is dropped: cards show none.
 *
 * A board whose page is not a board's (an app's, a document's, the shared Chrome tab's, one file's edge
 * to edge, or a page with no `.board` body) is left as it is and listed, for the board leftovers to take
 * (`2026-10-30-board-leftovers.ts`). A friend's canvas is theirs and is left alone; so is
 * the old library in `boards/`, on no canvas. The canvases it changes are zipped first into
 * `.decks/backups/`, board files included, and the board files it converted are then removed. It runs
 * once, at start (`migrations/index.ts`), and says so in `.decks/migrations.json` with what it gave up on.
 */
export const MIGRATION = "2026-10-29-boards-to-cards";

interface Node {
	id?: unknown;
	type?: unknown;
	url?: unknown;
	width?: unknown;
	height?: unknown;
	metadata?: { type?: unknown; path?: unknown; [key: string]: unknown };
	children?: unknown;
	[key: string]: unknown;
}

export interface BoardsToCardsPlan {
	/** Per canvas: its boards that become cards (canvas-relative board path → card folder name), and those kept, with why. */
	canvases: Array<{ canvas: string; cards: Array<{ board: string; card: string }>; kept: Array<{ board: string; why: string }> }>;
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

const walk = (nodes: unknown, visit: (node: Node) => void) => {
	if (!Array.isArray(nodes)) return;
	for (const node of nodes as Node[]) {
		if (!node || typeof node !== "object") continue;
		visit(node);
		walk(node.children, visit);
	}
};

/**
 * The live box a board's page is, read off an element's own attribute, so a page that only writes
 * `data-live="doc"` in its words (in a `<code>`) is not taken for one.
 */
export function liveKind(html: string): "doc" | "app" | "web" | "agents" | undefined {
	return /<[a-z][\w-]*\b[^>]*\bdata-live\s*=\s*["'](doc|app|web|agents)["']/i.exec(html)?.[1]?.toLowerCase() as "doc" | "app" | "web" | "agents" | undefined;
}

/** The file a file board shows edge to edge (`data-embed` with `data-bare`, the old `newFileBoard`), as its page names it. */
export function fileBoardSource(html: string): string | undefined {
	const box = /<[a-z][\w-]*\b[^>]*\bdata-embed\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
	return box && /\bdata-bare\b/i.test(box[0]) ? box[1] : undefined;
}

/** Why a board's page is not a card's, or undefined when it is. */
export function notACard(html: string): string | undefined {
	const live = liveKind(html);
	if (fileBoardSource(html)) return "its page is one file";
	if (live) return `its page is ${live === "doc" ? "a document" : live === "app" ? "an app" : live === "web" ? "the shared Chrome tab" : "the agents list"}`;
	if (!/<body\b[^>]*class\s*=\s*["'][^"']*\bboard\b/i.test(html)) return "its page is not a board's";
	return undefined;
}

const JS = /^(?:|module|text\/javascript|application\/javascript)$/i;
const typeOf = (attrs: string) => /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";

/** Selectors written for a board's page, for a card's root. */
export const restyle = (css: string) =>
	css
		.replace(/body\.board/g, ".card-body")
		.replace(/(^|[\s,{}>+~(])body(?=[\s,{.:[>+~)#])/g, "$1.card-body")
		.replace(/:root\b/g, ":host")
		.replace(/(^|[\s,{}])html(?=[\s,{.:[>])/g, "$1:host");

/**
 * What a board's script took from its page, as its card has them: `document` is the card's, and a
 * timer or an animation frame stops when the card sleeps, as a board's stopped with its page, so a
 * ticking clock does not reach for elements that are gone.
 */
const CARD_SCOPE = `\tconst document = card.document;
\tconst setInterval = (run, ms, ...args) => { const id = globalThis.setInterval(run, ms, ...args); card.signal.addEventListener("abort", () => globalThis.clearInterval(id)); return id; };
\tconst setTimeout = (run, ms, ...args) => { const id = globalThis.setTimeout(run, ms, ...args); card.signal.addEventListener("abort", () => globalThis.clearTimeout(id)); return id; };
\tconst requestAnimationFrame = (run) => (card.signal.aborted ? 0 : globalThis.requestAnimationFrame((at) => card.signal.aborted || run(at)));
`;

/**
 * A relative address a script names (`"../files/a.png"`, `` `../assets/${name}` ``), made the card's:
 * in a card an address set at run time, or fetched, is read against the page the card is in, not the
 * card's file, so each goes through `card.file`, which reads it against the card.
 */
const fromCard = (code: string) => code.replace(/(["'`])(\.\.?\/[^"'`\n]*)\1/g, (_all, quote: string, address: string) => `card.file(${quote}${address}${quote})`);

/** A board's script, as a card's module: its imports first, the rest called with the card. */
function toModule(code: string, isModule: boolean): string {
	const imports: string[] = [];
	let rest = code;
	if (isModule) rest = code.replace(/^[ \t]*import\s[\s\S]*?from\s*["'][^"']+["'];?|^[ \t]*import\s*["'][^"']+["'];?/gm, (all) => (imports.push(all.trim()), ""));
	rest = fromCard(rest);
	return `${imports.join("\n")}${imports.length ? "\n" : ""}export default async function (card) {\n${CARD_SCOPE}${rest}\n}\n`;
}

/**
 * The module that wires a board's `data-eval` buttons in its card: a press (a person's, not a script's)
 * runs the block named by `data-for`, with `stage` the card's SDK and `event` what was pressed.
 */
function evalModule(blocks: Map<string, string>): string {
	const table = [...blocks].map(([id, code]) => `\t${JSON.stringify(id)}: async (stage, event) => {\n${code}\n\t},`).join("\n");
	return `const blocksOf = (card) => ({
${table}
});
/* The board SDK's old names, as the card's calls. */
const OLD = { send: "agent.queue", move: "canvas.move", moveBoard: "canvas.move", fit: "canvas.fit", boards: "canvas.read", show: "canvas.insert", hide: "canvas.delete", me: "agent.me", agents: "agent.list", camera: "view.camera", now: "now", here: "here" };
export default function (card) {
	const BLOCKS = blocksOf(card);
	const call = (name) => name.split(".").reduce((at, key) => at[key], card.decks);
	const stage = new Proxy(card.decks, { get: (decks, key) => (typeof key === "string" && key in OLD ? (...args) => call(OLD[key])(...args) : decks[key]) });
	const run = (element) => {
		const id = element.getAttribute("data-eval");
		const block = BLOCKS[id];
		if (!block) return console.warn(\`[decks] Nothing on this card answers "\${id}".\`);
		const value = element.dataset.value ?? ("value" in element ? element.value : undefined);
		const event = { id, board: card.path, path: card.path, ...(value !== undefined ? { value } : {}) };
		block(stage, event).catch((error) => console.error(\`[decks] "\${id}" on \${card.path} failed:\`, error));
	};
	card.root.addEventListener("click", (event) => {
		const element = event.target?.closest?.("[data-eval]");
		if (!event.isTrusted || !element || /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) return;
		run(element);
	}, { signal: card.signal });
	card.root.addEventListener("change", (event) => {
		const element = event.target?.closest?.("[data-eval]");
		if (event.isTrusted && element && /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) run(element);
	}, { signal: card.signal });
}
`;
}

/**
 * A board's page as a card. `links` names, for each board file beside it (`a.html`), the card it
 * became, so a link to it follows; `placed` is the board's size on its canvas.
 */
export function boardToCard(html: string, links: Map<string, string>, placed?: { w?: number; h?: number }, deeper = 1): string {
	const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
	const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
	const title = /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.trim();
	let meta: Record<string, unknown> = {};
	try {
		meta = JSON.parse(/<meta\s+name=["']board["']\s+content='([^']*)'/i.exec(head)?.[1] ?? "{}") as Record<string, unknown>;
	} catch {
		meta = {};
	}
	if (placed?.w && !meta.w) meta.w = placed.w;
	if (placed?.h && !meta.h) meta.h = placed.h;
	const parts = [...(title ? [`<title>${title}</title>`] : []), `<meta name="board" content='${JSON.stringify(meta)}' />`];
	for (const link of head.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) if (!/board\.css/.test(link[0])) parts.push(link[0]);
	for (const style of head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) parts.push(`<style>${restyle(style[1] ?? "")}</style>`);
	const modules: string[] = [];
	const blocks = new Map<string, string>();
	const take = (text: string) =>
		text.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (all, attrs: string, code: string) => {
			const type = typeOf(attrs);
			if (type === "importmap") return "";
			if (/\bsrc\s*=\s*["'][^"']*board\.js["']/.test(attrs)) return "";
			if (/^text\/decks-eval$/i.test(type)) {
				const id = /\bdata-for\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.trim();
				if (id) blocks.set(id, fromCard(code));
				return "";
			}
			if (!JS.test(type) || /\bsrc\s*=/.test(attrs)) return all;
			modules.push(`<script type="module">\n${toModule(code, /^module$/i.test(type))}</script>`);
			return "";
		});
	for (const script of head.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
		const kept = take(script[0]).trim();
		if (kept) parts.push(kept);
	}
	const content = take(body)
		.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_all, attrs: string, css: string) => `<style${attrs}>${restyle(css)}</style>`)
		// An embedded file (`data-embed`, a PDF's pages) was the board runtime's; cards show none, so the box goes.
		.replace(/<([a-z][\w-]*)\b[^>]*\bdata-embed\s*=[^>]*>[\s\S]*?<\/\1\s*>|<[a-z][\w-]*\b[^>]*\bdata-embed\s*=[^>]*\/>/gi, "");
	parts.push(content.trim(), ...modules);
	if (blocks.size) parts.push(`<script type="module">\n${evalModule(blocks)}</script>`);
	// A folder of its own, one deeper than the board was: every `../` gains one more (`deeper`, for a board in a folder of boards/).
	return `${parts
		.join("\n")
		.replace(/(["'(`])((?:\.\.\/)+)/g, (_all, quote: string, ups: string) => `${quote}${"../".repeat(Math.max(0, ups.length / 3 + deeper))}`)
		.replace(/\bhref\s*=\s*"([^"/:#?]+\.html?)(#[^"]*)?"/gi, (all, sibling: string, hash = "") => {
			const card = links.get(sibling);
			return card ? `href="../${card}/index.html${hash}"` : `href="../../boards/${sibling}${hash}"`;
		})}\n`;
}

/**
 * How tall a board's page last measured, laid out at width `w`, when the deck knows: a browser's
 * reading of this revision (`.decks/heights.json`, from when browsers sized boards), or the height of
 * its picture of this revision, which was taken at the height its page measured (`pictures/service.ts`).
 * A board's item kept the height somebody once gave it, often the 240 px a new board starts at, while
 * its page grew past it; the card it becomes is given the page's height, so it opens whole.
 */
export function measuredHeight(deck: string, path: string, html: string, w: number): number | undefined {
	let meta: { w?: unknown } = {};
	try {
		meta = JSON.parse(/<meta\s+name=["']board["']\s+content='([^']*)'/i.exec(html)?.[1] ?? "{}") as { w?: unknown };
	} catch {
		/* no size of its own */
	}
	// Both were laid out at the board's own width: a reading at another is not this item's.
	const own = typeof meta.w === "number" && meta.w > 0 ? meta.w : BOARD_W;
	if (Math.abs(own - w) > 1) return undefined;
	const rev = revisionOf(html);
	const read = readJson<Record<string, { rev?: unknown; h?: unknown }>>(join(deck, ".decks", "heights.json"))?.[path];
	const heights: number[] = [];
	if (read && read.rev === rev && typeof read.h === "number" && read.h > 0) heights.push(read.h);
	for (const scheme of ["light", "dark"] as const) {
		const whole = join(deck, ".decks", "thumbs", thumbName(path, rev, scheme, "whole"));
		for (const file of [whole, smallName(whole, SMALL_TAKEN)]) {
			if (!existsSync(file)) continue;
			try {
				const size = webpSize(readFileSync(file).subarray(0, 64));
				if (size && size.w > 0) heights.push(Math.round((size.h * own) / size.w));
			} catch {
				/* unreadable: not a size */
			}
		}
	}
	return heights.length ? Math.max(...heights) : undefined;
}

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

/** A board item's path as its canvas names it (`boards/a.html`), or undefined when it lies outside the canvas's own boards/. */
function ownBoard(canvas: string, given: string): string | undefined {
	const prefix = `canvases/${canvas}/`;
	const path = given.startsWith(prefix) ? given.slice(prefix.length) : given;
	if (path.startsWith("canvases/") || path.startsWith("shared/") || !/^boards\/[^/]+\.html?$/i.test(path)) return undefined;
	return path;
}

function planCanvas(deck: string, canvas: string, doc: { children?: unknown }): BoardsToCardsPlan["canvases"][number] {
	const folder = join(deck, "canvases", canvas);
	const cards: Array<{ board: string; card: string }> = [];
	const kept: Array<{ board: string; why: string }> = [];
	const seen = new Set<string>();
	const taken = new Set(existsSync(join(folder, "cards")) ? readdirSync(join(folder, "cards")) : []);
	walk(doc.children, (node) => {
		if (node.type !== "browser" || node.metadata?.type !== "decks.board" || typeof node.metadata.path !== "string") return;
		const board = ownBoard(canvas, node.metadata.path);
		if (!board) return kept.push({ board: node.metadata.path, why: "it is not in this canvas's own boards/" }), undefined;
		if (seen.has(board)) return;
		seen.add(board);
		const file = join(folder, board);
		if (!existsSync(file)) return kept.push({ board, why: "its file is gone" }), undefined;
		const why = notACard(readFileSync(file, "utf8"));
		if (why) return kept.push({ board, why }), undefined;
		const base = posix.basename(board).replace(/\.html?$/i, "");
		let card = base;
		for (let n = 2; taken.has(card); n++) card = `${base}-${n}`;
		taken.add(card);
		cards.push({ board, card });
	});
	return { canvas, cards, kept };
}

export function planBoardsToCards(deck: string): BoardsToCardsPlan {
	const canvases: BoardsToCardsPlan["canvases"] = [];
	for (const { canvas, file } of drawings(deck)) {
		const doc = readJson<{ children?: unknown }>(file);
		if (!doc) continue;
		const one = planCanvas(deck, canvas, doc);
		if (one.cards.length || one.kept.length) canvases.push(one);
	}
	return { canvases };
}

export function describeBoardsToCards(plan: BoardsToCardsPlan): string[] {
	const cards = plan.canvases.reduce((sum, one) => sum + one.cards.length, 0);
	const kept = plan.canvases.flatMap((one) => one.kept.map((k) => `kept     canvases/${one.canvas}/${k.board}: ${k.why}`));
	return [...kept, `boards to cards: ${cards} board(s) in ${plan.canvases.filter((one) => one.cards.length).length} canvas(es) become cards, ${kept.length} kept as they are`];
}

/** Run it, once: back up the canvases it changes, write the cards, rewrite the drawings, remove the converted boards, and record. */
export function migrateBoardsToCards(deck: string, options: { dryRun?: boolean; log?: (line: string) => void; now?: Date } = {}): { plan: BoardsToCardsPlan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planBoardsToCards(deck);
	if (options.dryRun) {
		for (const line of describeBoardsToCards(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan, ran: false };
	const now = options.now ?? new Date();
	const changing = plan.canvases.filter((one) => one.cards.length);
	let backup: string | undefined;
	if (changing.length) {
		backup = `.decks/backups/${now.toISOString().replace(/[:.]/g, "-")}-before-boards-to-cards.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		const paths = changing.flatMap((one) => [`canvases/${one.canvas}/canvas.pen`, ...one.cards.map((c) => `canvases/${one.canvas}/${c.board}`)]);
		execFileSync("zip", ["-q", join(deck, backup), ...paths], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up the canvases with boards to ${backup}`);
	}
	for (const one of changing) {
		const folder = join(deck, "canvases", one.canvas);
		const file = join(folder, "canvas.pen");
		const text = readFileSync(file, "utf8");
		const doc = JSON.parse(text) as { children?: unknown };
		const byBoard = new Map(one.cards.map((c) => [c.board, c.card]));
		const links = new Map(one.cards.map((c) => [posix.basename(c.board), c.card]));
		const sizes = new Map<string, { w?: number; h?: number }>();
		const pages = new Map(one.cards.map((c) => [c.board, readFileSync(join(folder, c.board), "utf8")]));
		walk(doc.children, (node) => {
			const board = node.type === "browser" && node.metadata?.type === "decks.board" && typeof node.metadata.path === "string" ? ownBoard(one.canvas, node.metadata.path) : undefined;
			if (!board || !byBoard.has(board)) return;
			// As tall as its page measured, at least: an item shorter than its page would cut the card.
			const measured = typeof node.width === "number" ? measuredHeight(deck, `canvases/${one.canvas}/${board}`, pages.get(board) ?? "", node.width) : undefined;
			if (measured !== undefined && (typeof node.height !== "number" || node.height < measured)) node.height = measured;
			if (!sizes.has(board)) sizes.set(board, { ...(typeof node.width === "number" ? { w: node.width } : {}), ...(typeof node.height === "number" ? { h: node.height } : {}) });
			const path = `cards/${byBoard.get(board)}/index.html`;
			node.metadata = { ...node.metadata, type: "decks.card", path };
			if (typeof node.url === "string") node.url = path;
		});
		for (const { board, card } of one.cards) {
			const html = pages.get(board) ?? readFileSync(join(folder, board), "utf8");
			mkdirSync(join(folder, "cards", card), { recursive: true });
			writeFileSync(join(folder, "cards", card, "index.html"), boardToCard(html, links, sizes.get(board)));
		}
		const indent = /\n\t/.test(text) ? "\t" : 2;
		writeFileSync(file, `${JSON.stringify(doc, null, indent)}\n`);
		for (const { board } of one.cards) rmSync(join(folder, board), { force: true });
	}
	const record = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(record) ?? {};
	mkdirSync(dirname(record), { recursive: true });
	const kept = plan.canvases.flatMap((one) => one.kept.map((k) => ({ board: `canvases/${one.canvas}/${k.board}`, why: k.why })));
	const cards = changing.reduce((sum, one) => sum + one.cards.length, 0);
	const made = Object.fromEntries(changing.map((one) => [one.canvas, Object.fromEntries(one.cards.map((c) => [c.board, `cards/${c.card}`]))]));
	writeFileSync(record, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), cards, made, kept } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}
