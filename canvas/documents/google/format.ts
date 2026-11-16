import type { DocsDimension, DocsParagraphStyle, DocsRequest, DocsTextStyle } from "./types.ts";
import { isStruct, OBJECT_UNIT, STRUCT } from "./units.ts";
import { pt, type TableStep } from "./text-units.ts";
import { GoogleView } from "./view.ts";

/** What the toolbar does to a GoogleView's Doc: lists, styles, tables, links and comments, added to its prototype. */

declare module "./view.ts" {
	interface GoogleView {
		bullets(nls: number[], levels: number[], numbered: boolean, listId?: string): DocsRequest[];
		nest(delta: number): boolean;
		indent(delta: number): void;
		bump(delta: number): void;
		baseline(kind: "SUPERSCRIPT" | "SUBSCRIPT"): void;
		isNumbered(bullet: { listId?: string; nestingLevel?: number }): boolean;
		localList(numbered: boolean): string;
		setText(field: keyof DocsTextStyle, value: unknown): void;
		toggle(field: "bold" | "italic" | "underline" | "strikethrough"): void;
		setParagraph(style: DocsParagraphStyle, fields: string): void;
		list(numbered: boolean): void;
		clearFormatting(): void;
		cellAt(): { table: number; row: number; column: number } | undefined;
		table(action: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "deleteRow" | "deleteCol" | "insert"): void;
		perform(step: TableStep): TableStep | undefined;
		grid(start: number): { rows: number; columns: number; end: number; cells: Array<{ r: number; c: number; start: number; end: number; text: string }> } | undefined;
		refill(): void;
		link(url: string | undefined): void;
		setComments(comments: ReadonlyArray<{ id: string; quotedFileContent?: { value?: string } }>): void;
	}
}

/**
 * Requests that make `nls` one list at these depths: Docs reads a list item's depth from the
 * tabs it starts with, and takes them away, so a tab goes in for each level, last paragraph first.
 */
GoogleView.prototype.bullets = function (this: GoogleView, nls: number[], levels: number[], numbered: boolean, listId?: string): DocsRequest[] {
	const start = this.paragraphStart(nls[0]!);
	const out: DocsRequest[] = [];
	let tabs = 0;
	for (let k = nls.length - 1; k >= 0; k--) {
		const level = levels[k] ?? 0;
		if (!level) continue;
		out.push({ insertText: { location: { index: this.paragraphStart(nls[k]!) }, text: "\t".repeat(level) } });
		tabs += level;
	}
	const create: DocsRequest = { createParagraphBullets: { range: { startIndex: start, endIndex: Math.max(start + 1, nls[nls.length - 1]!) + tabs }, bulletPreset: numbered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } };
	this.hints.set(create, { levels: [...levels], ...(listId ? { listId } : {}) });
	out.push(create);
	return out;
};

/**
 * List items a level deeper or shallower: the list they are in is made again with each item's
 * new depth, so its numbering carries on. False when none of the selection is a list item.
 */
GoogleView.prototype.nest = function (this: GoogleView, delta: number): boolean {
	const range = this.range();
	if (!range) return false;
	const chosen = this.paragraphsIn(range[0], range[1]).filter((nl) => this.units[nl]!.para?.bullet);
	if (!chosen.length) return false;
	const listId = this.units[chosen[0]!]!.para!.bullet!.listId;
	// The whole run of items in that list around the selection.
	const block = [chosen[0]!];
	const listed = (nl: number | undefined) => nl !== undefined && this.units[nl]?.ch === "\n" && this.units[nl]!.para?.bullet?.listId === listId;
	for (let nl = this.paragraphStart(block[0]!) - 1; nl >= 1 && listed(nl); nl = this.paragraphStart(nl) - 1) block.unshift(nl);
	for (let nl = this.paragraphEnd(block[block.length - 1]! + 1); nl > block[block.length - 1]! && listed(nl); nl = this.paragraphEnd(nl + 1)) block.push(nl);
	const levels = block.map((nl) => {
		const level = this.units[nl]!.para!.bullet!.nestingLevel ?? 0;
		return chosen.includes(nl) ? Math.max(0, Math.min(8, level + delta)) : level;
	});
	if (levels.every((level, k) => level === (this.units[block[k]!]!.para!.bullet!.nestingLevel ?? 0))) return true;
	this.run(this.bullets(block, levels, this.isNumbered(this.units[block[0]!]!.para!.bullet!), listId), range);
	return true;
};

/** The paragraphs' indent a step in or out (Docs' half inch), or a list's items a level. */
GoogleView.prototype.indent = function (this: GoogleView, delta: number): void {
	const range = this.range();
	if (!range) return;
	if (this.nest(delta)) return;
	const requests: DocsRequest[] = this.paragraphsIn(range[0], range[1]).map((nl) => {
		const { ps } = this.effective(this.units[nl]!.para);
		const start = this.paragraphStart(nl);
		const by = (d: DocsDimension | undefined) => ({ magnitude: Math.max(0, pt(d) + 36 * delta), unit: "PT" });
		return { updateParagraphStyle: { range: { startIndex: start, endIndex: Math.max(start + 1, nl) }, paragraphStyle: { indentStart: by(ps.indentStart), indentFirstLine: by(ps.indentFirstLine) }, fields: "indentStart,indentFirstLine" } };
	});
	this.run(requests, range);
};

/** The font a point bigger or smaller, as Ctrl+Shift+. and , do. */
GoogleView.prototype.bump = function (this: GoogleView, delta: number): void {
	this.setText("fontSize", { magnitude: Math.max(1, Math.round(this.state().size) + delta), unit: "PT" });
};

/** Superscript or subscript, or back to the line when it already is. */
GoogleView.prototype.baseline = function (this: GoogleView, kind: "SUPERSCRIPT" | "SUBSCRIPT"): void {
	this.setText("baselineOffset", this.state().baseline === kind ? "NONE" : kind);
};

GoogleView.prototype.isNumbered = function (this: GoogleView, bullet: { listId?: string; nestingLevel?: number }): boolean {
	const glyph = this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[bullet.nestingLevel ?? 0]?.glyphType;
	return !!glyph && glyph !== "GLYPH_TYPE_UNSPECIFIED" && glyph !== "NONE";
};

/** A list for bullets made here, drawn until Google's own comes back. */
GoogleView.prototype.localList = function (this: GoogleView, numbered: boolean): string {
	const listId = numbered ? "local-numbered" : "local-bulleted";
	if (this.doc && !this.doc.lists?.[listId]) {
		this.doc.lists = { ...(this.doc.lists ?? {}), [listId]: { listProperties: { nestingLevels: Array.from({ length: 9 }, (_, k) => ({ glyphType: numbered ? "DECIMAL" : "GLYPH_TYPE_UNSPECIFIED", glyphFormat: numbered ? `%${k}.` : "", indentStart: { magnitude: 36 + 36 * k, unit: "PT" }, indentFirstLine: { magnitude: 18 + 36 * k, unit: "PT" } })) } } };
	}
	return listId;
};

/** Set one text style on the selection (`undefined` clears it), here at once and in Google next. */
GoogleView.prototype.setText = function (this: GoogleView, field: keyof DocsTextStyle, value: unknown): void {
	const range = this.textRange();
	if (!range) return;
	if (range === "caret") {
		// Kept for the next typing here, as Docs keeps it.
		const at = this.range()![0];
		const ts = { ...((this.pending?.at === at ? this.pending.ts : this.caretStyle(at)) ?? {}) } as Record<string, unknown>;
		if (value === undefined) delete ts[field];
		else ts[field] = value;
		this.pending = { at, ts: ts as DocsTextStyle };
		this.host.selection?.();
		return;
	}
	const textStyle = (value === undefined ? {} : { [field]: value }) as DocsTextStyle;
	this.run([{ updateTextStyle: { range: { startIndex: range[0], endIndex: range[1] }, textStyle, fields: field } }], range);
};

/** On for the whole selection unless all of it already has it, as Docs decides. */
GoogleView.prototype.toggle = function (this: GoogleView, field: "bold" | "italic" | "underline" | "strikethrough"): void {
	const range = this.range();
	if (range && range[0] !== range[1]) {
		let all = true;
		for (let i = range[0]; i < range[1] && all; i++) {
			const unit = this.units[i];
			if (!unit || unit.ch === "\n" || isStruct(unit.ch) || unit.obj || unit.ch === OBJECT_UNIT) continue;
			const own = (unit.ts as Record<string, unknown> | undefined)?.[field];
			if (!(own ?? (this.effective(this.units[this.paragraphEnd(i)]?.para).ts as Record<string, unknown>)[field])) all = false;
		}
		return this.setText(field, !all);
	}
	const key = field === "strikethrough" ? "strike" : field;
	this.setText(field, !this.state()[key as "bold"]);
};

/** Set a paragraph style on every paragraph the selection touches. */
GoogleView.prototype.setParagraph = function (this: GoogleView, style: DocsParagraphStyle, fields: string): void {
	const range = this.range();
	if (!range) return;
	const from = this.paragraphStart(range[0]);
	const to = this.paragraphEnd(range[1]);
	this.run([{ updateParagraphStyle: { range: { startIndex: from, endIndex: Math.max(from + 1, to) }, paragraphStyle: style, fields } }], range);
};

/** Bullets or numbers on the selection's paragraphs, or off when they already have that kind. */
GoogleView.prototype.list = function (this: GoogleView, numbered: boolean): void {
	const range = this.range();
	if (!range) return;
	const from = this.paragraphStart(range[0]);
	const to = this.paragraphEnd(range[1]);
	const now = this.state();
	const off = numbered ? now.numbered : now.bullet;
	const r = { startIndex: from, endIndex: Math.max(from + 1, to) };
	this.run(off ? [{ deleteParagraphBullets: { range: r } }] : [{ deleteParagraphBullets: { range: r } }, { createParagraphBullets: { range: r, bulletPreset: numbered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } }], range);
};

GoogleView.prototype.clearFormatting = function (this: GoogleView): void {
	const range = this.textRange();
	if (!range) return;
	if (range === "caret") {
		this.pending = { at: this.range()![0], ts: {} };
		this.host.selection?.();
		return;
	}
	this.run([{ updateTextStyle: { range: { startIndex: range[0], endIndex: range[1] }, textStyle: {}, fields: "bold,italic,underline,strikethrough,smallCaps,foregroundColor,backgroundColor,fontSize,weightedFontFamily,baselineOffset" } }], range);
};

// -- tables ---------------------------------------------------------------------------------
/** The table cell the caret is in: the table's index now, and the cell's row and column. */
GoogleView.prototype.cellAt = function (this: GoogleView): { table: number; row: number; column: number } | undefined {
	const range = this.range();
	const unit = range ? this.units[range[0]] ?? this.units[range[0] - 1] : undefined;
	const cell = unit?.cell;
	if (!cell) return undefined;
	const table = this.units.findIndex((u) => u.ch === STRUCT.table && u.tid === cell.t);
	return table === -1 ? undefined : { table, row: cell.r, column: cell.c };
};

/**
 * A table's shape changed: a row or column in or out, or a new table. Docs makes the structure, so
 * the page waits for the Doc to come back to draw it; these are not undone here.
 */
GoogleView.prototype.table = function (this: GoogleView, action: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "deleteRow" | "deleteCol" | "insert"): void {
	let step: TableStep | undefined;
	if (action === "insert") {
		const range = this.range();
		if (!range) return;
		// Docs puts a newline before a table it inserts, so the table itself starts one index on.
		step = { kind: "table", op: "insert", at: range[0], table: range[0] + 1, index: 0 };
	} else {
		const at = this.cellAt();
		if (!at) return;
		const kind = action === "rowAbove" || action === "rowBelow" || action === "deleteRow" ? "row" : "col";
		const own = kind === "row" ? at.row : at.column;
		if (action === "deleteRow" || action === "deleteCol") step = { kind, op: "delete", table: at.table, index: own };
		else step = { kind, op: "insert", table: at.table, index: action === "rowBelow" || action === "colRight" ? own + 1 : own };
	}
	const done = this.perform(step);
	if (done) this.record({ table: done });
};

/**
 * A table's shape changed, as Docs requests: a row or a column in or out, or a whole table. The
 * answer is the step that undoes it. A row or column taken out keeps its cells' words, so
 * putting it back fills them in once the Doc has made the new cells.
 */
GoogleView.prototype.perform = function (this: GoogleView, step: TableStep): TableStep | undefined {
	if (step.kind === "table") {
		if (step.op === "insert") {
			this.host.style([{ insertTable: { rows: 3, columns: 3, location: { index: step.at! } } }]);
			return { ...step, op: "delete" };
		}
		const grid = this.grid(step.table);
		if (!grid) return undefined;
		this.host.style([{ deleteContentRange: { range: { startIndex: step.at!, endIndex: grid.end } } }]);
		return { ...step, op: "insert" };
	}
	const grid = this.grid(step.table);
	if (!grid) return undefined;
	const row = step.kind === "row";
	const count = row ? grid.rows : grid.columns;
	const location = (index: number) => ({ tableStartLocation: { index: step.table }, rowIndex: row ? index : 0, columnIndex: row ? 0 : index });
	if (step.op === "insert") {
		// Beside the one before it, or before the first.
		const next = Math.min(step.index, count);
		const request: DocsRequest = row
			? { insertTableRow: { tableCellLocation: location(Math.max(0, next - 1)), insertBelow: next > 0 } }
			: { insertTableColumn: { tableCellLocation: location(Math.max(0, next - 1)), insertRight: next > 0 } };
		this.host.style([request]);
		if (step.texts?.some(Boolean)) this.fill = { ...step, index: next };
		return { kind: step.kind, op: "delete", table: step.table, index: next };
	}
	if (count <= 1 || step.index >= count) return undefined;
	const texts = grid.cells.filter((cell) => (row ? cell.r : cell.c) === step.index).map((cell) => cell.text);
	this.host.style([row ? { deleteTableRow: { tableCellLocation: location(step.index) } } : { deleteTableColumn: { tableCellLocation: location(step.index) } }]);
	return { kind: step.kind, op: "insert", table: step.table, index: step.index, texts };
};

/** A table as it stands, by the index of its start: its rows, columns, cells and where it ends. */
GoogleView.prototype.grid = function (this: GoogleView, start: number): { rows: number; columns: number; end: number; cells: Array<{ r: number; c: number; start: number; end: number; text: string }> } | undefined {
	const head = this.units[start];
	if (head?.ch !== STRUCT.table || head.tid === undefined) return undefined;
	const cells: Array<{ r: number; c: number; start: number; end: number; text: string }> = [];
	let end = start + 1;
	for (let i = start + 1; i < this.units.length && this.units[i]!.cell?.t === head.tid; i++) {
		const unit = this.units[i]!;
		end = i + 1;
		if (unit.ch === STRUCT.cell) cells.push({ r: unit.cell!.r, c: unit.cell!.c, start: i + 1, end: i + 1, text: "" });
		else if (!isStruct(unit.ch) && cells.length) {
			const cell = cells[cells.length - 1]!;
			cell.text += unit.ch === OBJECT_UNIT ? "" : unit.ch;
			// Up to its last newline: what Tab selects.
			if (unit.ch === "\n") cell.end = i;
		}
	}
	for (const cell of cells) cell.text = cell.text.replace(/\n$/, "");
	return { rows: new Set(cells.map((c) => c.r)).size, columns: new Set(cells.map((c) => c.c)).size, end, cells };
};

/** After a Doc arrives: the row or column waiting for its words, given them as typing. */
GoogleView.prototype.refill = function (this: GoogleView): void {
	const step = this.fill;
	if (!step?.texts) return;
	const grid = this.grid(step.table);
	const cells = grid?.cells.filter((cell) => (step.kind === "row" ? cell.r : cell.c) === step.index);
	if (!grid || !cells || cells.length !== step.texts.length || cells.some((cell) => this.units[cell.start]?.ch !== "\n")) return;
	this.fill = undefined;
	this.replaying = true;
	try {
		// Last cell first, so each one's index is still where the Doc has it.
		for (let k = cells.length - 1; k >= 0; k--) if (step.texts[k]) this.sync.edit({ at: cells[k]!.start, before: "", text: step.texts[k]! });
	} finally {
		this.replaying = false;
	}
};

/** A link on the selection or the word; with neither, the address goes in as linked text, as Docs puts it. */
GoogleView.prototype.link = function (this: GoogleView, url: string | undefined): void {
	const range = this.textRange();
	if (range === "caret" && url) {
		const at = this.range()![0];
		this.transact(() => {
			if (this.replace(at, at, url) === undefined) return;
			this.run([{ updateTextStyle: { range: { startIndex: at, endIndex: at + url.length }, textStyle: { link: { url } }, fields: "link" } }]);
		});
		this.select(at + url.length);
		return;
	}
	this.setText("link", url ? { url } : undefined);
};

// -- comments -------------------------------------------------------------------------------
/**
 * The Doc's open comments, each highlighted on the words it quotes. Drive keeps a comment's
 * quoted words, not its place, so each is found in the text in order, the first not taken
 * by an earlier one; a comment whose words are gone shows in the list with no highlight.
 */
GoogleView.prototype.setComments = function (this: GoogleView, comments: ReadonlyArray<{ id: string; quotedFileContent?: { value?: string } }>): void {
	this.commented.clear();
	const text = this.units.map((u) => (u.ch === "\u000b" ? "\n" : u.ch)).join("");
	const taken = new Set<number>();
	for (const comment of comments) {
		const quote = comment.quotedFileContent?.value?.replace(/\r\n?/g, "\n");
		if (!quote) continue;
		let at = text.indexOf(quote);
		while (at !== -1 && taken.has(at)) at = text.indexOf(quote, at + 1);
		if (at === -1) continue;
		taken.add(at);
		for (let i = at; i < at + quote.length; i++) if (!this.commented.has(i)) this.commented.set(i, comment.id);
	}
	this.render();
};
