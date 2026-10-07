import type { DocFormat, Splice } from "../index.ts";

/**
 * A document cut into blocks for the page: each block a span of the source, drawn as it reads
 * and edited as its own text. The spans tile the whole source with nothing between them, so a
 * block's start plus an offset inside it is an offset into the file.
 *
 * Markdown and LaTeX are cut at blank lines, keeping a fenced code block, a `$$` display, a LaTeX
 * environment and a LaTeX preamble whole. A `.docx` is cut at its paragraphs, and between them
 * its XML is kept as quiet blocks that are never shown.
 */

export interface Block {
	start: number;
	end: number;
	/** `text` is shown and edited; `hidden` is source between paragraphs that a page never shows. */
	kind: "text" | "preamble" | "hidden";
}

export function blocks(source: string, format: DocFormat, tex = false): Block[] {
	if (format === "docx") return docxBlocks(source);
	return tex ? texBlocks(source) : markdownBlocks(source);
}

/** Lines with their offsets, each including its newline. */
function lines(source: string): Array<{ start: number; text: string }> {
	const out: Array<{ start: number; text: string }> = [];
	let at = 0;
	while (at < source.length) {
		const next = source.indexOf("\n", at);
		const end = next === -1 ? source.length : next + 1;
		out.push({ start: at, text: source.slice(at, end) });
		at = end;
	}
	return out;
}

/** Group lines into blocks at blank lines; `opens` and `closes` hold a block open across them. */
function byBlankLines(source: string, inside: (line: string, open: boolean) => boolean): Block[] {
	const out: Block[] = [];
	let start = 0;
	let open = false;
	let content = false;
	for (const line of lines(source)) {
		const blank = line.text.trim() === "";
		if (blank && !open && content) {
			// The blank lines after a block belong to it, so blocks tile the source.
			out.push({ start, end: line.start + line.text.length, kind: "text" });
			start = line.start + line.text.length;
			content = false;
			continue;
		}
		if (!blank) content = true;
		open = inside(line.text, open);
	}
	if (start < source.length) out.push({ start, end: source.length, kind: "text" });
	// Merge a trailing run of blank lines into the block before it.
	const merged: Block[] = [];
	for (const block of out) {
		if (merged.length && source.slice(block.start, block.end).trim() === "") merged[merged.length - 1]!.end = block.end;
		else merged.push(block);
	}
	return merged.length ? merged : [{ start: 0, end: source.length, kind: "text" }];
}

export function markdownBlocks(source: string): Block[] {
	let fence = "";
	return byBlankLines(source, (line, open) => {
		const t = line.trim();
		if (fence) {
			if (t.startsWith(fence)) fence = "";
			return fence !== "";
		}
		const opened = /^(```+|~~~+)/.exec(t);
		if (opened) {
			fence = opened[1]!;
			return true;
		}
		if (t === "$$") return !open;
		return open && t !== "$$";
	});
}

export function texBlocks(source: string): Block[] {
	const begin = source.indexOf("\\begin{document}");
	const head: Block[] = [];
	let body = source;
	let offset = 0;
	if (begin !== -1) {
		const after = source.indexOf("\n", begin);
		offset = after === -1 ? source.length : after + 1;
		head.push({ start: 0, end: offset, kind: "preamble" });
		body = source.slice(offset);
	}
	let depth = 0;
	const inner = byBlankLines(body, (line) => {
		const code = line.replace(/(^|[^\\])%.*$/, "$1");
		depth += (code.match(/\\begin\{/g) ?? []).length - (code.match(/\\end\{/g) ?? []).length;
		if (depth < 0) depth = 0;
		return depth > 0;
	});
	return [...head, ...inner.map((b) => ({ ...b, start: b.start + offset, end: b.end + offset }))];
}

// --- Word ------------------------------------------------------------------------------------

/** The opening of a paragraph, and not of `<w:pPr>` or `<w:proofErr>`. */
const PARAGRAPH = /<w:p(?=[\s>/])[^>]*?(\/>|>)/g;

export function docxBlocks(xml: string): Block[] {
	const out: Block[] = [];
	let at = 0;
	PARAGRAPH.lastIndex = 0;
	for (let m = PARAGRAPH.exec(xml); m; m = PARAGRAPH.exec(xml)) {
		const start = m.index;
		let end: number;
		if (m[1] === "/>") end = start + m[0].length;
		else {
			const close = xml.indexOf("</w:p>", PARAGRAPH.lastIndex);
			if (close === -1) break;
			end = close + "</w:p>".length;
		}
		if (start > at) out.push({ start: at, end: start, kind: "hidden" });
		out.push({ start, end, kind: "text" });
		at = end;
		PARAGRAPH.lastIndex = end;
	}
	if (at < xml.length) out.push({ start: at, end: xml.length, kind: "hidden" });
	return out;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Run {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
}

/**
 * One Word paragraph as text, and where each of its characters sits in the XML.
 *
 * `xml[i]` is the offset in the paragraph's XML of character `i` of `text`, and `xml[text.length]`
 * is where text typed at the very end goes. Tabs and breaks are characters too (`\t`, `\n`), so
 * the text a person edits is the text Word shows.
 */
export interface Paragraph {
	text: string;
	xml: number[];
	/** How long each character is in the XML: one, or an entity's length. */
	width: number[];
	/** Which `<w:t>` opening tag each character is inside, by its offset; -1 for a tab or break. */
	tag: number[];
	runs: Run[];
	style: string;
}

export function readParagraph(xml: string): Paragraph {
	const out: Paragraph = { text: "", xml: [], width: [], tag: [], runs: [], style: /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? "" };
	const run = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g;
	let lastEnd = -1;
	for (let r = run.exec(xml); r; r = run.exec(xml)) {
		const body = r[1]!;
		const bodyAt = r.index + r[0].indexOf(">") + 1;
		const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
		const on = (tag: string) => new RegExp(`<w:${tag}(?:\\s+w:val="(?!0|false|none)[^"]*")?\\s*/>`).test(props);
		const style = { bold: on("b"), italic: on("i"), underline: /<w:u\s+w:val="(?!none)/.test(props) };
		let text = "";
		const piece = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
		for (let p = piece.exec(body); p; p = piece.exec(body)) {
			const pieceAt = bodyAt + p.index;
			if (p[0].startsWith("<w:tab")) {
				out.text += "\t";
				text += "\t";
				out.xml.push(pieceAt);
				out.width.push(p[0].length);
				out.tag.push(-1);
				continue;
			}
			if (!p[0].startsWith("<w:t")) {
				out.text += "\n";
				text += "\n";
				out.xml.push(pieceAt);
				out.width.push(p[0].length);
				out.tag.push(-1);
				continue;
			}
			const open = p[0].indexOf(">") + 1;
			const content = p[1]!;
			let i = 0;
			while (i < content.length) {
				let char = content[i]!;
				let width = 1;
				if (char === "&") {
					const semi = content.indexOf(";", i);
					const name = semi === -1 ? "" : content.slice(i + 1, semi);
					const decoded = ENTITY[name] ?? (name.startsWith("#x") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(parseInt(name.slice(1), 10)) : undefined);
					if (decoded !== undefined) {
						char = decoded;
						width = semi - i + 1;
					}
				}
				out.text += char;
				text += char;
				out.xml.push(pieceAt + open + i);
				out.width.push(width);
				out.tag.push(pieceAt);
				i += width;
			}
			lastEnd = pieceAt + open + content.length;
		}
		if (text) out.runs.push({ text, ...style });
	}
	// Typing at the end goes after the last character; in a paragraph with none, into a new run.
	out.xml.push(out.xml.length ? out.xml.at(-1)! + out.width.at(-1)! : lastEnd);
	return out;
}

/**
 * A change to a paragraph's text as splices of its XML, sequential, in the paragraph's own XML.
 *
 * Deleted characters are cut out of whichever runs hold them, one splice per run they span; new
 * text goes in beside the character before it (so it takes that character's bold or italic), as
 * escaped text inside its `<w:t>`, which is marked to keep its spaces. A line break typed becomes
 * `<w:br/>`. A paragraph with no text at all gets a run of its own.
 */
export function paragraphSplices(xml: string, para: Paragraph, edit: Splice): Splice[] {
	const out: Splice[] = [];
	// Deletions, last first, so earlier offsets stay true while later ones are cut.
	const cuts: Array<{ at: number; len: number }> = [];
	for (let i = edit.at; i < edit.at + edit.before.length; i++) {
		const at = para.xml[i]!;
		const len = para.width[i]!;
		const last = cuts.at(-1);
		if (last && last.at + last.len === at) last.len += len;
		else cuts.push({ at, len });
	}
	let shift = 0;
	for (const cut of cuts) {
		out.push({ at: cut.at - shift, before: xml.slice(cut.at, cut.at + cut.len), text: "" });
		shift += cut.len;
	}
	if (edit.text) {
		const parts = edit.text.split("\n").map(escapeXml);
		const inner = parts.join('</w:t><w:br/><w:t xml:space="preserve">');
		// Where the new text goes, in the XML as the cuts left it.
		const anchor = edit.at > 0 ? edit.at - 1 : 0;
		let at: number;
		let tag = para.tag[anchor] ?? -1;
		if (para.text.length === 0 || tag === -1) {
			const close = xml.lastIndexOf("</w:p>");
			const where = close === -1 ? xml.length : close;
			at = where - removedBefore(cuts, where);
			out.push({ at, before: "", text: `<w:r><w:t xml:space="preserve">${inner}</w:t></w:r>` });
			return out;
		}
		at = edit.at > 0 ? para.xml[anchor]! + para.width[anchor]! : para.xml[0]!;
		at -= removedBefore(cuts, at);
		out.push({ at, before: "", text: inner });
		// A <w:t> without xml:space="preserve" drops leading and trailing spaces when Word reads it.
		const open = xml.slice(tag, xml.indexOf(">", tag) + 1);
		if (!/xml:space="preserve"/.test(open)) {
			const tagAt = tag - removedBefore(cuts, tag);
			// That splice comes earlier in the XML than the text, so it goes first and moves it.
			const fixed = { at: tagAt, before: open, text: open.replace(/^<w:t/, '<w:t xml:space="preserve"') };
			const last = out.pop()!;
			out.push(fixed, { ...last, at: last.at + fixed.text.length - fixed.before.length });
		}
	}
	return out;
}

function removedBefore(cuts: ReadonlyArray<{ at: number; len: number }>, at: number): number {
	return cuts.reduce((sum, cut) => (cut.at + cut.len <= at ? sum + cut.len : sum), 0);
}
