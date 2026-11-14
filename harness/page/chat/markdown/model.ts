/** Markdown, parsed to a tree the app builds elements from, never to HTML. */

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "strong"; spans: Inline[] }
	| { kind: "em"; spans: Inline[] }
	| { kind: "strike"; spans: Inline[] }
	| { kind: "link"; href: string; spans: Inline[] };

/** One line of a list, and how far in it sits. */
export interface ListItem {
	spans: Inline[];
	depth: number;
}

/** A column's alignment, from the `:` in its divider cell. `null` is "whatever the text is". */
export type Align = "left" | "center" | "right" | null;

/** One cell, parsed. A row is cells and a table is rows; there is nothing else to a table. */
export type TableCell = Inline[];

export type Block =
	| { kind: "paragraph"; spans: Inline[] }
	| { kind: "heading"; level: number; spans: Inline[] }
	| { kind: "code"; text: string; lang: string }
	| { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
	| { kind: "quote"; spans: Inline[] }
	| { kind: "table"; align: Align[]; head: TableCell[]; rows: TableCell[][] }
	| { kind: "rule" };

/** How deep a nested list item is allowed to get before it stops indenting. */
const MAX_DEPTH = 3;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
/** The `|---|:--:|` line, which is what turns the row above it into a header. */
const DIVIDER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** A row written with both outer pipes, which is what makes a one-column table unambiguous. */
const PIPED = /^[ \t]*\|.*\|[ \t]*$/;

/** A reply, as blocks. */
export function blocks(text: string): Block[] {
	const out: Block[] = [];
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	let paragraph: string[] = [];
	const flush = () => {
		if (paragraph.length === 0) return;
		out.push({ kind: "paragraph", spans: inline(paragraph.join("\n")) });
		paragraph = [];
	};
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (!line.trim()) {
			flush();
			continue;
		}
		const found = blockAt(lines, i);
		if (!found) {
			paragraph.push(line);
			continue;
		}
		flush();
		out.push(found.block);
		i = found.end;
	}
	flush();
	return out;
}

/** The block that starts at a line, with the index of its last line; nothing for a paragraph's line. */
function blockAt(lines: string[], i: number): { block: Block; end: number } | undefined {
	const line = lines[i] ?? "";
	const fence = FENCE.exec(line);
	if (fence) return fenceAt(lines, i, fence[1]!, fence[2] ?? "");
	// Before the bullet rule, because `---` and `***` match both and mean this.
	if (RULE.test(line)) return { block: { kind: "rule" }, end: i };
	const heading = HEADING.exec(line);
	if (heading) return { block: { kind: "heading", level: heading[1]!.length, spans: inline(heading[2] ?? "") }, end: i };
	if (QUOTE.test(line)) return quoteAt(lines, i);
	if (BULLET.test(line) || ORDERED.test(line)) return listAt(lines, i);
	// A table, and only once its divider has arrived.
	return tableAt(lines, i);
}

/** A fenced code block, to its closing fence of the same character, or to the end. */
function fenceAt(lines: string[], at: number, marker: string, lang: string): { block: Block; end: number } {
	const char = marker[0]!;
	const body: string[] = [];
	let i = at + 1;
	while (i < lines.length) {
		const candidate = (lines[i] ?? "").trim();
		if (candidate.length >= marker.length && candidate === char.repeat(candidate.length)) break;
		body.push(lines[i] ?? "");
		i += 1;
	}
	return { block: { kind: "code", text: body.join("\n"), lang }, end: i };
}

/** A quote: this line and every quoted line after it. */
function quoteAt(lines: string[], at: number): { block: Block; end: number } {
	const body = [QUOTE.exec(lines[at] ?? "")?.[1] ?? ""];
	let i = at;
	while (i + 1 < lines.length) {
		const next = QUOTE.exec(lines[i + 1] ?? "");
		if (!next) break;
		body.push(next[1] ?? "");
		i += 1;
	}
	return { block: { kind: "quote", spans: inline(body.join("\n")) }, end: i };
}

/** A list: bulleted or numbered as its first line is, while the lines after it are list lines. */
function listAt(lines: string[], at: number): { block: Block; end: number } {
	const line = lines[at] ?? "";
	const ordered = ORDERED.test(line);
	const items: ListItem[] = [];
	let i = at;
	for (;;) {
		const current = lines[i] ?? "";
		const match = (ordered ? ORDERED.exec(current) : BULLET.exec(current)) ?? BULLET.exec(current) ?? ORDERED.exec(current);
		if (!match) break;
		items.push({ spans: inline(match[3] ?? ""), depth: depthOf(match[1] ?? "") });
		if (i + 1 >= lines.length) break;
		const next = lines[i + 1] ?? "";
		if (!BULLET.test(next) && !ORDERED.test(next)) break;
		i += 1;
	}
	const start = ordered ? Number(ORDERED.exec(line)?.[2] ?? 1) : 1;
	return { block: { kind: "list", ordered, start, items }, end: i };
}

/** The table starting at `at`, or nothing, with the index of its last line. */
function tableAt(lines: string[], at: number): { block: Block; end: number } | undefined {
	const header = lines[at] ?? "";
	const divider = lines[at + 1] ?? "";
	if (!header.includes("|") || !DIVIDER.test(divider)) return undefined;
	const head = cellsOf(header);
	const align = cellsOf(divider).map((cell): Align => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		return left && right ? "center" : right ? "right" : left ? "left" : null;
	});
	// One column is a table only when it is written with both outer pipes. Without that,
	// `a` over `---` is a paragraph and a rule, which is what it almost always is.
	if (align.length !== head.length || (head.length < 2 && !PIPED.test(header))) return undefined;

	const rows: TableCell[][] = [];
	let end = at + 1;
	while (end + 1 < lines.length) {
		const next = lines[end + 1] ?? "";
		if (!next.trim() || !next.includes("|")) break;
		end += 1;
		const cells = cellsOf(next).slice(0, head.length);
		while (cells.length < head.length) cells.push("");
		rows.push(cells.map((cell) => inline(cell)));
	}
	return { block: { kind: "table", align, head: head.map((cell) => inline(cell)), rows }, end };
}

/** A row split into cells, on unescaped pipes. */
function cellsOf(line: string): string[] {
	const out: string[] = [];
	let current = "";
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i] ?? "";
		if (char === "\\" && line[i + 1] === "|") {
			current += "|";
			i += 1;
			continue;
		}
		if (char === "|") {
			out.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	out.push(current);
	if (out.length > 1 && !out[0]!.trim()) out.shift();
	if (out.length > 1 && !out.at(-1)!.trim()) out.pop();
	return out.map((cell) => cell.trim());
}

/** Leading whitespace as a nesting level. A tab is four columns, the way everything else is. */
function depthOf(indent: string): number {
	const columns = indent.replace(/\t/g, "    ").length;
	return Math.min(MAX_DEPTH, Math.floor(columns / 2));
}

/** A run of text, as spans. */
export function inline(text: string): Inline[] {
	const spans: Inline[] = [];
	let buffer = "";

	const flushText = () => {
		if (!buffer) return;
		spans.push({ kind: "text", text: buffer });
		buffer = "";
	};
	const push = (span: Inline) => {
		flushText();
		spans.push(span);
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i]!;

		// An escape is the next character, literally, this is how a reply writes an asterisk.
		if (ch === "\\" && i + 1 < text.length) {
			buffer += text[i + 1];
			i += 2;
			continue;
		}

		// Code wins over everything: nothing inside backticks is markup.
		if (ch === "`") {
			const run = /^`+/.exec(text.slice(i))![0];
			const close = text.indexOf(run, i + run.length);
			if (close !== -1) {
				push({ kind: "code", text: text.slice(i + run.length, close).trim() });
				i = close + run.length;
				continue;
			}
		}

		if (ch === "[") {
			const link = matchLink(text, i);
			if (link) {
				// An unsafe or unparseable target stays the text it was, brackets and all, // silently dropping it would hide from the reader that a link was written.
				if (link.href) push({ kind: "link", href: link.href, spans: inline(link.label) });
				else buffer += text.slice(i, link.end);
				i = link.end;
				continue;
			}
		}

		const opened = openEmphasis(text, i);
		if (opened) {
			push({ kind: opened.kind, spans: inline(text.slice(i + opened.marker.length, opened.close)) });
			i = opened.close + opened.marker.length;
			continue;
		}

		buffer += ch;
		i += 1;
	}

	flushText();
	return spans;
}

/** The emphasis markers, longest first so `` is never read as two `*`. */
const MARKERS = [
	{ marker: "**", kind: "strong" as const },
	{ marker: "~~", kind: "strike" as const },
	{ marker: "*", kind: "em" as const },
];

function openEmphasis(text: string, at: number): { marker: string; kind: "strong" | "em" | "strike"; close: number } | undefined {
	for (const { marker, kind } of MARKERS) {
		if (!text.startsWith(marker, at)) continue;
		// Emphasis opens on content, not on a space: `2 * 3 * 4` is arithmetic.
		const after = text[at + marker.length];
		if (after === undefined || /\s/.test(after)) continue;
		const close = findClose(text, at + marker.length, marker);
		if (close === -1) continue;
		return { marker, kind, close };
	}
	return undefined;
}

function findClose(text: string, from: number, marker: string): number {
	const char = marker[0]!;
	let i = from;
	while (i < text.length) {
		const ch = text[i]!;
		if (ch === "\\") {
			i += 2;
			continue;
		}
		// Skip whole code spans, so a marker inside one cannot close emphasis outside it.
		if (ch === "`") {
			const run = /^`+/.exec(text.slice(i))![0];
			const close = text.indexOf(run, i + run.length);
			i = close === -1 ? i + run.length : close + run.length;
			continue;
		}
		if (text.startsWith(marker, i) && i > from) {
			// It does not close on a space either, for the same reason it does not open on one.
			if (/\s/.test(text[i - 1] ?? " ")) {
				i += marker.length;
				continue;
			}
			/* Close at the *end* of the marker run, not its start. */
			const run = /^\*+|^~+/.exec(text.slice(i))?.[0]?.length ?? marker.length;
			return run > marker.length && text[i] === char ? i + (run - marker.length) : i;
		}
		i += 1;
	}
	return -1;
}

/** `[label](target)`, with the label allowed its own markup and the target checked. */
function matchLink(text: string, at: number): { label: string; href: string | undefined; end: number } | undefined {
	let depth = 0;
	let i = at;
	for (; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (ch === "[") depth += 1;
		if (ch === "]") {
			depth -= 1;
			if (depth === 0) break;
		}
		if (ch === "\n") return undefined;
	}
	if (depth !== 0 || text[i + 1] !== "(") return undefined;
	const close = text.indexOf(")", i + 2);
	if (close === -1) return undefined;
	const target = text.slice(i + 2, close);
	if (/\s/.test(target.trim())) return undefined;
	return { label: text.slice(at + 1, i), href: safeHref(target), end: close + 1 };
}

/** A link target a click can safely follow, or nothing. */
function safeHref(raw: string): string | undefined {
	const href = raw.trim();
	if (!href) return undefined;
	return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(href) ? href : undefined;
}
