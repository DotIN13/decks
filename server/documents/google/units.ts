import { wordDiff as spliceDiff } from "../splice.ts";
import type { DocsDocument, DocsRequest, DocsStructuralElement } from "./types.ts";

/**
 * A Google Doc as text whose character at offset i is the Doc's index i: paragraph ends "\n",
 * inline objects U+FFFC, structure private-use characters. A splice of it is an edit at that
 * index, so a Doc is versioned, reviewed and typed into like any file; styles stay in the Doc.
 */

export const STRUCT = { section: "\uE000", table: "\uE001", row: "\uE002", cell: "\uE003", other: "\uE004" } as const;
export const OBJECT_UNIT = "\uFFFC";
export const isStruct = (ch: string) => ch >= "\uE000" && ch <= "\uE004";

/** The Doc's body as index-aligned text. */
export function docUnits(doc: DocsDocument): string {
	const out: string[] = [];
	const pad = (index: number | undefined) => {
		// An index nothing here accounts for is structure, so the text never falls out of step.
		while (index !== undefined && out.length < index) out.push(STRUCT.other);
	};
	const walk = (content: readonly DocsStructuralElement[] | undefined) => {
		for (const element of content ?? []) {
			pad(element.startIndex);
			if (element.sectionBreak) out.push(STRUCT.section);
			else if (element.paragraph) {
				for (const part of element.paragraph.elements ?? []) {
					pad(part.startIndex);
					if (part.textRun) out.push(...splitUnits(part.textRun.content ?? ""));
					else for (let i = (part.startIndex ?? out.length); i < (part.endIndex ?? (part.startIndex ?? out.length) + 1); i++) out.push(OBJECT_UNIT);
				}
			} else if (element.table) {
				out.push(STRUCT.table);
				for (const row of element.table.tableRows ?? []) {
					pad((row as { startIndex?: number }).startIndex);
					out.push(STRUCT.row);
					for (const cell of row.tableCells ?? []) {
						pad((cell as { startIndex?: number }).startIndex);
						out.push(STRUCT.cell);
						walk(cell.content);
					}
				}
			} else if (element.tableOfContents) {
				out.push(STRUCT.other);
				walk((element.tableOfContents as { content?: DocsStructuralElement[] }).content);
			} else out.push(STRUCT.other);
			pad(element.endIndex);
		}
	};
	walk(doc.body?.content);
	return out.join("");
}

/**
 * The index of each table cell's last newline. A cell's text cannot lose it in Docs, and the text
 * alone does not say where a table's last cell ends: the paragraph after the table follows it with
 * no index of its own between them.
 */
export function segmentEnds(doc: DocsDocument): Set<number> {
	const ends = new Set<number>();
	const walk = (content: readonly DocsStructuralElement[] | undefined) => {
		for (const element of content ?? []) {
			for (const row of element.table?.tableRows ?? []) {
				for (const cell of row.tableCells ?? []) {
					const last = cell.content?.[cell.content.length - 1];
					if (last?.endIndex !== undefined) ends.add(last.endIndex - 1);
					walk(cell.content);
				}
			}
		}
	};
	walk(doc.body?.content);
	return ends;
}

/**
 * The splices from `from` to `to`. With the same structure, the text between its pieces is
 * compared piece by piece, so no diff deletes across a table, which Docs refuses.
 */
export function unitDiff(from: string, to: string): Array<{ at: number; before: string; text: string }> {
	const pieces = (t: string) => t.split(/[\uE000-\uE004]/);
	const skeleton = (t: string) => t.replace(/[^\uE000-\uE004]/g, "");
	if (skeleton(from) !== skeleton(to)) return spliceDiff(from, to);
	const a = pieces(from);
	const b = pieces(to);
	const out: Array<{ at: number; before: string; text: string }> = [];
	// Where each piece starts in the text as it is once the pieces before it are made.
	let at = 0;
	for (let k = 0; k < a.length; k++) {
		for (const splice of spliceDiff(a[k]!, b[k]!)) out.push({ at: at + splice.at, before: splice.before, text: splice.text });
		at += b[k]!.length + 1;
	}
	return out;
}

function splitUnits(text: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < text.length; i++) out.push(text[i]!);
	return out;
}

/**
 * The requests that turn the Doc whose text is `from` into `to`, the last splice first so each
 * index is where the Doc has it. Structure and pictures cannot be typed: a splice that would is
 * cut to the text around it, and `refused` says so.
 */
export function unitRequests(from: string, to: string, ends?: ReadonlySet<number>): { requests: DocsRequest[]; refused: boolean } {
	const splices = unitDiff(from, to);
	let shift = 0;
	let refused = false;
	const placed = splices.map((s) => {
		const at = s.at - shift;
		shift += s.text.length - s.before.length;
		return { at, before: s.before, text: s.text };
	});
	const requests: DocsRequest[] = [];
	const fixed = (i: number) => isStruct(from[i] ?? "") || (from[i] === "\n" && (i + 1 >= from.length || isStruct(from[i + 1]!) || !!ends?.has(i)));
	for (const s of placed.reverse()) {
		/*
		 * A deletion that ends on a newline Docs keeps (before a table, a cell's or the body's last),
		 * slid back onto the same character before it when it can be: the diff could as well have
		 * kept that one, and a page that deleted three paragraphs before a table meant those.
		 */
		while (!s.text && s.before && s.at > 1 && fixed(s.at + s.before.length - 1) && !fixed(s.at - 1) && from[s.at - 1] === s.before[s.before.length - 1] && ![...s.before.slice(0, -1)].some((_, i) => fixed(s.at + i))) {
			s.at -= 1;
			s.before = from[s.at]! + s.before.slice(0, -1);
		}
		// Deleted: the stretches of text and objects between pieces of structure, last first.
		const runs: Array<[number, number]> = [];
		let start = -1;
		// A segment's last newline (before a cell or table ends, or at the body's end) cannot be deleted in Docs either.
		const last = (i: number) => s.before[i] === "\n" && (s.at + i + 1 >= from.length || isStruct(from[s.at + i + 1]!) || !!ends?.has(s.at + i));
		for (let i = 0; i <= s.before.length; i++) {
			const keep = i === s.before.length || isStruct(s.before[i]!) || last(i);
			if (!keep && start === -1) start = i;
			if (keep && start !== -1) {
				runs.push([start, i]);
				start = -1;
			}
		}
		if ([...s.before].some((ch, i) => isStruct(ch) || last(i))) refused = true;
		for (const [a, b] of runs.reverse()) requests.push({ deleteContentRange: { range: { startIndex: s.at + a, endIndex: s.at + b } } });
		let text = [...s.text].filter((ch) => !isStruct(ch) && ch !== OBJECT_UNIT).join("");
		if (text.length !== s.text.length) refused = true;
		// Inserted where the deleted text was: after any structure it began with, so it stays inside the same cell.
		const lead = [...s.before].findIndex((ch) => !isStruct(ch));
		let index = s.at + (lead > 0 ? lead : 0);
		// After a segment's last newline (the body's end, or a cell's) is no index at all in Docs: the same text goes in
		// just before that newline instead, its own newline first, which reads exactly the same.
		const after = s.at + s.before.length;
		if (text.endsWith("\n") && from[index - 1] === "\n" && (after >= from.length || isStruct(from[after]!)) && index === after) {
			text = `\n${text.slice(0, -1)}`;
			index -= 1;
		}
		if (text) requests.push({ insertText: { location: { index }, text } });
	}
	return { requests, refused };
}
