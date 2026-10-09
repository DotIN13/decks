import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocsApi, DocsBatchResult, DocsComment, DocsListed, DocsDocument, DocsParagraphElement, DocsRequest, DocsStructuralElement, DocsTextStyle, DocsWriteControl } from "./types.ts";

/**
 * A stand-in for Google Docs that applies `batchUpdate` requests the way Docs does, as far as a
 * document page uses them: text inserted takes the style of the character before it, a newline
 * splits a paragraph and both halves keep its style, the body's last newline cannot be deleted,
 * leading tabs set a new bullet's depth, and a batch made against an old revision is refused.
 *
 * It is how the page and the sync are tested without a Google account, and what a server with no
 * Google sign-in uses (`DECKS_GOOGLE=fake`), so the whole loop can be tried by hand.
 */

interface Unit {
	ch: string;
	style?: DocsTextStyle;
	/** On a newline: the paragraph it ends. */
	para?: { namedStyleType?: string; bullet?: { listId: string; nestingLevel: number }; [field: string]: unknown };
	/** A picture or a rule: one index that is not text. */
	element?: Omit<DocsParagraphElement, "startIndex" | "endIndex">;
	/** Inside a table: which one, and its row and column; on a table's, row's or cell's own index, `struct` says which. */
	cell?: { t: number; r: number; c: number };
	struct?: "table" | "row" | "cell";
	/** Part of a suggestion someone made in Google's editor. */
	suggest?: "ins" | "del";
}

const STRUCT_CH = { table: "\uE001", row: "\uE002", cell: "\uE003" } as const;

export interface FakeState {
	id: string;
	title: string;
	revision: number;
	units: Unit[];
	/** The next table's id. */
	tables?: number;
}

export class GoogleError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Each preset's nesting levels as Docs makes them: a glyph or a numbering kind per level, repeating every three, half an inch deeper each. */
const PRESETS: Record<string, { symbols?: string[]; types?: string[]; format?: (k: number) => string }> = {
	BULLET_DISC_CIRCLE_SQUARE: { symbols: ["●", "○", "■"] },
	NUMBERED_DECIMAL_ALPHA_ROMAN: { types: ["DECIMAL", "ALPHA", "ROMAN"], format: (k) => `%${k}.` },
	NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS: { types: ["DECIMAL", "ALPHA", "ROMAN"], format: (k) => `%${k})` },
	NUMBERED_UPPERALPHA_ALPHA_ROMAN: { types: ["UPPER_ALPHA", "ALPHA", "ROMAN"], format: (k) => `%${k}.` },
	NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL: { types: ["UPPER_ROMAN", "UPPER_ALPHA", "DECIMAL"], format: (k) => `%${k}.` },
};
const levelsOf = (preset: string) => {
	const p = PRESETS[preset] ?? PRESETS.BULLET_DISC_CIRCLE_SQUARE!;
	return Array.from({ length: 9 }, (_, k) => ({
		...(p.symbols ? { glyphSymbol: p.symbols[k % 3] } : { glyphType: p.types![k % 3], glyphFormat: p.format!(k) }),
		indentStart: { magnitude: 36 + 36 * k, unit: "PT" },
		indentFirstLine: { magnitude: 18 + 36 * k, unit: "PT" },
		startNumber: 1,
	}));
};

export class FakeDoc {
	constructor(public state: FakeState) {}

	static empty(id: string, title: string): FakeDoc {
		return new FakeDoc({ id, title, revision: 1, units: [{ ch: "" }, { ch: "\n", para: { namedStyleType: "NORMAL_TEXT" } }] });
	}

	get revisionId(): string {
		return `rev-${this.state.revision}`;
	}

	private get units(): Unit[] {
		return this.state.units;
	}

	/** The paragraph a body index is in: where it starts, and the index of its newline. */
	private paragraphAt(index: number): { start: number; nl: number } {
		let nl = index;
		while (nl < this.units.length && this.units[nl]!.ch !== "\n") nl++;
		let start = index;
		while (start > 1 && this.units[start - 1]!.ch !== "\n" && !this.units[start - 1]!.struct) start--;
		return { start, nl };
	}

	private paragraphsIn(startIndex: number, endIndex: number): Array<{ start: number; nl: number }> {
		const out: Array<{ start: number; nl: number }> = [];
		let i = Math.max(1, startIndex);
		while (i < this.units.length) {
			const p = this.paragraphAt(i);
			out.push(p);
			if (p.nl + 1 >= Math.max(endIndex, startIndex + 1)) break;
			i = p.nl + 1;
		}
		return out;
	}

	apply(requests: readonly DocsRequest[], control?: DocsWriteControl): DocsBatchResult {
		if (control?.requiredRevisionId && control.requiredRevisionId !== this.revisionId) throw new GoogleError(400, "The document was changed since the required revision (FAILED_PRECONDITION).");
		const saved = JSON.stringify(this.units);
		try {
			for (const request of requests) this.one(request);
		} catch (error) {
			this.state.units = JSON.parse(saved) as Unit[];
			throw error;
		}
		this.state.revision++;
		return { writeControl: { requiredRevisionId: this.revisionId } };
	}

	private check(index: number, what: string): void {
		if (!Number.isInteger(index) || index < 1 || index >= this.units.length) throw new GoogleError(400, `Invalid ${what}: index ${index} is outside the body (1 to ${this.units.length - 1}).`);
	}

	private one(request: DocsRequest): void {
		const units = this.units;
		if ("insertText" in request) {
			const { index } = request.insertText.location;
			this.check(index, "insertText");
			const before = units[index - 1];
			const style = before && before.ch !== "\n" && before.ch !== "" && !before.element ? before.style : units[index]?.ch !== "\n" ? units[index]?.style : before?.style;
			const host = units[this.paragraphAt(index).nl]!.para;
			// Text typed in a cell is that cell's; before a cell's or row's own index is no place in Docs.
			if (units[index]?.struct) throw new GoogleError(400, `Invalid insertText: index ${index} is a table's structure.`);
			const cell = units[index]?.cell;
			const added: Unit[] = [...request.insertText.text].flatMap((ch) => (ch === "\n" ? [{ ch, ...(style ? { style: { ...style } } : {}), para: structuredClone(host ?? {}) }] : ch.length === 2 ? [...ch].map((c) => ({ ch: c, ...(style ? { style: { ...style } } : {}) })) : [{ ch, ...(style ? { style: { ...style } } : {}) }]));
			if (cell) for (const unit of added) unit.cell = cell;
			units.splice(index, 0, ...added);
			return;
		}
		if ("insertPageBreak" in request) {
			// A page break, then a newline: the break ends its paragraph, and the text after starts a new one.
			const { index } = request.insertPageBreak.location;
			this.check(index, "insertPageBreak");
			if (units[index]?.cell || units[index - 1]?.cell) throw new GoogleError(400, "Invalid insertPageBreak: a page break cannot go in a table.");
			const host = units[this.paragraphAt(index).nl]!.para;
			units.splice(index, 0, { ch: "\uFFFC", element: { pageBreak: {} } }, { ch: "\n", para: structuredClone(host ?? {}) });
			return;
		}
		if ("insertTable" in request) {
			const { rows, columns, location } = request.insertTable;
			this.check(location.index, "insertTable");
			// A newline before the table, as Docs puts one; then the table's own index, each row's, each cell's and its paragraph.
			const t = (this.state.tables = (this.state.tables ?? 0) + 1);
			const host = units[this.paragraphAt(location.index).nl]!.para;
			const made: Unit[] = [{ ch: "\n", para: structuredClone(host ?? {}) }, { ch: STRUCT_CH.table, struct: "table", cell: { t, r: 0, c: 0 } }];
			for (let r = 0; r < rows; r++) {
				made.push({ ch: STRUCT_CH.row, struct: "row", cell: { t, r, c: 0 } });
				for (let c = 0; c < columns; c++) made.push({ ch: STRUCT_CH.cell, struct: "cell", cell: { t, r, c } }, { ch: "\n", para: { namedStyleType: "NORMAL_TEXT" }, cell: { t, r, c } });
			}
			units.splice(location.index, 0, ...made);
			return;
		}
		if ("insertTableRow" in request || "deleteTableRow" in request || "insertTableColumn" in request || "deleteTableColumn" in request) {
			const loc = (Object.values(request)[0] as { tableCellLocation: { tableStartLocation: { index: number }; rowIndex: number; columnIndex: number } }).tableCellLocation;
			const table = units[loc.tableStartLocation.index];
			if (table?.struct !== "table" || !table.cell) throw new GoogleError(400, "Invalid table start location.");
			const t = table.cell.t;
			const span = (r: number, c?: number) => {
				let a = -1;
				let b = -1;
				units.forEach((u, i) => {
					if (u.cell?.t !== t || u.cell.r !== r || (c !== undefined && u.cell.c !== c) || u.struct === "table") return;
					if (c !== undefined && u.struct === "row") return;
					if (a === -1) a = i;
					b = i + 1;
				});
				return [a, b] as const;
			};
			const columns = new Set(units.filter((u) => u.cell?.t === t && u.struct === "cell").map((u) => u.cell!.c)).size;
			const rows = new Set(units.filter((u) => u.cell?.t === t && u.struct === "row").map((u) => u.cell!.r)).size;
			if ("insertTableRow" in request) {
				const [a, b] = span(loc.rowIndex);
				const fresh: Unit[] = [{ ch: STRUCT_CH.row, struct: "row", cell: { t, r: -1, c: 0 } }];
				for (let c = 0; c < columns; c++) fresh.push({ ch: STRUCT_CH.cell, struct: "cell", cell: { t, r: -1, c } }, { ch: "\n", para: { namedStyleType: "NORMAL_TEXT" }, cell: { t, r: -1, c } });
				units.splice(request.insertTableRow.insertBelow ? b : a, 0, ...fresh);
			} else if ("deleteTableRow" in request) {
				if (rows <= 1) throw new GoogleError(400, "A table keeps at least one row.");
				const [a, b] = span(loc.rowIndex);
				units.splice(a, b - a);
			} else {
				if ("deleteTableColumn" in request && columns <= 1) throw new GoogleError(400, "A table keeps at least one column.");
				for (let r = rows - 1; r >= 0; r--) {
					const [a, b] = span(r, loc.columnIndex);
					if ("deleteTableColumn" in request) units.splice(a, b - a);
					else units.splice(request.insertTableColumn.insertRight ? b : a, 0, { ch: STRUCT_CH.cell, struct: "cell", cell: { t, r, c: -1 } }, { ch: "\n", para: { namedStyleType: "NORMAL_TEXT" }, cell: { t, r, c: -1 } });
				}
			}
			this.renumber(t);
			return;
		}
		if ("deleteContentRange" in request) {
			const { startIndex, endIndex } = request.deleteContentRange.range;
			this.check(startIndex, "deleteContentRange");
			if (endIndex > units.length - 1) throw new GoogleError(400, "Invalid deleteContentRange: the last newline of the body cannot be deleted.");
			if (endIndex <= startIndex) throw new GoogleError(400, "Invalid deleteContentRange: the range is empty.");
			// Part of a table cannot go; a whole one can. Nor can a cell's last newline, while its cell stays.
			const inRange = units.slice(startIndex, endIndex);
			for (let i = startIndex; i < endIndex; i++) {
				const unit = units[i]!;
				const next = units[i + 1];
				const lastOfCell = unit.ch === "\n" && unit.cell && !unit.struct && (!next || next.struct === "cell" || next.struct === "row" || next.cell?.t !== unit.cell.t || next.cell.r !== unit.cell.r || next.cell.c !== unit.cell.c);
				if (lastOfCell && inRange.filter((u) => u.cell?.t === unit.cell!.t).length !== units.filter((u) => u.cell?.t === unit.cell!.t).length) throw new GoogleError(400, "Invalid deleteContentRange: a table cell's last newline cannot be deleted.");
			}
			for (const t of new Set(inRange.filter((u) => u.struct).map((u) => u.cell!.t))) {
				const all = units.filter((u) => u.cell?.t === t).length;
				if (inRange.filter((u) => u.cell?.t === t).length !== all) throw new GoogleError(400, "Invalid deleteContentRange: it would delete part of a table.");
			}
			// Paragraphs joined mid-way keep the first one's style, as Docs does; whole paragraphs removed from their start take theirs with them.
			const removed = units.slice(startIndex, endIndex);
			const firstNl = removed.find((u) => u.ch === "\n");
			const fromStart = startIndex === 1 || units[startIndex - 1]!.ch === "\n" || !!units[startIndex - 1]!.struct;
			units.splice(startIndex, endIndex - startIndex);
			if (firstNl && !fromStart) {
				const survivor = units[this.paragraphAt(startIndex).nl]!;
				survivor.para = firstNl.para;
			}
			return;
		}
		if ("updateTextStyle" in request) {
			const { range, textStyle, fields } = request.updateTextStyle;
			this.check(range.startIndex, "updateTextStyle");
			for (let i = range.startIndex; i < Math.min(range.endIndex, units.length); i++) {
				const unit = units[i]!;
				if (unit.ch === "\n") continue;
				const style: Record<string, unknown> = { ...(unit.style ?? {}) };
				for (const field of fields.split(",").map((f) => f.trim())) {
					const value = (textStyle as Record<string, unknown>)[field];
					if (value === undefined) delete style[field];
					else style[field] = value;
				}
				unit.style = style as DocsTextStyle;
			}
			return;
		}
		if ("updateParagraphStyle" in request) {
			const { range, paragraphStyle, fields } = request.updateParagraphStyle;
			this.check(range.startIndex, "updateParagraphStyle");
			for (const p of this.paragraphsIn(range.startIndex, range.endIndex)) {
				const para: Record<string, unknown> = { ...units[p.nl]!.para };
				for (const field of fields.split(",").map((f) => f.trim())) {
					if ((paragraphStyle as Record<string, unknown>)[field] === undefined) delete para[field];
					else para[field] = (paragraphStyle as Record<string, unknown>)[field];
				}
				units[p.nl]!.para = para as Unit["para"];
			}
			return;
		}
		if ("createParagraphBullets" in request) {
			const { range, bulletPreset } = request.createParagraphBullets;
			this.check(range.startIndex, "createParagraphBullets");
			for (const p of this.paragraphsIn(range.startIndex, range.endIndex).reverse()) {
				let tabs = 0;
				while (units[p.start + tabs]?.ch === "\t") tabs++;
				units.splice(p.start, tabs);
				const nl = p.nl - tabs;
				units[nl]!.para = { ...units[nl]!.para, bullet: { listId: bulletPreset, nestingLevel: tabs } };
			}
			return;
		}
		if ("deleteParagraphBullets" in request) {
			const { range } = request.deleteParagraphBullets;
			this.check(range.startIndex, "deleteParagraphBullets");
			// The nesting is kept visually, as Docs keeps it: the level's indent becomes the paragraph's.
			for (const p of this.paragraphsIn(range.startIndex, range.endIndex)) {
				const para = units[p.nl]!.para;
				if (!para?.bullet) continue;
				const level = levelsOf(para.bullet.listId)[para.bullet.nestingLevel]!;
				delete para.bullet;
				para.indentStart = level.indentStart;
				para.indentFirstLine = level.indentStart;
			}
			return;
		}
		throw new GoogleError(400, `The stand-in does not know the request ${Object.keys(request)[0]}.`);
	}

	/** Rows and columns counted again after one came in or went. */
	private renumber(t: number): void {
		let r = -1;
		let c = -1;
		for (const unit of this.units) {
			if (unit.cell?.t !== t || unit.struct === "table") continue;
			if (unit.struct === "row") {
				r++;
				c = -1;
			}
			if (unit.struct === "cell") c++;
			unit.cell = { t, r, c: Math.max(0, c) };
		}
	}

	/** The document as `documents.get` would return it. */
	toDocument(): DocsDocument {
		const lists: NonNullable<DocsDocument["lists"]> = {};
		const units = this.units;
		const paragraph = (from: number): { element: DocsStructuralElement; next: number } => {
			let i = from;
			const elements: DocsParagraphElement[] = [];
			while (i < units.length) {
				const unit = units[i]!;
				if (unit.element) {
					elements.push({ startIndex: i, endIndex: i + 1, ...unit.element });
					i++;
					continue;
				}
				const key = JSON.stringify(unit.style ?? {}) + (unit.suggest ?? "");
				const runStart = i;
				let text = "";
				while (i < units.length && !units[i]!.element && !units[i]!.struct && JSON.stringify(units[i]!.style ?? {}) + (units[i]!.suggest ?? "") === key) {
					text += units[i]!.ch;
					if (units[i++]!.ch === "\n") break;
				}
				elements.push({ startIndex: runStart, endIndex: i, textRun: { content: text, textStyle: unit.style ?? {}, ...(unit.suggest === "ins" ? { suggestedInsertionIds: ["suggest.1"] } : unit.suggest === "del" ? { suggestedDeletionIds: ["suggest.1"] } : {}) } as never });
				if (text.endsWith("\n") || units[i]?.struct) break;
			}
			const para = units[i - 1]?.para ?? {};
			if (para.bullet) lists[para.bullet.listId] = { listProperties: { nestingLevels: levelsOf(para.bullet.listId) } };
			const { bullet: _bullet, ...style } = para;
			return { element: { startIndex: from, endIndex: i, paragraph: { elements, paragraphStyle: { ...style, namedStyleType: para.namedStyleType ?? "NORMAL_TEXT" }, ...(para.bullet ? { bullet: { ...para.bullet } } : {}) } }, next: i };
		};
		const content: DocsStructuralElement[] = [{ startIndex: 0, endIndex: 1, sectionBreak: {} }];
		let i = 1;
		while (i < units.length) {
			const unit = units[i]!;
			if (unit.struct === "table") {
				const t = unit.cell!.t;
				const start = i;
				i++;
				const tableRows: NonNullable<NonNullable<DocsStructuralElement["table"]>["tableRows"]> = [];
				while (i < units.length && units[i]!.cell?.t === t) {
					if (units[i]!.struct === "row") {
						tableRows.push({ startIndex: i, endIndex: i + 1, tableCells: [] });
						i++;
						continue;
					}
					if (units[i]!.struct === "cell") {
						const cell = { startIndex: i, endIndex: i + 1, content: [] as DocsStructuralElement[] };
						i++;
						while (i < units.length && units[i]!.cell?.t === t && !units[i]!.struct) {
							const p = paragraph(i);
							cell.content.push(p.element);
							i = p.next;
						}
						cell.endIndex = i;
						tableRows.at(-1)!.tableCells!.push(cell);
						tableRows.at(-1)!.endIndex = i;
						continue;
					}
					i++;
				}
				content.push({ startIndex: start, endIndex: i, table: { rows: tableRows.length, columns: tableRows[0]?.tableCells?.length ?? 0, tableRows } });
				continue;
			}
			const p = paragraph(i);
			content.push(p.element);
			i = p.next;
		}
		return { documentId: this.state.id, title: this.state.title, revisionId: this.revisionId, body: { content }, lists };
	}

	/** The body's text, for a test to read. */
	text(): string {
		return this.units.slice(1).map((u) => (u.element ? "\uFFFC" : u.ch)).join("");
	}

	/** Mark text as a suggestion, as someone suggesting in Google's editor would. */
	suggest(from: number, to: number, kind: "ins" | "del"): void {
		for (let i = from; i < to; i++) if (this.units[i]!.ch !== "\n") this.units[i]!.suggest = kind;
		this.state.revision++;
	}

	/** Put a picture in at a body index, as someone in Google's editor might. */
	insertPicture(index: number): void {
		this.check(index, "insertPicture");
		this.units.splice(index, 0, { ch: "\uFFFC", element: { inlineObjectElement: { inlineObjectId: `kix.${this.state.revision}` } } });
		this.state.revision++;
	}
}

/** Fake Docs kept as JSON files in a folder: each call reads the file, so a test or a person can edit it beside the server. */
export class FakeDocsApi implements DocsApi {
	constructor(readonly dir: string) {
		mkdirSync(dir, { recursive: true });
	}

	private file(id: string): string {
		if (!/^[\w-]+$/.test(id)) throw new GoogleError(404, `No document ${id}.`);
		return join(this.dir, `${id}.json`);
	}

	load(id: string): FakeDoc {
		const file = this.file(id);
		if (!existsSync(file)) throw new GoogleError(404, `Requested entity was not found (document ${id}).`);
		return new FakeDoc(JSON.parse(readFileSync(file, "utf8")) as FakeState);
	}

	save(doc: FakeDoc): void {
		writeFileSync(this.file(doc.state.id), JSON.stringify(doc.state));
	}

	async list(query?: string): Promise<DocsListed[]> {
		const want = query?.trim().toLowerCase();
		return readdirSync(this.dir)
			.filter((name) => name.endsWith(".json") && !name.endsWith(".comments.json"))
			.flatMap((name) => {
				try {
					const state = JSON.parse(readFileSync(join(this.dir, name), "utf8")) as FakeState;
					if (typeof state.id !== "string") return [];
					return [{ id: state.id, title: state.title || state.id, modified: statSync(join(this.dir, name)).mtime.toISOString() }];
				} catch {
					return [];
				}
			})
			.filter((doc) => !want || doc.title.toLowerCase().includes(want))
			.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
	}

	/** A new document, filled with markdown through the same requests a page would send. */
	async create(id: string, title: string, markdown = ""): Promise<FakeDoc> {
		const doc = FakeDoc.empty(id, title);
		this.save(doc);
		if (markdown) {
			const { plan } = await import("./plan.ts");
			doc.apply(plan(doc.toDocument(), markdown));
			this.save(doc);
		}
		return doc;
	}

	async get(id: string): Promise<DocsDocument> {
		return this.load(id).toDocument();
	}

	async batchUpdate(id: string, requests: DocsRequest[], writeControl?: DocsWriteControl): Promise<DocsBatchResult> {
		const doc = this.load(id);
		const result = doc.apply(requests, writeControl);
		this.save(doc);
		return result;
	}

	// Comments, kept beside the Doc as Drive keeps them beside a file.
	private commentsFile(id: string): string {
		return this.file(id).replace(/\.json$/, ".comments.json");
	}

	private readComments(id: string): DocsComment[] {
		try {
			return JSON.parse(readFileSync(this.commentsFile(id), "utf8")) as DocsComment[];
		} catch {
			return [];
		}
	}

	async comments(id: string): Promise<DocsComment[]> {
		this.load(id);
		return this.readComments(id).filter((c) => !c.resolved);
	}

	async comment(id: string, content: string, quote: string, author = "You"): Promise<void> {
		const list = this.readComments(id);
		list.push({ id: `c${Date.now()}${list.length}`, content, author: { displayName: author, me: author === "You" }, createdTime: new Date().toISOString(), quotedFileContent: { value: quote }, replies: [] });
		writeFileSync(this.commentsFile(id), JSON.stringify(list));
	}

	async reply(id: string, commentId: string, content: string, action?: "resolve" | "reopen"): Promise<void> {
		const list = this.readComments(id);
		const c = list.find((x) => x.id === commentId);
		if (!c) throw new GoogleError(404, "No such comment.");
		c.replies = [...(c.replies ?? []), { id: `r${Date.now()}`, content, author: { displayName: "You", me: true }, createdTime: new Date().toISOString(), ...(action ? { action } : {}) }];
		if (action) c.resolved = action === "resolve";
		writeFileSync(this.commentsFile(id), JSON.stringify(list));
	}
}
