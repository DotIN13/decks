import { OBJECT, type Block, type Cell, type DocsDocument, type DocsParagraph, type DocsStructuralElement, type DocsTextStyle, type Para, type Run, type Style } from "./types.ts";

/**
 * A Google Doc as markdown, and markdown as the same blocks a Google Doc reads into.
 *
 * Both directions meet in one model (`Block`), so whether a page's text says something different
 * from the Doc is decided by what it means rather than by how it is spelled: `**a**` and `__a__`,
 * an escaped star and a lone one, a paragraph on one line or wrapped over two all read the same.
 * That is what lets the page keep the text exactly as the person typed it while the Doc keeps its
 * own, and only a real difference becomes an edit to Google.
 *
 * What markdown can say is edited: headings, body text, bold, italic, strikethrough, code, links,
 * bulleted and numbered lists, and the text in a table's cells. What it cannot (pictures, rules,
 * people, page breaks) is shown as an atom, kept in place, and never written by the page. Empty
 * paragraphs, which Docs uses as spacing, are not shown and are never touched.
 */

const MONO = /^(courier|courier new|consolas|monaco|menlo|roboto mono|source code pro|inconsolata|fira code|fira mono|ubuntu mono|jetbrains mono|space mono|cousine|ibm plex mono)$/i;

/** How a picture is fetched by the page: a path on this server that knows how to reach it. */
export type ImageUrl = (objectId: string) => string;

function styleOf(style: DocsTextStyle | undefined): Style {
	const out: Style = {};
	if (!style) return out;
	if (style.bold) out.bold = true;
	if (style.italic) out.italic = true;
	if (style.strikethrough) out.strike = true;
	if (style.link?.url) out.link = style.link.url;
	if (style.weightedFontFamily?.fontFamily && MONO.test(style.weightedFontFamily.fontFamily)) out.code = true;
	return out;
}

const LEVELS: Record<string, number> = { TITLE: 1, SUBTITLE: 2, HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 };

export function levelOf(namedStyleType: string | undefined): number {
	return LEVELS[namedStyleType ?? ""] ?? 0;
}

const ORDERED = /DECIMAL|ALPHA|ROMAN|ZERO/;

function runsOf(paragraph: DocsParagraph, doc: DocsDocument, image: ImageUrl | undefined): Run[] {
	const runs: Run[] = [];
	for (const element of paragraph.elements ?? []) {
		if (element.textRun) {
			const text = (element.textRun.content ?? "").replace(/\n$/, "");
			if (text) runs.push({ text, ...styleOf(element.textRun.textStyle) });
			continue;
		}
		const span = Math.max(1, (element.endIndex ?? 1) - (element.startIndex ?? 0));
		let md = "";
		if (element.inlineObjectElement) {
			const id = element.inlineObjectElement.inlineObjectId ?? "";
			const object = doc.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject;
			const alt = (object?.title || object?.description || "picture").replace(/[[\]]/g, "");
			md = `![${alt}](${image ? image(id) : (object?.imageProperties?.contentUri ?? "")})`;
		} else if (element.horizontalRule) md = "---";
		else if (element.pageBreak) md = "<!-- page break -->";
		else if (element.footnoteReference) md = `[^${element.footnoteReference.footnoteNumber ?? ""}]`;
		else if (element.person) md = `@${element.person.personProperties?.name ?? element.person.personProperties?.email ?? "person"}`;
		else if (element.richLink) md = `[${element.richLink.richLinkProperties?.title ?? "link"}](${element.richLink.richLinkProperties?.uri ?? ""})`;
		else md = "<!-- not shown -->";
		// An element longer than one index (rare) is still one atom, with the rest of its length kept as atoms too.
		for (let i = 0; i < span; i++) runs.push({ text: OBJECT, atom: i === 0 ? md : "" });
	}
	return runs;
}

function paraOf(element: DocsStructuralElement, doc: DocsDocument, image: ImageUrl | undefined): Para {
	const paragraph = element.paragraph!;
	const para: Para = { kind: "p", level: levelOf(paragraph.paragraphStyle?.namedStyleType), runs: runsOf(paragraph, doc, image), start: element.startIndex ?? 0, end: element.endIndex ?? 0 };
	if (paragraph.bullet) {
		const nest = paragraph.bullet.nestingLevel ?? 0;
		const glyph = doc.lists?.[paragraph.bullet.listId ?? ""]?.listProperties?.nestingLevels?.[nest]?.glyphType ?? "";
		para.bullet = { ordered: ORDERED.test(glyph), nest };
	}
	return para;
}

/** The text a paragraph shows, empty for spacing. */
export const plain = (runs: readonly Run[]) => runs.map((r) => r.text).join("");

/** A Google Doc's body as blocks, each with where it sits in the Doc. */
export function blocksOfDoc(doc: DocsDocument, image?: ImageUrl): Block[] {
	const blocks: Block[] = [];
	const content = doc.body?.content ?? [];
	content.forEach((element, i) => {
		if (element.paragraph) {
			const para = paraOf(element, doc, image);
			if (plain(para.runs).trim() || para.runs.some((r) => r.atom !== undefined)) blocks.push(para);
		} else if (element.table) {
			const rows: Cell[][] = (element.table.tableRows ?? []).map((row) =>
				(row.tableCells ?? []).map((cell) => {
					const paras = (cell.content ?? []).filter((c) => c.paragraph).map((c) => paraOf(c, doc, image));
					const first = paras[0];
					const out: Cell = { runs: first?.runs ?? [], start: first?.start ?? 0, end: first?.end ?? 0 };
					if (paras.length > 1) {
						out.multi = true;
						out.runs = paras.flatMap((p, j) => (j ? [{ text: " " }, ...p.runs] : p.runs));
					}
					return out;
				}),
			);
			blocks.push({ kind: "table", rows, start: element.startIndex ?? 0, end: element.endIndex ?? 0 });
		} else if (element.sectionBreak && i > 0) blocks.push({ kind: "atom", md: "<!-- section break -->", start: element.startIndex ?? 0, end: element.endIndex ?? 0 });
		else if (element.tableOfContents) blocks.push({ kind: "atom", md: "<!-- table of contents -->", start: element.startIndex ?? 0, end: element.endIndex ?? 0 });
	});
	return blocks;
}

// -- writing markdown -----------------------------------------------------------------------------

const escapeText = (text: string, inTable: boolean) => text.replace(inTable ? /[\\`*_[\]~<|]/g : /[\\`*_[\]~<]/g, "\\$&").replace(/\u000b/g, "<br>");

/** A paragraph's runs as inline markdown, with each style's markers kept off the spaces at its ends. */
export function inlineMarkdown(runs: readonly Run[], inTable = false): string {
	type Char = Style & { ch: string; atom?: string };
	const chars: Char[] = [];
	for (const run of runs) {
		if (run.atom !== undefined) {
			chars.push({ ch: OBJECT, atom: run.atom });
			continue;
		}
		const { text: _text, atom: _atom, ...style } = run;
		for (const ch of run.text) chars.push({ ch, ...style });
	}
	// Markers cannot open before or close after a space, so a style's spans are shrunk off them; code keeps its spaces.
	const flags = ["bold", "italic", "strike"] as const;
	// And only spaces between two styled words, so "**a** **b**" is written as "**a b**".
	for (const flag of flags) {
		for (let i = 0; i < chars.length; i++) {
			if (chars[i]![flag] || !/\s/.test(chars[i]!.ch)) continue;
			let j = i;
			while (j < chars.length && /\s/.test(chars[j]!.ch) && !chars[j]![flag]) j++;
			if (i > 0 && chars[i - 1]![flag] && j < chars.length && chars[j]![flag] && chars[i - 1]!.link === chars[j]!.link) for (let k = i; k < j; k++) chars[k]![flag] = true;
			i = j;
		}
	}
	for (const flag of flags) {
		for (let i = 0; i < chars.length; ) {
			if (!chars[i]![flag]) {
				i++;
				continue;
			}
			let j = i;
			while (j < chars.length && chars[j]![flag]) j++;
			for (let k = i; k < j && /\s/.test(chars[k]!.ch); k++) delete chars[k]![flag];
			for (let k = j - 1; k >= i && /\s/.test(chars[k]!.ch); k--) delete chars[k]![flag];
			i = j;
		}
	}
	let out = "";
	for (let i = 0; i < chars.length; ) {
		const link = chars[i]!.link;
		let j = i;
		while (j < chars.length && chars[j]!.link === link) j++;
		const body = styled(chars.slice(i, j), inTable);
		out += link ? `[${body}](${link.replace(/[()\s]/g, encodeURIComponent)})` : body;
		i = j;
	}
	return out;

	function styled(span: Char[], table: boolean): string {
		let text = "";
		const open: Array<"bold" | "italic" | "strike"> = [];
		const marker = { bold: "**", italic: "*", strike: "~~" } as const;
		for (let i = 0; i < span.length; ) {
			const c = span[i]!;
			if (c.atom !== undefined) {
				while (open.length) text += marker[open.pop()!];
				text += c.atom;
				i++;
				continue;
			}
			if (c.code) {
				while (open.length) text += marker[open.pop()!];
				let j = i;
				let code = "";
				while (j < span.length && span[j]!.code && span[j]!.atom === undefined) code += span[j++]!.ch;
				const ticks = code.includes("`") ? "``" : "`";
				text += `${ticks}${ticks.length > 1 ? " " : ""}${code}${ticks.length > 1 ? " " : ""}${ticks}`;
				i = j;
				continue;
			}
			const want = (["bold", "italic", "strike"] as const).filter((f) => c[f]);
			// Close from the top down to the first marker no longer wanted, then open what is missing.
			const keep = open.findIndex((f) => !want.includes(f));
			if (keep !== -1) while (open.length > keep) text += marker[open.pop()!];
			for (const f of want) if (!open.includes(f)) {
				open.push(f);
				text += marker[f];
			}
			text += escapeText(c.ch, table);
			i++;
		}
		while (open.length) text += marker[open.pop()!];
		return text;
	}
}

/** Text that would read as a block's syntax at the start of a line, escaped so it reads as text. */
function guardStart(md: string): string {
	if (/^(#{1,6}\s|[-+>]\s|-{3,}\s*$|={3,}\s*$|\|)/.test(md)) return `\\${md}`;
	return md.replace(/^(\d+)([.)])(\s)/, "$1\\$2$3");
}

export function toMarkdown(blocks: readonly Block[]): string {
	const lines: string[] = [];
	let previous: Block | undefined;
	// Numbered items count up per depth, as they read; a list of another kind starts after a blank line.
	const counts: number[] = [];
	for (const block of blocks) {
		const together = (a: Block | undefined, b: Block) => a?.kind === "p" && !!a.bullet && b.kind === "p" && !!b.bullet && (a.bullet.ordered === b.bullet.ordered || a.bullet.nest !== b.bullet.nest);
		if (previous) lines.push(together(previous, block) ? "" : "\n");
		if (!(block.kind === "p" && block.bullet) || !together(previous, block)) counts.length = 0;
		if (block.kind === "atom") lines.push(block.md);
		else if (block.kind === "table") {
			const width = Math.max(1, ...block.rows.map((r) => r.length));
			block.rows.forEach((row, r) => {
				const cells = Array.from({ length: width }, (_, c) => inlineMarkdown(row[c]?.runs ?? [], true).trim() || " ");
				lines.push(`| ${cells.join(" | ")} |`);
				if (r === 0) lines.push(`\n| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
				if (r < block.rows.length - 1) lines.push("\n");
			});
		} else {
			const inline = inlineMarkdown(block.runs);
			if (block.bullet) {
				const nest = block.bullet.nest;
				counts.length = nest + 1;
				counts[nest] = (counts[nest] ?? 0) + 1;
				lines.push(`${"  ".repeat(nest)}${block.bullet.ordered ? `${counts[nest]}.` : "-"} ${inline}`);
			}
			else if (block.level) lines.push(`${"#".repeat(block.level)} ${inline}`);
			else lines.push(block.runs[0]?.atom !== undefined ? inline : guardStart(inline));
		}
		lines.push("\n");
		previous = block;
	}
	return lines.join("");
}

// -- reading markdown -------------------------------------------------------------------------------

const ATOM_LINE = /^(<!--[\s\S]*?-->|---+|\*\*\*+|___+)\s*$/;

/** Inline markdown read into runs: escapes, code, links, pictures, bold, italic, strikethrough. */
export function parseInline(md: string): Run[] {
	const runs: Run[] = [];
	const style: Style = {};
	let link: string | undefined;
	const push = (text: string, extra: Partial<Run> = {}) => {
		if (!text) return;
		const run: Run = { text, ...style, ...(link ? { link } : {}), ...extra };
		const last = runs[runs.length - 1];
		if (last && last.atom === undefined && run.atom === undefined && sameStyle(last, run)) last.text += text;
		else runs.push(run);
	};
	// The closer of a delimiter run, so a lone `*` stays a star.
	const closes = (from: number, mark: string) => md.indexOf(mark, from) !== -1;
	let i = 0;
	while (i < md.length) {
		const ch = md[i]!;
		if (ch === "\\" && i + 1 < md.length && /[\\`*_[\]~<>|#+\-.!(){}]/.test(md[i + 1]!)) {
			push(md[i + 1]!);
			i += 2;
			continue;
		}
		if (md.startsWith("<br>", i) || md.startsWith("<br/>", i) || md.startsWith("<br />", i)) {
			push("\u000b");
			i = md.indexOf(">", i) + 1;
			continue;
		}
		if (ch === "`") {
			const ticks = md.slice(i).match(/^`+/)![0];
			const end = md.indexOf(ticks, i + ticks.length);
			if (end !== -1) {
				let code = md.slice(i + ticks.length, end);
				if (ticks.length > 1 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
				push(code, { code: true, bold: undefined, italic: undefined, strike: undefined } as Partial<Run>);
				i = end + ticks.length;
				continue;
			}
		}
		const picture = /^!\[[^\]]*\]\([^)]*\)/.exec(md.slice(i));
		if (picture) {
			push(OBJECT, { atom: picture[0] });
			i += picture[0].length;
			continue;
		}
		if (ch === "[" && !link) {
			const m = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)\)/.exec(md.slice(i));
			if (m) {
				link = decodeURIComponentSafe(m[2]!);
				for (const run of parseInline(m[1]!)) push(run.text, { ...run, link } as Partial<Run>);
				link = undefined;
				i += m[0].length;
				continue;
			}
		}
		if (md.startsWith("~~", i) && (style.strike || closes(i + 2, "~~"))) {
			style.strike = !style.strike || undefined;
			i += 2;
			continue;
		}
		if ((md.startsWith("**", i) || md.startsWith("__", i)) && (style.bold || closes(i + 2, md.slice(i, i + 2)))) {
			style.bold = !style.bold || undefined;
			i += 2;
			continue;
		}
		if ((ch === "*" || (ch === "_" && !/\w/.test(md[i - 1] ?? "") )) && (style.italic || closes(i + 1, ch))) {
			style.italic = !style.italic || undefined;
			i += 1;
			continue;
		}
		push(ch);
		i++;
	}
	return runs.map((r) => clean(r));
}

function decodeURIComponentSafe(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

function clean(run: Run): Run {
	const out: Run = { text: run.text };
	if (run.atom !== undefined) out.atom = run.atom;
	if (run.code) out.code = true;
	else {
		if (run.bold) out.bold = true;
		if (run.italic) out.italic = true;
		if (run.strike) out.strike = true;
	}
	if (run.link) out.link = run.link;
	return out;
}

export function sameStyle(a: Style, b: Style): boolean {
	return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && (a.link ?? "") === (b.link ?? "");
}

function splitCells(line: string): string[] {
	const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const cells: string[] = [];
	let cell = "";
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\\" && body[i + 1] === "|") {
			cell += "\\|";
			i++;
		} else if (body[i] === "|") {
			cells.push(cell);
			cell = "";
		} else cell += body[i];
	}
	cells.push(cell);
	return cells.map((c) => c.trim());
}

/** Markdown read into blocks: what a page's text means, to set beside the Doc's. */
export function parseMarkdown(md: string): Block[] {
	const blocks: Block[] = [];
	const lines = md.replace(/\r\n?/g, "\n").split("\n");
	let para: string[] = [];
	const flush = () => {
		if (para.length) {
			const text = para.join(" ").trim();
			if (text) blocks.push({ kind: "p", level: 0, runs: parseInline(text) });
		}
		para = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) {
			flush();
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
		const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (ATOM_LINE.test(line.trim()) && !para.length) {
			const atom = line.trim();
			// A rule is a paragraph holding one atom in a Doc; a comment line is a block of its own.
			if (atom.startsWith("<!--") && atom !== "<!-- page break -->") blocks.push({ kind: "atom", md: atom });
			else blocks.push({ kind: "p", level: 0, runs: [{ text: OBJECT, atom: /^[-*_]+$/.test(atom) ? "---" : atom }] });
			continue;
		}
		if (heading) {
			flush();
			blocks.push({ kind: "p", level: heading[1]!.length, runs: parseInline(heading[2]!) });
			continue;
		}
		if (item && !(item[2] === "*" && /^\*\*/.test(line.trim()))) {
			flush();
			const nest = Math.floor(item[1]!.replace(/\t/g, "  ").length / 2);
			blocks.push({ kind: "p", level: 0, bullet: { ordered: /\d/.test(item[2]!), nest }, runs: parseInline(item[3]!) });
			continue;
		}
		if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
			flush();
			const rows: Cell[][] = [splitCells(line).map((c) => ({ runs: parseInline(c) }))];
			i += 2;
			while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitCells(lines[i++]!).map((c) => ({ runs: parseInline(c) })));
			i--;
			blocks.push({ kind: "table", rows });
			continue;
		}
		para.push(line);
	}
	flush();
	return blocks;
}

/** The markdown a page shows for a Google Doc. */
export function docToMarkdown(doc: DocsDocument, image?: ImageUrl): string {
	return toMarkdown(blocksOfDoc(doc, image));
}
