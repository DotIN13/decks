import { spliceDiff } from "../merge.ts";
import { blocksOfDoc, parseMarkdown, plain } from "./markdown.ts";
import { OBJECT, type Block, type DocsDocument, type DocsRequest, type DocsTextStyle, type Para, type Run, type Style } from "./types.ts";

/**
 * The edits that turn a Google Doc into what a page's markdown says, as `batchUpdate` requests.
 *
 * Both are read into blocks (`markdown.ts`) and lined up by their text, so a paragraph that only
 * changed is edited in place rather than deleted and written again: its characters by the
 * smallest insertions and deletions, then only the styles that differ, then its heading level
 * and bullets. Paragraphs only in the markdown are inserted; ones only in the Doc are deleted.
 *
 * Requests run in order and each moves the indices after it, so they are made from the end of
 * the Doc towards the start: every request's index is still where the Doc had it when read.
 * What the page cannot write (pictures, section breaks, a table's shape) is left as the Doc has it.
 */

type Region = { at: number; requests: DocsRequest[] };

const NAMED = ["NORMAL_TEXT", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"];

/** Requests turning `doc` into what `markdown` says; empty when they already mean the same. */
export function plan(doc: DocsDocument, markdown: string): DocsRequest[] {
	return planBlocks(blocksOfDoc(doc), parseMarkdown(markdown), bodyEnd(doc));
}

export function bodyEnd(doc: DocsDocument): number {
	const content = doc.body?.content ?? [];
	return content[content.length - 1]?.endIndex ?? 1;
}

const keyOf = (block: Block) => (block.kind === "p" ? `p:${plain(block.runs)}` : block.kind === "table" ? `t:${block.rows.map((r) => r.map((c) => plain(c.runs)).join("|")).join("\n")}` : `a:${block.md}`);

export function planBlocks(have: readonly Block[], want: readonly Block[], end: number): DocsRequest[] {
	// Lined up by text: the longest run of blocks in order that read the same.
	const n = have.length;
	const m = want.length;
	const hk = have.map(keyOf);
	const wk = want.map(keyOf);
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = hk[i] === wk[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
	const pairs: Array<[number, number]> = [];
	for (let i = 0, j = 0; i < n && j < m; ) {
		if (hk[i] === wk[j]) pairs.push([i++, j++]);
		else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
		else j++;
	}
	const regions: Region[] = [];
	let hi = 0;
	let wi = 0;
	const gap = (hEnd: number, wEnd: number) => {
		const hs = have.slice(hi, hEnd);
		const ws = want.slice(wi, wEnd);
		// Within a gap, blocks of the same kind pair up in order and are edited; the rest are inserted or deleted.
		let k = 0;
		const paired = Math.min(hs.length, ws.length);
		for (; k < paired && hs[k]!.kind === ws[k]!.kind; k++) regions.push(update(hs[k]!, ws[k]!));
		const prev = hi + k > 0 ? have[hi + k - 1] : undefined;
		const next = hEnd < n ? have[hEnd] : undefined;
		if (k < ws.length) regions.push(insert(ws.slice(k), hs[k] ?? next, prev, end));
		for (const block of hs.slice(k)) regions.push(remove(block, end));
		hi = hEnd;
		wi = wEnd;
	};
	for (const [i, j] of pairs) {
		gap(i, j);
		regions.push(update(have[i]!, want[j]!));
		hi = i + 1;
		wi = j + 1;
	}
	gap(n, m);
	// From the end of the Doc to the start; a stable sort keeps a region's own order.
	return regions
		.map((region, order) => ({ ...region, order }))
		.sort((a, b) => b.at - a.at || b.order - a.order)
		.flatMap((r) => r.requests);
}

// -- a block edited in place ------------------------------------------------------------------

function update(have: Block, want: Block): Region {
	const at = have.start ?? 0;
	if (have.kind === "p" && want.kind === "p") return { at, requests: paraRequests(have, want) };
	if (have.kind === "table" && want.kind === "table") {
		const requests: DocsRequest[] = [];
		// Cell text only, last cell first; a table that changed shape keeps the Doc's shape.
		const cells = have.rows.flatMap((row, r) => row.map((cell, c) => ({ cell, want: want.rows[r]?.[c] })));
		for (const { cell, want: w } of cells.reverse()) {
			if (!w || cell.multi || cell.start === undefined) continue;
			requests.push(...textRequests(cell.start, cell.runs, w.runs).requests);
		}
		return { at, requests };
	}
	return { at, requests: [] };
}

function paraRequests(have: Para, want: Para): DocsRequest[] {
	const start = have.start ?? 0;
	const { requests, length } = textRequests(start, have.runs, want.runs);
	const range = { startIndex: start, endIndex: start + Math.max(1, length) };
	if (have.level !== want.level) requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: NAMED[want.level] ?? "NORMAL_TEXT" }, fields: "namedStyleType" } });
	requests.push(...bulletRequests(start, length, have.bullet, want.bullet));
	return requests;
}

function bulletRequests(start: number, length: number, have: Para["bullet"], want: Para["bullet"]): DocsRequest[] {
	if (!have && !want) return [];
	if (have && want && have.ordered === want.ordered && have.nest === want.nest) return [];
	const requests: DocsRequest[] = [];
	const range = { startIndex: start, endIndex: start + Math.max(1, length) };
	if (have) requests.push({ deleteParagraphBullets: { range } });
	if (want) {
		// Leading tabs are how a new bullet is given its depth; Docs takes them out as it makes it.
		if (want.nest > 0) requests.push({ insertText: { location: { index: start }, text: "\t".repeat(want.nest) } });
		requests.push({ createParagraphBullets: { range: { startIndex: start, endIndex: start + Math.max(1, length) + want.nest }, bulletPreset: want.ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } });
	}
	return requests;
}

type Char = Style & { ch: string; atom?: boolean };

function charsOf(runs: readonly Run[]): Char[] {
	const out: Char[] = [];
	for (const run of runs) {
		const { text, atom, ...style } = run;
		if (atom !== undefined) out.push({ ch: OBJECT, atom: true });
		// By UTF-16 unit, as Docs counts its indices.
		else for (let i = 0; i < text.length; i++) out.push({ ch: text[i]!, ...style });
	}
	return out;
}

const styleOnly = (c: Char | undefined): Style => {
	const out: Style = {};
	if (!c || c.atom) return out;
	if (c.bold) out.bold = true;
	if (c.italic) out.italic = true;
	if (c.strike) out.strike = true;
	if (c.code) out.code = true;
	if (c.link) out.link = c.link;
	return out;
};

/**
 * A run of text made to read as `want`: the fewest insertions and deletions, then a style set
 * only where a character's style differs from what it will have. Inserted text takes the style
 * of the character before it, as Docs gives it, so typing inside bold needs no style at all.
 * A picture in the markdown that the Doc lacks cannot be typed in, and is left out.
 * `length` is the text's length in the Doc afterwards.
 */
export function textRequests(start: number, have: readonly Run[], want: readonly Run[]): { requests: DocsRequest[]; length: number } {
	const before = charsOf(have);
	const after = charsOf(want);
	const splices = spliceDiff(before.map((c) => c.ch).join(""), after.map((c) => c.ch).join(""));
	// Walk both texts together: what each character of the result will look like, and what it should.
	const result: Char[] = [];
	const wanted: Char[] = [];
	const placed: Array<{ at: number; remove: number; text: string }> = [];
	let shift = 0;
	let b = 0;
	let a = 0;
	for (const s of splices) {
		const at = s.at - shift;
		shift += s.text.length - s.before.length;
		while (b < at) {
			result.push(before[b++]!);
			wanted.push(after[a++]!);
		}
		b = at + s.before.length;
		const left = result[result.length - 1] ?? before[b];
		let text = "";
		for (let k = 0; k < s.text.length; k++) {
			const c = after[a++]!;
			if (c.atom) continue;
			result.push({ ...styleOnly(left), ch: c.ch });
			wanted.push(c);
			text += c.ch;
		}
		placed.push({ at, remove: s.before.length, text });
	}
	while (b < before.length) {
		result.push(before[b++]!);
		wanted.push(after[a++]!);
	}
	const requests: DocsRequest[] = [];
	// The last splice first, so each index is still where the Doc had it.
	for (const p of placed.reverse()) {
		if (p.remove) requests.push({ deleteContentRange: { range: { startIndex: start + p.at, endIndex: start + p.at + p.remove } } });
		if (p.text) requests.push({ insertText: { location: { index: start + p.at }, text: p.text } });
	}
	requests.push(...styleRequests(start, result, wanted));
	return { requests, length: result.length };
}

const FIELDS = [
	{ key: "bold", field: "bold", blankSafe: true },
	{ key: "italic", field: "italic", blankSafe: true },
	{ key: "strike", field: "strikethrough", blankSafe: true },
	{ key: "code", field: "weightedFontFamily", blankSafe: false },
	{ key: "link", field: "link", blankSafe: false },
] as const;

function textStyleOf(key: (typeof FIELDS)[number]["key"], c: Char): DocsTextStyle {
	if (key === "bold") return { bold: !!c.bold };
	if (key === "italic") return { italic: !!c.italic };
	if (key === "strike") return { strikethrough: !!c.strike };
	if (key === "code") return c.code ? { weightedFontFamily: { fontFamily: "Courier New" } } : {};
	return c.link ? { link: { url: c.link } } : {};
}

/** For each style, the spans where the result is not what is wanted, set to what is wanted. */
function styleRequests(start: number, result: readonly Char[], wanted: readonly Char[]): DocsRequest[] {
	const requests: DocsRequest[] = [];
	const length = Math.min(result.length, wanted.length);
	for (const f of FIELDS) {
		const value = (c: Char | undefined) => (f.key === "link" ? (c?.link ?? "") : !!c?.[f.key]);
		// A style on a space at a span's edge is invisible and markdown cannot put it there, so it never counts; inside a span it does.
		const blank = (i: number) => /\s/.test(wanted[i]!.ch);
		const near = (i: number, step: number) => {
			for (let k = i + step; k >= 0 && k < length; k += step) if (!blank(k)) return value(wanted[k]);
			return undefined;
		};
		const differs = (i: number) => !wanted[i]!.atom && value(result[i]) !== value(wanted[i]) && !(f.blankSafe && blank(i) && !(near(i, -1) === value(wanted[i]) && near(i, 1) === value(wanted[i])));
		for (let i = 0; i < length; ) {
			if (!differs(i)) {
				i++;
				continue;
			}
			let j = i + 1;
			while (j < length && differs(j) && value(wanted[j]) === value(wanted[i])) j++;
			requests.push({ updateTextStyle: { range: { startIndex: start + i, endIndex: start + j }, textStyle: textStyleOf(f.key, wanted[i]!), fields: f.field } });
			i = j;
		}
	}
	return requests;
}

// -- blocks only in the markdown --------------------------------------------------------------------

function insert(blocks: readonly Block[], next: Block | undefined, prev: Block | undefined, end: number): Region {
	const paras = blocks.filter((b): b is Para => b.kind === "p");
	if (paras.length === 0) return { at: 0, requests: [] };
	const wanted = paras.map((p) => charsOf(p.runs.filter((r) => r.atom === undefined)));
	const texts = wanted.map((cs) => cs.map((c) => c.ch).join(""));
	const requests: DocsRequest[] = [];
	let first: number;
	let at: number;
	// The paragraph the new ones are split from, whose style and bullets they start with.
	let from: Block | undefined;
	if (prev && prev.kind === "p" && prev.end !== undefined) {
		// After the previous paragraph: a newline before its own, then the new text.
		at = prev.end - 1;
		requests.push({ insertText: { location: { index: at }, text: `\n${texts.join("\n")}` } });
		first = at + 1;
		from = prev;
	} else if (!prev && !next) {
		// Nothing shown in the Doc: its last, empty paragraph takes the new text, so no empty one is left behind.
		at = Math.max(1, end - 1);
		requests.push({ insertText: { location: { index: at }, text: texts.join("\n") } });
		first = at;
	} else {
		// Before the next block, or at the very start; a table is followed by a paragraph in every Doc.
		at = next?.kind === "p" ? (next.start ?? 1) : prev?.end !== undefined ? prev.end : Math.max(1, end - 1);
		requests.push({ insertText: { location: { index: at }, text: `${texts.join("\n")}\n` } });
		first = at;
		from = next?.kind === "p" ? next : undefined;
	}
	let index = first;
	paras.forEach((para, i) => {
		const length = texts[i]!.length;
		const range = { startIndex: index, endIndex: index + Math.max(1, length) };
		requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: NAMED[para.level] ?? "NORMAL_TEXT" }, fields: "namedStyleType" } });
		if (from?.kind === "p" && from.bullet) requests.push({ deleteParagraphBullets: { range } });
		if (length) {
			// Off first, so text inserted after bold is not bold; then on where the markdown says.
			requests.push({ updateTextStyle: { range: { startIndex: index, endIndex: index + length }, textStyle: {}, fields: "bold,italic,strikethrough,link,weightedFontFamily" } });
			requests.push(...styleRequests(index, wanted[i]!.map((c) => ({ ch: c.ch })), wanted[i]!));
		}
		if (para.bullet) requests.push(...bulletRequests(index, length, undefined, para.bullet));
		index += length + 1;
	});
	return { at, requests };
}

// -- blocks only in the Doc --------------------------------------------------------------------------

function remove(block: Block, end: number): Region {
	const start = block.start ?? 0;
	const stop = block.end ?? start;
	// A section break or a table of contents stays: the page cannot make one again.
	if (block.kind === "atom" || stop <= start) return { at: start, requests: [] };
	// The body's last newline cannot go: the last paragraph is emptied instead, and an empty paragraph is not shown.
	if (stop >= end) {
		const requests: DocsRequest[] = [];
		if (block.kind === "p" && block.bullet) requests.push({ deleteParagraphBullets: { range: { startIndex: start, endIndex: start + 1 } } });
		if (block.kind === "p" && block.level) requests.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: start + 1 }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } });
		if (stop - 1 > start) requests.unshift({ deleteContentRange: { range: { startIndex: start, endIndex: stop - 1 } } });
		return { at: start, requests };
	}
	return { at: start, requests: [{ deleteContentRange: { range: { startIndex: start, endIndex: stop } } }] };
}

