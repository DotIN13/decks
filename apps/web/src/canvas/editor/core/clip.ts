/**
 * What lands on the canvas when something is dragged or pasted onto it: a clip from a board, HTML
 * from another app, or text. Always the drawing's own item, never a screenshot: words are a text
 * item (`decks.markdown`), anything with structure is a card (`decks.card`, a column of markdown
 * blocks), a picture is pen's rectangle filled with it, an SVG is shown live, a film or a sound is
 * the canvas's own player.
 *
 * Two steps, so the page can do the one thing this cannot, fetch and upload pictures, in between:
 * `partsOfClip` / `partsOfHtml` / `partsOfText` say what was picked up, as parts (a paragraph, a
 * heading, a list, a table, code, a quote, a picture); `landOps` turns the parts, with the pictures
 * the page placed, into the ops of one `canvas.batch`. `landingOf` is what the drag's preview
 * says before any of that: what it becomes and how big it is.
 *
 * The clip is written by `runtime/lib/board.js` (`clipOfRange`, `clipOfElement`): a small tree of
 * the selection, `{ t, a?, c?, k? }` per element and a string per run of words, with what only the
 * page knows (sizes on screen, colours, a code block's language, a table's header row).
 */
import { CARD, MARKDOWN, MEDIA, type Op, type PenNode } from "@decks/pen";
import { LIVE_FILE } from "../../pen/file-kinds.ts";
import type { Pt } from "./model.ts";

/** The drag and clipboard type a board writes (`runtime/lib/board.js`). */
export const CLIP_MIME = "application/x-decks-clip";

/** A node of a picked-up selection: words, or an element with its tag, attributes, colour and children. */
export type Tree = string | { t: string; a?: Record<string, string>; c?: string; k?: Tree[] };

/** What a board says was picked up (`board.js`). Sizes are the board's pixels; `scale` is screen pixels per board pixel. */
export type Clip = {
	v: 1;
	board?: string;
	block?: string;
	scale?: number;
	fontSize?: number;
	colour?: string;
	/** The tags the selection sits inside, innermost first. */
	inside?: string[];
	lang?: string;
	tone?: string;
	callout?: boolean;
	/** A table's header row, when the selection is inside a table. */
	head?: Tree;
	width?: number;
	height?: number;
	/** Where in the selection's box the drag was picked up, in board pixels. */
	grab?: Pt;
	tree: Tree[];
};

/** A picture a part holds, as the board drew it. */
export type Picture = { kind: "image" | "svg" | "canvas" | "video" | "audio"; src?: string; path?: string; svg?: string; data?: string; alt: string; w: number; h: number; radius?: number };
/** A picture as the page placed it next to the canvas: the url the stage file writes, and for an SVG or a film what else it needs. */
export type Placed = { url: string; file?: string; still?: string; media?: { kind: "video" | "audio"; poster?: string; seconds?: number; peaks?: number[]; w?: number; h?: number } };

export type Part =
	| { kind: "text"; markdown: string }
	| { kind: "heading"; level: number; markdown: string }
	| { kind: "list" | "table" | "code" | "quote" | "rule"; markdown: string; lang?: string }
	| { kind: "picture"; picture: Picture };

// --- reading a tree ---------------------------------------------------------------

type El = Exclude<Tree, string>;
const isEl = (tree: Tree | undefined, ...tags: string[]): tree is El => typeof tree === "object" && tree !== null && (tags.length === 0 || tags.includes(tree.t));
const kids = (tree: Tree): Tree[] => (typeof tree === "string" ? [] : (tree.k ?? []));
const attr = (tree: Tree, name: string): string | undefined => (typeof tree === "string" ? undefined : tree.a?.[name]);

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const MEDIA_TAGS = ["img", "svg", "canvas", "video", "audio"];
const CONTAINERS = ["div", "section", "article", "main", "header", "footer", "aside", "figure", "nav", "details", "body", "html", "form", "center", "dl", "fieldset"];
const TEXTY = ["p", "figcaption", "dt", "dd", "caption", "summary", "legend", "address"];
const TABLE_PARTS = ["table", "thead", "tbody", "tfoot", "tr", "td", "th"];
const BLOCK = new Set([...HEADINGS, ...MEDIA_TAGS, ...CONTAINERS, ...TEXTY, ...TABLE_PARTS, "ul", "ol", "li", "pre", "blockquote", "hr"]);

/** Every word under a tree, as it reads. */
export function textOf(trees: readonly Tree[]): string {
	return trees.map((tree) => (typeof tree === "string" ? tree : tree.t === "br" ? "\n" : textOf(tree.k ?? []))).join("");
}

const hasBlock = (trees: readonly Tree[]): boolean => trees.some((tree) => isEl(tree) && (BLOCK.has(tree.t) || hasBlock(tree.k ?? [])));
const hasTag = (trees: readonly Tree[], tags: readonly string[]): boolean => trees.some((tree) => isEl(tree) && (tags.includes(tree.t) || hasTag(tree.k ?? [], tags)));
const isCallout = (tree: Tree) => /(?:^|\s)callout(?:\s|$)/.test(attr(tree, "class") ?? "");

// --- inline markdown ------------------------------------------------------------

/** Words as markdown that reads as those words: the characters that would mean something are escaped. */
export function escapeMarkdown(words: string): string {
	return words
		.replace(/[\\`*_[\]<]/g, (c) => `\\${c}`)
		.replace(/==/g, "\\=\\=")
		.replace(/~~/g, "\\~\\~");
}
/** A line that would start a block (a heading, a list, a quote) is kept a line of words. */
const keepLine = (line: string) => line.replace(/^(\s*)(#{1,6}\s|[-+>]\s|\d+[.)]\s)/, (_, space: string, mark: string) => `${space}\\${mark}`);

/** A colour by its family, as a card names them (`card-syntax.ts`, `COLOURS`), or nothing for a grey. */
export function colourName(hex: string | undefined): "red" | "orange" | "yellow" | "green" | "blue" | "purple" | undefined {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? "");
	if (!m) return undefined;
	const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((v) => parseInt(v, 16) / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	if (s < 0.3 || l < 0.15 || l > 0.9) return undefined;
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	h = (h * 60 + 360) % 360;
	if (h < 15 || h >= 335) return "red";
	if (h < 40) return "orange";
	if (h < 70) return "yellow";
	if (h < 170) return "green";
	if (h < 255) return "blue";
	return "purple";
}

/** Markers round words, with the spaces at their edges put outside, as markdown wants. */
function wrap(inner: string, open: string, close = open): string {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
	if (!m[2]) return inner;
	return `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

/** A run of inline trees as one line of markdown: bold, italic, links, inline code, struck, marked and coloured words kept. */
export function inlineMarkdown(trees: readonly Tree[], options: { pipes?: boolean } = {}): string {
	const one = (tree: Tree): string => {
		if (typeof tree === "string") {
			const words = escapeMarkdown(tree.replace(/\s+/g, " "));
			return options.pipes ? words.replace(/\|/g, "\\|") : words;
		}
		if (MEDIA_TAGS.includes(tree.t)) return "";
		if (tree.t === "br") return options.pipes ? " " : "\\\n";
		if (tree.t === "code" || tree.t === "kbd") {
			const raw = textOf(tree.k ?? []).replace(/\s+/g, " ");
			if (!raw.trim()) return raw;
			const ticks = "`".repeat(Math.max(1, ...[...raw.matchAll(/`+/g)].map((run) => run[0].length + 1)));
			const pad = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
			return `${ticks}${pad}${options.pipes ? raw.replace(/\|/g, "\\|") : raw}${pad}${ticks}`;
		}
		let inner = (tree.k ?? []).map(one).join("");
		switch (tree.t) {
			case "b":
			case "strong":
				inner = wrap(inner, "**");
				break;
			case "i":
			case "em":
			case "cite":
			case "dfn":
				inner = wrap(inner, "*");
				break;
			case "s":
			case "del":
			case "strike":
				inner = wrap(inner, "~~");
				break;
			case "u":
			case "ins":
				inner = wrap(inner, "<u>", "</u>");
				break;
			case "mark":
				inner = wrap(inner, "==");
				break;
			case "a": {
				const href = tree.a?.href;
				if (href && inner.trim() && !/^javascript:/i.test(href)) inner = wrap(inner, "[", `](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`);
				break;
			}
			default:
				if (tree.a?.bold) inner = wrap(inner, "**");
				if (tree.a?.italic) inner = wrap(inner, "*");
		}
		const colour = colourName(tree.c);
		if (colour && inner.trim()) inner = wrap(inner, "[", `]{.${colour}}`);
		return inner;
	};
	// Hard breaks (`\` at a line's end) split it into lines; each is tidied, and kept a line of words.
	return trees
		.map(one)
		.join("")
		.split("\\\n")
		.map((line) => keepLine(line.replace(/ {2,}/g, " ").trim()))
		.filter((line, i, all) => line || (i > 0 && i < all.length - 1))
		.join("\\\n")
		.trim();
}

// --- blocks -----------------------------------------------------------------------

/** A fenced block of code, its fence longer than any run of backticks in it. */
export function fence(code: string, lang = ""): string {
	const body = code.replace(/\r/g, "").replace(/\n+$/, "");
	const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((run) => run[0].length));
	const ticks = "`".repeat(longest + 1);
	return `${ticks}${lang.trim()}\n${body}\n${ticks}`;
}

/** A list as markdown: bullets or numbers, ticks for tasks, nested lists indented under their item. */
function listMarkdown(items: readonly Tree[], ordered: boolean, start = 1, indent = ""): string {
	const lines: string[] = [];
	let n = start;
	for (const item of items) {
		if (!isEl(item, "li")) continue;
		const marker = ordered ? `${n++}.` : "-";
		const task = item.a?.task !== undefined ? `[${item.a.task === "x" ? "x" : " "}] ` : "";
		const own = (item.k ?? []).filter((kid) => !isEl(kid, "ul", "ol"));
		// An item's paragraphs are one line of it.
		const words = inlineMarkdown(own.flatMap((kid) => (isEl(kid) && BLOCK.has(kid.t) ? [...(kid.k ?? []), " "] : [kid])));
		lines.push(`${indent}${marker} ${task}${words.replace(/\\\n/g, `\\\n${indent}${" ".repeat(marker.length + 1)}`)}`.trimEnd());
		for (const nested of (item.k ?? []).filter((kid) => isEl(kid, "ul", "ol"))) {
			const el = nested as El;
			lines.push(listMarkdown(el.k ?? [], el.t === "ol", Number(el.a?.start ?? 1) || 1, `${indent}${" ".repeat(marker.length + 1)}`));
		}
	}
	return lines.join("\n");
}

type Row = { cells: { md: string; col: number; align?: string }[]; head: boolean };

/** The rows of a table, or of the rows and cells picked out of one. */
function rowsOf(trees: readonly Tree[], inHead = false): Row[] {
	const rows: Row[] = [];
	let loose: Row | undefined;
	for (const tree of trees) {
		if (!isEl(tree)) continue;
		if (tree.t === "tr") {
			const cells = (tree.k ?? []).filter((kid) => isEl(kid, "td", "th")) as El[];
			if (!cells.length) continue;
			rows.push({ cells: cells.map(cellOf), head: inHead || cells.every((cell) => cell.t === "th") });
		} else if (tree.t === "td" || tree.t === "th") {
			if (!loose) rows.push((loose = { cells: [], head: inHead }));
			loose.cells.push(cellOf(tree));
			loose.head = loose.head || (tree.t === "th" && loose.cells.length === 1);
		} else if (tree.t === "thead") rows.push(...rowsOf(tree.k ?? [], true));
		else if (tree.t === "caption") continue;
		else rows.push(...rowsOf(tree.k ?? [], inHead));
	}
	return rows;
}
function cellOf(cell: El, at = 0): Row["cells"][number] {
	return { md: inlineMarkdown(cell.k ?? [], { pipes: true }) || " ", col: Number(cell.a?.col ?? at) || 0, ...(cell.a?.align ? { align: cell.a.align } : {}) };
}

/** A table as markdown: a header row (the table's own, `head`, or the first), a rule with its alignment, the rest. */
function tableMarkdown(rows: Row[], head?: Tree): string {
	if (!rows.length) return "";
	let header: Row | undefined = rows.find((row) => row.head);
	let body = rows.filter((row) => row !== header);
	if (!header && head) {
		const all = rowsOf([head], true)[0];
		if (all) {
			// The header cells over the columns picked: the first row says which.
			const cols = body[0]?.cells.map((cell) => cell.col) ?? [];
			const picked = cols.length && cols.length < all.cells.length ? cols.map((col) => all.cells.find((cell) => cell.col === col) ?? { md: " ", col }) : all.cells;
			header = { cells: picked, head: true };
		}
	}
	if (!header) {
		header = body[0]!;
		body = body.slice(1);
	}
	const width = Math.max(header.cells.length, ...body.map((row) => row.cells.length));
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	const pad = (row: Row) => Array.from({ length: width }, (_, i) => row.cells[i]?.md ?? " ");
	const rule = Array.from({ length: width }, (_, i) => {
		const align = header!.cells[i]?.align ?? body[0]?.cells[i]?.align;
		return align === "center" ? ":---:" : align === "right" ? "---:" : "---";
	});
	return [line(pad(header)), line(rule), ...body.map((row) => line(pad(row)))].join("\n");
}

const TONES: Record<string, string> = { warn: "warning", warning: "warning", danger: "danger", error: "danger", ok: "success", success: "success", info: "info", tip: "tip", note: "note" };
/** Parts as a quote, or as a callout of a kind when `tone` says one. */
function quoteMarkdown(parts: readonly Part[], callout: string | undefined): string {
	const body = parts.map(blockMarkdown).filter(Boolean).join("\n\n");
	const lines = body.split("\n").map((line) => (line ? `> ${line}` : ">"));
	return callout ? [`> [!${callout}]`, ...lines].join("\n") : lines.join("\n");
}

function pictureOf(tree: El): Picture | undefined {
	const a = tree.a ?? {};
	const kind = tree.t === "img" ? "image" : (tree.t as Picture["kind"]);
	const w = Number(a.w) || 0;
	const h = Number(a.h) || 0;
	if (kind === "image" && !a.src && !a.path) return undefined;
	if (kind === "svg" && !a.svg) return undefined;
	if (kind === "canvas" && !a.data) return undefined;
	if ((kind === "video" || kind === "audio") && !a.src && !a.path) return undefined;
	return {
		kind,
		alt: a.alt ?? "",
		w,
		h,
		...(a.src ? { src: a.src } : {}),
		...(a.path ? { path: a.path } : {}),
		...(a.svg ? { svg: a.svg } : {}),
		...(a.data ? { data: a.data } : {}),
		...(Number(a.radius) ? { radius: Number(a.radius) } : {}),
	};
}

/** The blocks under some trees, in order: the walk every selection and every piece of HTML takes. */
export function partsOfTrees(trees: readonly Tree[]): Part[] {
	const parts: Part[] = [];
	let words: Tree[] = [];
	const flush = () => {
		const markdown = inlineMarkdown(words);
		if (markdown) parts.push({ kind: "text", markdown });
		words = [];
	};
	for (let i = 0; i < trees.length; i++) {
		const tree = trees[i]!;
		if (!isEl(tree)) {
			words.push(tree);
			continue;
		}
		const t = tree.t;
		if (HEADINGS.includes(t)) {
			flush();
			const markdown = inlineMarkdown(tree.k ?? []);
			if (markdown) parts.push({ kind: "heading", level: Number(t[1]), markdown });
		} else if (MEDIA_TAGS.includes(t)) {
			flush();
			const picture = pictureOf(tree);
			if (picture) parts.push({ kind: "picture", picture });
		} else if (t === "pre") {
			flush();
			const code = textOf(tree.k ?? []);
			if (code.trim()) parts.push({ kind: "code", markdown: fence(code, tree.a?.lang ?? langOf(tree.a?.class)), ...(tree.a?.lang ? { lang: tree.a.lang } : {}) });
		} else if (t === "ul" || t === "ol") {
			flush();
			const markdown = listMarkdown(tree.k ?? [], t === "ol", Number(tree.a?.start ?? 1) || 1);
			if (markdown) parts.push({ kind: "list", markdown });
		} else if (t === "li") {
			// Items picked without their list: as many as come together, one list.
			flush();
			const run: Tree[] = [];
			while (i < trees.length && (isEl(trees[i], "li") || (typeof trees[i] === "string" && !(trees[i] as string).trim()))) run.push(trees[i++]!);
			i--;
			const markdown = listMarkdown(run, false);
			if (markdown) parts.push({ kind: "list", markdown });
		} else if (TABLE_PARTS.includes(t)) {
			flush();
			const run: Tree[] = [];
			while (i < trees.length && (isEl(trees[i], ...TABLE_PARTS) || (typeof trees[i] === "string" && !(trees[i] as string).trim()))) run.push(trees[i++]!);
			i--;
			const markdown = tableMarkdown(rowsOf(run));
			if (markdown) parts.push({ kind: "table", markdown });
		} else if (t === "blockquote" || isCallout(tree)) {
			flush();
			const inner = partsOfTrees(tree.k ?? []);
			const tone = tree.a?.tone ? (TONES[tree.a.tone] ?? "note") : isCallout(tree) ? "note" : undefined;
			if (inner.length) parts.push({ kind: "quote", markdown: quoteMarkdown(inner, tone) });
		} else if (t === "hr") {
			flush();
			parts.push({ kind: "rule", markdown: "---" });
		} else if (CONTAINERS.includes(t) || TEXTY.includes(t) || hasBlock(tree.k ?? [])) {
			flush();
			if (hasBlock(tree.k ?? [])) parts.push(...partsOfTrees(tree.k ?? []));
			else {
				words = [...(tree.k ?? [])];
				flush();
			}
		} else words.push(tree);
	}
	flush();
	return parts;
}

const langOf = (cls: string | undefined) => /(?:^|\s)lang(?:uage)?-([\w+#-]+)/.exec(cls ?? "")?.[1] ?? "";

/** The parts a board's clip holds, read with what the board said about where the selection sits. */
export function partsOfClip(clip: Clip): Part[] {
	const inside = clip.inside ?? [];
	const tree = clip.tree ?? [];
	// Inside one block of code: the words picked, as code, in its language.
	if (inside.includes("pre")) {
		const code = textOf(tree);
		return code.trim() ? [{ kind: "code", markdown: fence(code, clip.lang ?? ""), ...(clip.lang ? { lang: clip.lang } : {}) }] : [];
	}
	// Inside one heading: a heading, at its level.
	const heading = inside.find((tag) => HEADINGS.includes(tag));
	if (heading) {
		const markdown = inlineMarkdown(tree);
		return markdown ? [{ kind: "heading", level: Number(heading[1]), markdown }] : [];
	}
	// Rows or cells of a table: a table of those, with its header row over them.
	if (inside.includes("table") && hasTag(tree, ["tr", "td", "th"])) {
		const markdown = tableMarkdown(rowsOf(tree), clip.head);
		return markdown ? [{ kind: "table", markdown }] : [];
	}
	// Items picked out of a list: a list of those, numbered if it was.
	const list = inside.find((tag) => tag === "ul" || tag === "ol");
	if (list && tree.some((one) => isEl(one, "li"))) {
		const markdown = listMarkdown(tree, list === "ol");
		return markdown ? [{ kind: "list", markdown }] : [];
	}
	const parts = partsOfTrees(tree);
	// Inside a quote or a callout: still one, of the same kind.
	if ((inside.includes("blockquote") || clip.callout) && parts.length && parts.every((part) => part.kind !== "picture")) {
		const tone = clip.tone ? (TONES[clip.tone] ?? "note") : clip.callout ? "note" : undefined;
		return [{ kind: "quote", markdown: quoteMarkdown(parts, tone) }];
	}
	return parts;
}

/** HTML from another app, as the page parsed it into a tree. */
export const partsOfHtml = (trees: readonly Tree[]): Part[] => partsOfTrees(trees);

// --- text -------------------------------------------------------------------------

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^\s*([-*+]|\d+[.)])\s+/;
const QUOTE = /^\s{0,3}>/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * Text as parts. Markdown is read as markdown — `-` lists, `|` tables, fenced code, `#` headings,
 * `>` quotes — one part per block; `literal` reads every paragraph as words, nothing in it meaning
 * anything (⇧⌘V, paste as plain text).
 */
export function partsOfText(text: string, literal = false): Part[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const parts: Part[] = [];
	if (literal) {
		const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
		for (const paragraph of paragraphs) {
			const markdown = paragraph
				.split("\n")
				.map((line) => keepLine(escapeMarkdown(line.trim())))
				.filter(Boolean)
				.join("\\\n");
			if (markdown) parts.push({ kind: "text", markdown });
		}
		return parts;
	}
	const starts = (line: string) => FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || LIST.test(line) || line.trim().startsWith("|");
	for (let i = 0; i < lines.length; ) {
		const line = lines[i]!;
		if (!line.trim()) {
			i++;
			continue;
		}
		const fenced = FENCE.exec(line);
		if (fenced) {
			const mark = fenced[1]!;
			const body: string[] = [];
			i++;
			while (i < lines.length && !lines[i]!.trim().startsWith(mark)) body.push(lines[i++]!);
			i++;
			parts.push({ kind: "code", markdown: fence(body.join("\n"), fenced[2] ?? ""), ...(fenced[2] ? { lang: fenced[2] } : {}) });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			parts.push({ kind: "heading", level: heading[1]!.length, markdown: heading[2]! });
			i++;
			continue;
		}
		if (RULE.test(line)) {
			parts.push({ kind: "rule", markdown: "---" });
			i++;
			continue;
		}
		if (line.trim().startsWith("|") || (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? ""))) {
			const rows: string[] = [];
			while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(lines[i++]!.trim());
			parts.push({ kind: "table", markdown: rows.join("\n") });
			continue;
		}
		if (QUOTE.test(line)) {
			const rows: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i]!)) rows.push(lines[i++]!);
			parts.push({ kind: "quote", markdown: rows.join("\n") });
			continue;
		}
		if (LIST.test(line)) {
			const rows: string[] = [];
			while (i < lines.length) {
				const row = lines[i]!;
				if (row.trim() && (LIST.test(row) || /^\s+\S/.test(row))) rows.push(lines[i++]!);
				else if (!row.trim()) {
					// A blank line inside a list goes on when the next line is an item or indented under one.
					let next = i + 1;
					while (next < lines.length && !lines[next]!.trim()) next++;
					if (next < lines.length && (LIST.test(lines[next]!) || /^\s+\S/.test(lines[next]!))) i = next;
					else break;
				} else break;
			}
			parts.push({ kind: "list", markdown: rows.join("\n") });
			continue;
		}
		const rows: string[] = [];
		while (i < lines.length && lines[i]!.trim() && (rows.length === 0 || !starts(lines[i]!))) rows.push(lines[i++]!.trim());
		parts.push({ kind: "text", markdown: rows.join("\n") });
	}
	return parts;
}

// --- landing ----------------------------------------------------------------------

/**
 * A card's spacing and corner, and the text tool's size: the same numbers as `pen/card-frame.ts`
 * (`CARD_GAP`, `CARD_PAD`, `CARD_RADIUS`) and `ops.ts` (`MADE.text`), which core cannot import.
 */
export const CARD_GAP = 16;
export const CARD_PAD = 20;
export const CARD_RADIUS = 12;
export const CARD_FONT = 16;
const TEXT_FONT = 24;
/** How much bigger the engine draws each heading level than its words (`pen/look.ts`, `HEADING_SIZE`). */
const HEADING_SIZE = [1.6, 1.3, 1.12, 1, 0.9, 0.85];
/** A card is never wider than this, however wide the table in it was. */
export const CARD_MAX_W = 900;
const CARD_MIN_W = 200;

/** One block's markdown, as a card block holds it. */
export function blockMarkdown(part: Part): string {
	if (part.kind === "heading") return `${"#".repeat(part.level)} ${part.markdown}`;
	if (part.kind === "picture") return "";
	return part.markdown;
}

/** What a landing makes, for the drag's label: a text item, a card of what, an image item. */
export type Landing = { kind: "text" | "card" | "image" | "svg" | "media" | "none"; label: string; w: number; h: number };

/** How the page sizes and places what lands. */
export type LandOptions = {
	/** Stage pixels per board pixel: the board's zoom on screen over the canvas's. 1 for what came from no board. */
	k: number;
	/** The words' size on the board, in its pixels; none for text from elsewhere. */
	fontSize?: number;
	/** How wide the selection was on the board, in its pixels. */
	width?: number;
	height?: number;
	/** Where the item came from, kept in its metadata for "Open in board". */
	source?: { board: string; block?: string };
};

const round = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** What the parts land as, before any picture is placed: the preview's label and size, in stage pixels. */
export function landingOf(parts: readonly Part[], options: LandOptions): Landing {
	const real = parts.filter((part) => part.kind !== "rule" || parts.length === 1);
	if (!real.length) return { kind: "none", label: "nothing to put down", w: 0, h: 0 };
	const k = options.k;
	if (real.length === 1) {
		const only = real[0]!;
		if (only.kind === "picture") {
			const p = only.picture;
			const kind = p.kind === "svg" ? "svg" : p.kind === "video" || p.kind === "audio" ? "media" : "image";
			const label = kind === "svg" ? "image item, SVG" : kind === "media" ? `${p.kind === "video" ? "video" : "sound"} player` : "image item";
			return { kind, label, w: round((p.w || 320) * k), h: round((p.h || 200) * k) };
		}
		if (only.kind === "text" || only.kind === "heading") {
			const { w, fontSize } = textSize(only, options);
			const lines = Math.max(1, Math.ceil((only.markdown.length * fontSize * 0.5) / Math.max(40, w)));
			const h = options.height ? round(options.height * k) : round(lines * fontSize * (only.kind === "heading" ? HEADING_SIZE[only.level - 1]! * 1.3 : 1.5));
			return { kind: "text", label: only.kind === "heading" ? "text item, heading" : "text item", w, h };
		}
	}
	const w = cardWidth(real, options);
	const h = options.height ? round(options.height * k + CARD_PAD * 2) : estimateCard(real, w, cardFont(options));
	const only = real.length === 1 ? real[0]! : undefined;
	const what = only ? (only.kind === "code" ? `code${only.lang ? `, ${only.lang}` : ""}` : only.kind === "quote" ? (/^> \[!/.test(only.markdown) ? "callout" : "quote") : only.kind === "picture" ? "picture" : only.kind) : `${real.length} parts`;
	return { kind: "card", label: `card · ${what}`, w, h };
}

function textSize(part: Part & { markdown: string }, options: LandOptions): { w: number; fontSize: number } {
	const k = options.k;
	const level = part.kind === "heading" ? (part as { level: number }).level : 0;
	const scale = level ? HEADING_SIZE[level - 1]! : 1;
	const fontSize = options.fontSize ? clamp(round((options.fontSize * k) / scale), 8, 200) : TEXT_FONT;
	// The engine's face is not the board's: a little room, so words measured on the board still fit on their lines.
	const w = options.width ? Math.max(24, round(options.width * k * 1.06 + 8)) : part.markdown.length * fontSize * scale * 0.55 > 480 ? 480 : 320;
	return { w, fontSize };
}
const cardFont = (options: LandOptions) => (options.fontSize ? clamp(round(options.fontSize * options.k), 10, 64) : CARD_FONT);
function cardWidth(parts: readonly Part[], options: LandOptions): number {
	if (options.width) return clamp(round(options.width * options.k) + CARD_PAD * 2, CARD_MIN_W, CARD_MAX_W);
	return parts.some((part) => part.kind === "table" || part.kind === "code") ? 480 : 320;
}
function estimateCard(parts: readonly Part[], w: number, font: number): number {
	const inner = w - CARD_PAD * 2;
	let h = CARD_PAD * 2 + CARD_GAP * (parts.length - 1);
	for (const part of parts) {
		if (part.kind === "picture") h += part.picture.w ? (Math.min(inner, part.picture.w) * part.picture.h) / Math.max(1, part.picture.w) : inner * 0.5625;
		else {
			const md = blockMarkdown(part);
			const rows = md.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * font * 0.5) / Math.max(40, inner))), 0);
			h += rows * font * 1.5;
		}
	}
	return round(h);
}

/** A card block: pen's text, as wide as the card, its words markdown (`pen/card-frame.ts`, `markdownText`). */
const block = (content: string, fontSize: number, metadata: Record<string, unknown> = {}): PenNode =>
	({ type: "text", id: "", content, fontSize, textGrowth: "fixed-width", width: "fill_container", metadata: { type: MARKDOWN, ...metadata } }) as PenNode;

/** A picture as an item: an image, an SVG shown live, a film or a sound; `undefined` when the page could not place it. */
function pictureNode(picture: Picture, placed: Placed | undefined, w: number, h: number, metadata: Record<string, unknown>): PenNode | undefined {
	if (!placed) return undefined;
	const name = picture.alt || (placed.file ?? placed.url).split("/").pop() || "Picture";
	const radius = picture.radius ? { cornerRadius: picture.radius } : {};
	if (picture.kind === "svg" && placed.file) {
		return { type: "rectangle", id: "", name, width: w, height: h, ...(placed.still ? { fill: { type: "image", url: placed.url, mode: "fill" } } : {}), metadata: { type: LIVE_FILE, kind: "svg", file: placed.file, ...(placed.still ? { still: placed.still } : {}), ...metadata } } as PenNode;
	}
	if ((picture.kind === "video" || picture.kind === "audio") && placed.media && placed.file) {
		const facts = placed.media;
		return {
			type: "rectangle",
			id: "",
			name,
			cornerRadius: picture.radius ?? 8,
			...(facts.poster ? { fill: { type: "image", url: placed.url, mode: "fill" } } : { fill: "#1f2328" }),
			metadata: { type: MEDIA, kind: facts.kind, file: placed.file, ...(facts.poster ? { poster: facts.poster } : {}), ...(facts.seconds === undefined ? {} : { seconds: facts.seconds }), ...(facts.peaks ? { peaks: facts.peaks } : {}), ...metadata },
			width: w,
			height: h,
		} as PenNode;
	}
	return { type: "rectangle", id: "", name, width: w, height: h, ...radius, fill: { type: "image", url: placed.url, mode: "fill" }, ...(Object.keys(metadata).length ? { metadata } : {}) } as PenNode;
}

/** A film's or a sound's box: a sound is a strip, a film keeps its shape. */
function pictureBox(picture: Picture, placed: Placed | undefined, k: number, cap?: number): { w: number; h: number } {
	if (picture.kind === "audio") return { w: round(clamp(picture.w * k || 420, 240, cap ?? 600)), h: 72 };
	let w = round((picture.w || placed?.media?.w || 320) * k);
	let h = round((picture.h || placed?.media?.h || 200) * k);
	if (cap && w > cap) {
		h = round((h * cap) / w);
		w = round(cap);
	}
	return { w: Math.max(8, w), h: Math.max(8, h) };
}

/** Where a drop or a paste goes into a card: the card, the slot among its blocks, how wide its words are. */
export type IntoCard = { card: string; index: number; inner: number };

/**
 * The ops of one `canvas.batch` for what lands: one new item with its top-left corner at `at` (a
 * text, a card, a picture), or, `into` a card, its blocks at the slot. `placed` answers for each
 * picture where the page put it; one it did not place is left out. `id` is the new item's.
 */
export function landOps(parts: readonly Part[], options: LandOptions & { at: Pt; id: string; placed: (picture: Picture) => Placed | undefined; into?: IntoCard }): Op[] {
	const real = parts.filter((part) => part.kind !== "rule" || parts.length === 1);
	if (!real.length) return [];
	const source = options.source ? { source: options.source } : {};
	const k = options.k;
	const font = cardFont(options);
	const blocks = (inner: number): PenNode[] =>
		real.flatMap((part) => {
			if (part.kind !== "picture") return [block(blockMarkdown(part), font)];
			const placed = options.placed(part.picture);
			const box = pictureBox(part.picture, placed, k, inner);
			const node = pictureNode(part.picture, placed, box.w, box.h, {});
			return node ? [node] : [];
		});

	if (options.into) {
		const into = options.into;
		return blocks(into.inner).map((node, i) => ({ op: "insert", parent: into.card, index: into.index + i, node: { ...node, ...(node.type === "text" ? { metadata: { ...(node.metadata ?? {}), ...source } } : {}) } }) as Op);
	}

	const x1 = round(options.at.x);
	const y1 = round(options.at.y);
	if (real.length === 1) {
		const only = real[0]!;
		if (only.kind === "picture") {
			const placed = options.placed(only.picture);
			const box = pictureBox(only.picture, placed, k);
			const node = pictureNode(only.picture, placed, box.w, box.h, source);
			return node ? [{ op: "insert", node: { ...node, id: options.id }, box: { x1, y1, x2: x1 + box.w, y2: y1 + box.h } } as Op] : [];
		}
		if (only.kind === "text" || only.kind === "heading") {
			const { w, fontSize } = textSize(only, options);
			const node = { type: "text", id: options.id, content: blockMarkdown(only), fontSize, textGrowth: "fixed-width", width: w, metadata: { type: MARKDOWN, ...source } } as PenNode;
			return [{ op: "insert", node, box: { x1, y1, x2: x1 + w } } as Op];
		}
	}
	const w = cardWidth(real, options);
	const children = blocks(w - CARD_PAD * 2);
	if (!children.length) return [];
	const card = { type: "frame", id: options.id, name: "Card", layout: "vertical", gap: CARD_GAP, padding: CARD_PAD, cornerRadius: CARD_RADIUS, metadata: { type: CARD, ...source }, children } as PenNode;
	return [{ op: "insert", node: card, box: { x1, y1, x2: x1 + w } } as Op];
}

/** Every picture the parts hold, for the page to place before `landOps`. */
export const picturesOf = (parts: readonly Part[]): Picture[] => parts.flatMap((part) => (part.kind === "picture" ? [part.picture] : []));

/** A clip off a drag or the clipboard, or nothing when it is not one. */
export function readClip(json: string | undefined | null): Clip | undefined {
	if (!json) return undefined;
	try {
		const clip = JSON.parse(json) as Clip;
		return clip && clip.v === 1 && Array.isArray(clip.tree) ? clip : undefined;
	} catch {
		return undefined;
	}
}

/** What a clip lands as, with its sizes: the options `landingOf` and `landOps` take, at the canvas's zoom. */
export function clipOptions(clip: Clip, zoom: number): LandOptions {
	return {
		k: (clip.scale || 1) / Math.max(0.01, zoom),
		...(clip.fontSize ? { fontSize: clip.fontSize } : {}),
		...(clip.width ? { width: clip.width } : {}),
		...(clip.height ? { height: clip.height } : {}),
		...(clip.board ? { source: { board: clip.board, ...(clip.block ? { block: clip.block } : {}) } } : {}),
	};
}
