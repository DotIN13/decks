import type { DocSync } from "../client.ts";
import { type Splice } from "../model.ts";
import { spliceDiff } from "../merge.ts";
import type { DocsColor, DocsDimension, DocsDocument, DocsParagraphStyle, DocsRequest, DocsTextStyle } from "./types.ts";
import { isStruct, OBJECT_UNIT, STRUCT } from "./units.ts";
import type { Mark } from "../marks.ts";
import { type Unit, PT, GAP, pt, DEFAULTS, cssColor, firstIndex, lastIndex, WORD, numeral, applyText, cellStyle, buildUnits, type Step, type TableStep, shiftStep } from "./text-units.ts";

/**
 * A Google Doc drawn as Google lays it out, from the Doc itself: its page size and margins, its
 * named styles, every run's font, size, weight, colour and highlight, every paragraph's alignment,
 * spacing and indents, its lists with their own glyphs and numbering, its tables, pictures and rules.
 *
 * The page edits the Doc's index-aligned text (`units.ts`), one character per index, so a
 * keystroke is a splice of that text at exactly the Doc's index and goes out through the same sync
 * as any document; the server turns it into an insertion or a deletion in Google. Styles do not
 * travel as text: a button sends Docs requests for the selection's indices (`style`), applied here
 * at once and in Google as soon as the typing before them has landed.
 *
 * What is drawn is a model of units, one per index, each with the style it reads in. It is rebuilt
 * from each Doc the server sends, and moved by every splice in between, inserted text taking the
 * style of the text before it as Docs gives it.
 */
export interface GoogleViewHost {
	marks(): readonly Mark[];
	/** Requests for the selection's styles, for the server to send once the typing before them is in. */
	style(requests: DocsRequest[]): void;
	/** The server's API, for a picture in the Doc. */
	api?: string;
	/** The caret moved or the text changed: for the toolbar's pressed states. */
	selection?(): void;
	/** The page was drawn again: for what sits beside it (comments). */
	drawn?(): void;
	/** A shortcut for a control the page around it owns: Docs' Ctrl+K for a link, Ctrl+Alt+M for a comment. */
	command?(name: "link" | "comment"): void;
}

export class GoogleView {
	readonly root: HTMLElement;
	readonly page: HTMLElement;
	doc: DocsDocument | undefined;
	units: Unit[] = [];
	named: Record<string, { ts: DocsTextStyle; ps: DocsParagraphStyle }> = DEFAULTS;
	composing: { from: number; to: number } | undefined;
	/** Undo and redo: a keystroke's splice, or a style's Docs requests with the requests that put it back. */
	undoStack: Step[] = [];
	redoStack: Step[] = [];
	replaying = false;
	/** Which comment each index is quoted by, for its highlight (`comments`). */
	commented = new Map<number, string>();
	/** The selection as last seen in the page, for a toolbar control that took the focus (a font list, a size box). */
	lastRange: [number, number] | undefined;
	/**
	 * A style chosen with nothing selected and the caret not inside a word: Docs keeps it for the
	 * next thing typed there, as the whole style that text will read in.
	 */
	pending: { at: number; ts: DocsTextStyle } | undefined;
	/**
	 * Typing being given a style of its own (`pending`, or over a styled selection) and where it
	 * has got to: each keystroke after it is styled too. Locally it would inherit the style anyway,
	 * but the keystrokes reach Google before the style does and take the plain text's style there.
	 */
	styling: { end: number; want: DocsTextStyle } | undefined;
	/** Steps being gathered into one undo step (`transact`). */
	batch: Step[] | undefined;
	/** Where the caret goes once the next Doc arrives: a cell the page asked Docs to make. */
	afterLoad: { table: number; row: number; column: number } | undefined;
	/** Where the caret goes once the next Doc arrives: past a page break Docs made. */
	caretAfterLoad: number | undefined;

	constructor(
		readonly sync: DocSync,
		readonly host: GoogleViewHost,
	) {
		this.root = document.createElement("div");
		this.root.className = "gd";
		this.page = document.createElement("div");
		this.page.className = "gd-page";
		this.page.contentEditable = "true";
		this.page.spellcheck = true;
		this.root.append(this.page);
		this.page.addEventListener("beforeinput", (event) => this.input(event));
		this.page.addEventListener("keydown", (event) => this.key(event));
		this.page.addEventListener("compositionstart", () => {
			const range = this.range();
			this.composing = range ? { from: range[0], to: range[1] } : undefined;
		});
		this.page.addEventListener("compositionend", (event) => {
			const at = this.composing;
			this.composing = undefined;
			this.render();
			if (at && event.data) this.replace(at.from, at.to, event.data);
		});
		document.addEventListener("selectionchange", () => {
			if (!this.page.contains(document.getSelection()?.anchorNode ?? null)) return;
			this.lastRange = this.range(true);
			// A style kept for the next typing lasts only while the caret stays where it was chosen.
			if (this.pending && (!this.lastRange || this.lastRange[0] !== this.pending.at || this.lastRange[1] !== this.pending.at)) this.pending = undefined;
			this.host.selection?.();
		});
		this.page.addEventListener("copy", (event) => this.copy(event, false));
		this.page.addEventListener("cut", (event) => this.copy(event, true));
	}

	// -- the model ------------------------------------------------------------------------------

	/** A Doc from the server, with the text it reads as; the page's own text may be ahead of it. */
	load(doc: DocsDocument, text: string): void {
		this.doc = doc;
		/*
		 * A Doc that states its named styles states them whole, and a field one leaves out is inherited
		 * from Normal text, not taken from Google's defaults: a template's Heading 1 with no size is the
		 * template's 9 pt body size, not 20. The defaults stand in only for a Doc that states none.
		 */
		const stated = doc.namedStyles?.styles ?? [];
		this.named = stated.length ? { NORMAL_TEXT: DEFAULTS.NORMAL_TEXT! } : { ...DEFAULTS };
		for (const style of stated) {
			const base = style.namedStyleType === "NORMAL_TEXT" ? DEFAULTS.NORMAL_TEXT! : { ts: {}, ps: {} };
			this.named[style.namedStyleType ?? ""] = { ts: { ...base.ts, ...(style.textStyle ?? {}) }, ps: { ...base.ps, ...(style.paragraphStyle ?? {}) } };
		}
		this.units = buildUnits(doc);
		// Typing not yet in the Doc that was read: laid over it.
		const local = this.sync.text;
		if (local !== text) for (const splice of spliceDiff(text, local)) this.applyUnits(splice);
		this.render();
		this.host.selection?.();
		this.refill();
		// A row Tab made in the last cell: the caret goes into its first cell, as in Docs.
		const want = this.afterLoad;
		const cell = want ? this.grid(want.table)?.cells.find((c) => c.r === want.row && c.c === want.column) : undefined;
		if (cell) {
			this.afterLoad = undefined;
			this.page.focus();
			this.select(cell.start);
		}
		const caret = this.caretAfterLoad;
		if (caret !== undefined && this.units[caret - 2]?.obj?.pageBreak) {
			this.caretAfterLoad = undefined;
			this.page.focus();
			this.select(caret);
		}
	}

	get loaded(): boolean {
		return !!this.doc;
	}
	/**
	 * Splices that landed on the page's text: the model moved by them, then drawn. `own` when they
	 * are this page's: undo takes those back in order, so its steps stay as they are; anyone else's
	 * moves every step past it, so each still means the same words.
	 */
	update(applied: readonly Splice[], own = false): void {
		if (!this.doc) return;
		for (const splice of applied) {
			this.applyUnits(splice);
			if (!own) for (const stack of [this.undoStack, this.redoStack]) for (const step of stack) shiftStep(step, splice);
		}
		this.render();
	}

	applyUnits(splice: Splice): void {
		const at = splice.at;
		const removed = this.units.splice(at, splice.before.length);
		// Paragraphs joined mid-way keep the first one's style, as Docs does; whole paragraphs taken from their start take theirs with them.
		const joined = removed.find((u) => u.ch === "\n");
		if (joined && at > 1 && this.units[at - 1]?.ch !== "\n" && !isStruct(this.units[at - 1]?.ch ?? "")) {
			for (let i = at; i < this.units.length; i++) {
				if (this.units[i]!.ch !== "\n") continue;
				this.units[i]!.para = joined.para ? structuredClone(joined.para) : { ps: {} };
				break;
			}
		}
		const left = this.units[at - 1];
		const right = this.units[at];
		// Text takes the style of the text before it; at a paragraph's start, of the text after.
		const ts = left && left.ch !== "\n" && !isStruct(left.ch) && !left.obj ? left.ts : right && right.ch !== "\n" && !right.obj ? right.ts : (left?.ts ?? right?.ts);
		const cell = (left && !isStruct(left.ch) ? left.cell : undefined) ?? right?.cell ?? removed[0]?.cell;
		// A new paragraph is split from the one it is typed in: both keep its style.
		let host: Unit | undefined;
		for (let i = at; i < this.units.length && !host; i++) if (this.units[i]!.ch === "\n") host = this.units[i];
		const fresh: Unit[] = [...splice.text].flatMap((ch) =>
			[...(ch.length === 2 ? [...ch] : [ch])].map((c) => ({ ch: c, ...(ts ? { ts: { ...ts } } : {}), ...(cell ? { cell } : {}), ...(c === "\n" ? { para: host?.para ? structuredClone(host.para) : { ps: {} } } : {}) })),
		);
		this.units.splice(at, 0, ...fresh);
	}

	// -- drawing --------------------------------------------------------------------------------
	effective(para: Unit["para"]): { ps: DocsParagraphStyle; ts: DocsTextStyle; type: string } {
		const type = para?.ps.namedStyleType ?? "NORMAL_TEXT";
		const normal = this.named.NORMAL_TEXT!;
		const own = this.named[type] ?? { ts: {}, ps: {} };
		return { type, ps: { ...normal.ps, ...own.ps, ...(para?.ps ?? {}) }, ts: { ...normal.ts, ...own.ts } };
	}

	render(): void {
		const doc = this.doc;
		if (!doc) return;
		const caret = this.range();
		const style = doc.documentStyle;
		const pageless = style?.documentFormat?.documentMode === "PAGELESS";
		const width = pt(style?.pageSize?.width, 612) * PT;
		const pad = (d: DocsDimension | undefined) => `${pt(d, 72) * PT}px`;
		Object.assign(this.page.style, pageless ? { width: "auto", padding: "48px 64px" } : { width: `${width}px`, padding: `${pad(style?.marginTop)} ${pad(style?.marginRight)} ${pad(style?.marginBottom)} ${pad(style?.marginLeft)}` });
		const paper = cssColor(style?.background) ?? "#fff";
		// Pages: the paper repeated at the page's height with a gap between, and content pushed past each gap (`paginate`).
		const height = pt(style?.pageSize?.height, 792) * PT;
		this.page.style.background = pageless ? paper : `repeating-linear-gradient(to bottom, ${paper} 0, ${paper} ${height}px, transparent ${height}px, transparent ${height + GAP}px)`;
		this.root.toggleAttribute("data-pageless", pageless);
		const marks = this.markAt();
		const counters = new Map<string, number[]>();
		const out = document.createDocumentFragment();
		let paragraph: number[] = [];
		let table: { el: HTMLTableElement; t: number; row?: HTMLTableRowElement; cell?: HTMLTableCellElement } | undefined;
		const target = () => table?.cell ?? out;
		for (let i = 0; i < this.units.length; i++) {
			const unit = this.units[i]!;
			if (table && (!unit.cell || unit.cell.t !== table.t) && unit.ch !== STRUCT.row && unit.ch !== STRUCT.cell) table = undefined;
			if (unit.ch === STRUCT.table && unit.table) {
				const el = document.createElement("table");
				el.className = "gd-table";
				el.contentEditable = "true";
				const cols = unit.table.tableStyle?.tableColumnProperties ?? [];
				if (cols.length) {
					const group = document.createElement("colgroup");
					for (const col of cols) {
						const c = document.createElement("col");
						if (col.width?.magnitude) c.style.width = `${pt(col.width) * PT}px`;
						group.append(c);
					}
					el.append(group);
				}
				out.append(el);
				table = { el, t: i };
				continue;
			}
			if (unit.ch === STRUCT.row && table) {
				table.row = table.el.insertRow();
				continue;
			}
			if (unit.ch === STRUCT.cell && table?.row) {
				table.cell = table.row.insertCell();
				table.cell.className = "gd-cell";
				cellStyle(table.cell, unit.cellStyle);
				continue;
			}
			if (isStruct(unit.ch)) continue;
			paragraph.push(i);
			if (unit.ch === "\n") {
				target().append(this.paragraph(paragraph, counters, marks));
				paragraph = [];
			}
		}
		if (paragraph.length) out.append(this.paragraph(paragraph, counters, marks));
		this.page.replaceChildren(out);
		this.paginate();
		this.host.drawn?.();
		if (caret && document.activeElement && this.page.contains(document.activeElement)) this.select(caret[0], caret[1]);
	}

	/**
	 * Page breaks, as Docs makes them: a paragraph that runs past the bottom margin breaks between
	 * two lines and goes on at the top of the next page; one that would leave no line behind starts
	 * on the next page whole, as does one after a page break; and the paper ends on a whole page.
	 * A break is a gap drawn inside the paragraph, holding no index, so the text is untouched.
	 */
	paginate(): void {
		const style = this.doc?.documentStyle;
		this.page.style.minHeight = "";
		if (style?.documentFormat?.documentMode === "PAGELESS") return;
		const height = pt(style?.pageSize?.height, 792) * PT;
		const top = pt(style?.marginTop, 72) * PT;
		const bottom = pt(style?.marginBottom, 72) * PT;
		const pitch = height + GAP;
		const origin = () => this.page.getBoundingClientRect().top;
		const endOf = (y: number) => Math.floor(y / pitch) * pitch + height - bottom;
		const nextTop = (y: number) => (Math.floor(y / pitch) + 1) * pitch + top;
		let last = 0;
		let breakNext = false;
		// Where a paragraph's text starts: inside its padding, which is where a push goes.
		const textTop = (p: HTMLElement) => p.getBoundingClientRect().top - origin() + (Number.parseFloat(getComputedStyle(p).paddingTop) || 0);
		const push = (p: HTMLElement, y0: number) => {
			p.style.paddingTop = `${(Number.parseFloat(getComputedStyle(p).paddingTop) || 0) + nextTop(y0) - y0}px`;
			p.dataset.pushed = "";
		};
		for (const p of this.page.querySelectorAll<HTMLElement>(".gd-p")) {
			const y0 = textTop(p);
			// After a page break, or starting in the bottom margin or the gap: the whole paragraph on the next page.
			if (breakNext || y0 >= endOf(y0)) push(p, y0);
			// Then broken between lines at every page bottom it still runs past.
			for (let guard = 0; guard < 50; guard++) {
				const o = origin();
				const gaps = p.querySelectorAll<HTMLElement>(".gd-gap");
				const from = gaps.length ? gaps[gaps.length - 1]!.getBoundingClientRect().bottom - o : textTop(p);
				const end = endOf(from);
				if (p.getBoundingClientRect().bottom - o <= end) break;
				const split = this.splitAt(p, end, o);
				if (split === "none") break;
				if (split === "whole") push(p, textTop(p));
			}
			breakNext = !!p.querySelector(".gd-break");
			last = Math.max(last, p.getBoundingClientRect().bottom - origin());
		}
		const pages = Math.max(1, Math.ceil((last + bottom) / pitch));
		this.page.style.minHeight = `${pages * pitch - GAP}px`;
	}

	/**
	 * Break a paragraph before its first line that runs past `limit`: a gap to the next page's top
	 * margin goes in at that line's first character. "whole" when that is its first line.
	 */
	splitAt(p: HTMLElement, limit: number, origin: number): "split" | "whole" | "none" {
		// Every character of its text, in order, as a node and offset.
		const chars: Array<[Text, number]> = [];
		for (const span of p.querySelectorAll<HTMLElement>(":scope > [data-s]:not([data-obj])")) {
			const text = span.firstChild;
			if (text?.nodeType === Node.TEXT_NODE) for (let k = 0; k < (text as Text).length; k++) chars.push([text as Text, k]);
		}
		if (!chars.length) return "whole";
		const range = document.createRange();
		const rectOf = (i: number) => {
			const [node, k] = chars[i]!;
			range.setStart(node, k);
			range.setEnd(node, k + 1);
			const rects = range.getClientRects();
			return rects[rects.length - 1] ?? range.getBoundingClientRect();
		};
		// The first character whose line ends past the limit.
		let lo = 0;
		let hi = chars.length - 1;
		if (rectOf(hi).bottom - origin <= limit) return "none";
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (rectOf(mid).bottom - origin > limit) hi = mid;
			else lo = mid + 1;
		}
		// Back to the start of that line.
		const lineTop = rectOf(lo).top;
		let first = lo;
		while (first > 0 && Math.abs(rectOf(first - 1).top - lineTop) < 2) first--;
		if (first === 0 && !p.querySelector(".gd-gap")) return "whole";
		const style = this.doc?.documentStyle;
		const height = pt(style?.pageSize?.height, 792) * PT;
		const top = pt(style?.marginTop, 72) * PT;
		const pitch = height + GAP;
		const y = lineTop - origin;
		const target = (Math.floor(y / pitch) + 1) * pitch + top;
		// Cut the run at that character, and put the gap between its halves.
		const [node, k] = chars[first]!;
		const span = node.parentElement!;
		let after: HTMLElement = span;
		if (k > 0) {
			after = span.cloneNode(false) as HTMLElement;
			after.dataset.s = String(Number(span.dataset.s) + k);
			after.textContent = node.data.slice(k);
			node.data = node.data.slice(0, k);
			span.after(after);
		}
		const gap = document.createElement("span");
		gap.className = "gd-gap";
		gap.contentEditable = "false";
		gap.style.height = `${Math.max(0, target - y)}px`;
		after.before(gap);
		return "split";
	}

	/** Which change each index is part of, for its highlight. */
	markAt(): Map<number, string> {
		const at = new Map<number, string>();
		for (const mark of this.host.marks()) if (mark.kind === "ins") for (let i = mark.start; i < mark.end; i++) at.set(i, mark.change);
		return at;
	}

	paragraph(indices: number[], counters: Map<string, number[]>, marks: Map<number, string>): HTMLElement {
		const nl = this.units[indices[indices.length - 1]!]!;
		const { ps, ts: base, type } = this.effective(nl.para);
		const p = document.createElement(type.startsWith("HEADING_") ? `h${type.slice(8)}` : "p");
		p.className = "gd-p";
		p.dataset.s = String(indices[0]);
		p.dataset.nl = String(indices[indices.length - 1]);
		const s = p.style;
		s.textAlign = { CENTER: "center", END: "right", JUSTIFIED: "justify" }[ps.alignment ?? ""] ?? "left";
		s.marginTop = `${pt(ps.spaceAbove) * PT}px`;
		s.marginBottom = `${pt(ps.spaceBelow) * PT}px`;
		// A list item's indents are its list's, at its depth, unless the paragraph sets its own.
		const listed = nl.para?.bullet ? this.doc?.lists?.[nl.para.bullet.listId ?? ""]?.listProperties?.nestingLevels?.[nl.para.bullet.nestingLevel ?? 0] : undefined;
		const own = nl.para?.ps ?? {};
		const start = pt(own.indentStart ?? listed?.indentStart ?? ps.indentStart);
		const firstLine = own.indentFirstLine ?? listed?.indentFirstLine ?? ps.indentFirstLine;
		const first = firstLine ? pt(firstLine) : start;
		s.paddingLeft = `${start * PT}px`;
		s.paddingRight = `${pt(ps.indentEnd) * PT}px`;
		s.textIndent = `${(first - start) * PT}px`;
		s.lineHeight = String(((ps.lineSpacing ?? 100) / 100) * 1.15);
		const shade = cssColor(ps.shading?.backgroundColor);
		if (shade) s.background = shade;
		// Borders a paragraph draws; Google sends all four, with a width it leaves out meaning none.
		for (const side of ["Top", "Bottom", "Left", "Right"] as const) {
			const border = (ps as Record<string, unknown>)[`border${side}`] as { width?: DocsDimension; color?: DocsColor; padding?: DocsDimension; dashStyle?: string } | undefined;
			const w = pt(border?.width) * PT;
			if (!border || w <= 0) continue;
			s.setProperty(`border-${side.toLowerCase()}`, `${w}px ${border.dashStyle === "DOT" ? "dotted" : border.dashStyle === "DASH" ? "dashed" : "solid"} ${cssColor(border.color) ?? "#000"}`);
			s.setProperty(`padding-${side.toLowerCase()}`, `${pt(border.padding) * PT + (side === "Left" ? start * PT : 0)}px`);
		}
		if (ps.direction === "RIGHT_TO_LEFT") p.dir = "rtl";
		applyText(p, base);
		const bullet = nl.para?.bullet;
		if (bullet) p.append(this.marker(bullet, base, counters, start, first));
		// Runs: one span per stretch of the same style, change and kind.
		let run: HTMLElement | undefined;
		let runKey = "";
		let words = "";
		// One text node per run, so an index inside it is an offset into that node.
		const flush = () => {
			if (run && words) run.append(words);
			words = "";
		};
		for (const i of indices) {
			const unit = this.units[i]!;
			if (unit.ch === "\n") break;
			if (unit.obj || unit.ch === OBJECT_UNIT) {
				flush();
				run = undefined;
				p.append(this.object(unit, i));
				continue;
			}
			const key = `${JSON.stringify(unit.ts ?? {})}|${marks.get(i) ?? ""}|${unit.sug ?? ""}|${this.commented.get(i) ?? ""}`;
			if (!run || key !== runKey) {
				flush();
				const link = unit.ts?.link?.url;
				run = document.createElement(link ? "a" : "span");
				if (link) (run as HTMLAnchorElement).href = link;
				run.dataset.s = String(i);
				applyText(run, { ...base, ...(unit.ts ?? {}) }, base);
				const change = marks.get(i);
				if (change) {
					run.classList.add("lv-hl");
					run.dataset.change = change;
				}
				// Suggestions made in Google's editor, drawn as Google draws them: added text coloured and underlined, removed text struck through.
				if (unit.sug) run.classList.add(unit.sug === "ins" ? "gd-sug-ins" : "gd-sug-del");
				const comment = this.commented.get(i);
				if (comment) {
					run.classList.add("gd-commented");
					run.dataset.comment = comment;
				}
				p.append(run);
				runKey = key;
			}
			words += unit.ch === "\u000b" ? "\n" : unit.ch;
		}
		flush();
		if (!p.querySelector("[data-s]")) {
			// An empty paragraph still has a line to put the caret on.
			const empty = document.createElement("br");
			empty.dataset.empty = "";
			p.append(empty);
		}
		return p;
	}

	marker(bullet: NonNullable<NonNullable<Unit["para"]>["bullet"]>, base: DocsTextStyle, counters: Map<string, number[]>, start: number, first: number): HTMLElement {
		const level = bullet.nestingLevel ?? 0;
		const list = this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels ?? [];
		const counts = counters.get(bullet.listId ?? "") ?? [];
		counts.length = level + 1;
		counts[level] = (counts[level] ?? (list[level]?.startNumber ?? 1) - 1) + 1;
		counters.set(bullet.listId ?? "", counts);
		const nest = list[level];
		let glyph: string;
		if (nest?.glyphSymbol) glyph = nest.glyphSymbol;
		else if (nest?.glyphType && nest.glyphType !== "GLYPH_TYPE_UNSPECIFIED" && nest.glyphType !== "NONE") {
			const format = nest.glyphFormat ?? `%${level}.`;
			glyph = format.replace(/%(\d)/g, (_, k: string) => numeral(counts[Number(k)] ?? 1, list[Number(k)]?.glyphType ?? "DECIMAL"));
		} else glyph = ["●", "○", "■"][level % 3]!;
		const span = document.createElement("span");
		span.className = "gd-marker";
		span.contentEditable = "false";
		span.textContent = glyph;
		applyText(span, { ...base, ...(nest?.textStyle ?? {}) }, base);
		// The text starts at the item's indent; with none, right after the glyph and a space, as Docs sets it.
		if (start > first) span.style.minWidth = `${(start - first) * PT}px`;
		else if (glyph.trim().replace(/\u200b/g, "")) span.style.marginRight = "0.5em";
		return span;
	}

	object(unit: Unit, i: number): HTMLElement {
		const el = unit.obj ?? {};
		let node: HTMLElement;
		if (el.inlineObjectElement) {
			const id = el.inlineObjectElement.inlineObjectId ?? "";
			const object = this.doc?.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject;
			const img = document.createElement("img");
			img.src = this.host.api && this.doc?.documentId ? `${this.host.api}/google/image/${encodeURIComponent(this.doc.documentId)}/${encodeURIComponent(id)}` : (object?.imageProperties?.contentUri ?? "");
			img.alt = object?.title ?? object?.description ?? "";
			if (object?.size?.width?.magnitude) img.style.width = `${pt(object.size.width) * PT}px`;
			if (object?.size?.height?.magnitude) img.style.height = `${pt(object.size.height) * PT}px`;
			node = img;
		} else if (el.horizontalRule) {
			node = document.createElement("span");
			node.className = "gd-hr";
		} else if (el.pageBreak) {
			node = document.createElement("span");
			node.className = "gd-break";
		} else {
			node = document.createElement("span");
			node.className = "gd-chip";
			node.textContent = el.person ? (el.person.personProperties?.name ?? el.person.personProperties?.email ?? "person") : el.richLink ? (el.richLink.richLinkProperties?.title ?? "link") : el.footnoteReference ? (el.footnoteReference.footnoteNumber ?? "*") : "•";
			if (el.footnoteReference) node.classList.add("gd-sup");
		}
		node.contentEditable = "false";
		node.dataset.s = String(i);
		node.dataset.obj = "";
		return node;
	}

	// -- the caret, as indices ------------------------------------------------------------------
	/** The selection as indices, start first, or undefined when it is not in the page. */
	range(live = false): [number, number] | undefined {
		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0 || !this.page.contains(selection.anchorNode)) return live ? undefined : this.lastRange;
		const a = this.indexAt(selection.anchorNode!, selection.anchorOffset);
		const b = this.indexAt(selection.focusNode!, selection.focusOffset);
		if (a === undefined || b === undefined) return undefined;
		return a <= b ? [a, b] : [b, a];
	}

	indexAt(node: Node, offset: number): number | undefined {
		if (node.nodeType === Node.TEXT_NODE) {
			const span = node.parentElement?.closest<HTMLElement>("[data-s]");
			if (!span || span.classList.contains("gd-p")) return undefined;
			// Several text nodes in one span (the browser splits them): count those before.
			let before = 0;
			for (const child of span.childNodes) {
				if (child === node) break;
				before += child.textContent?.length ?? 0;
			}
			return Number(span.dataset.s) + before + offset;
		}
		const el = node as HTMLElement;
		const p = el.closest<HTMLElement>(".gd-p");
		if (!p) {
			// Between paragraphs (the page, a cell): the paragraph at that point.
			const child = el.childNodes[Math.min(offset, el.childNodes.length - 1)] as HTMLElement | undefined;
			const para = child?.closest?.(".gd-p") ?? child?.querySelector?.(".gd-p");
			return para ? Number((para as HTMLElement).dataset.s) : undefined;
		}
		const children = [...el.childNodes];
		for (let k = offset; k < children.length; k++) {
			const at = firstIndex(children[k]!);
			if (at !== undefined) return at;
		}
		// Past everything in it: the paragraph's end.
		return el === p ? Number(p.dataset.nl) : lastIndex(el) ?? Number(p.dataset.nl);
	}

	/** Put the selection on indices. */
	select(from: number, to = from): void {
		const a = this.pointAt(from);
		const b = this.pointAt(to);
		if (!a || !b) return;
		const range = document.createRange();
		range.setStart(a[0], a[1]);
		range.setEnd(b[0], b[1]);
		const selection = document.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	pointAt(index: number): [Node, number] | undefined {
		for (const p of this.page.querySelectorAll<HTMLElement>(".gd-p")) {
			const s = Number(p.dataset.s);
			const nl = Number(p.dataset.nl);
			if (index < s || index > nl) continue;
			let last: [Node, number] | undefined;
			for (const child of p.childNodes) {
				const el = child as HTMLElement;
				if (!el.dataset?.s) continue;
				const start = Number(el.dataset.s);
				if (el.dataset.obj !== undefined) {
					if (index === start) return [p, [...p.childNodes].indexOf(child)];
					last = [p, [...p.childNodes].indexOf(child) + 1];
					continue;
				}
				const text = el.firstChild;
				const length = el.textContent?.length ?? 0;
				if (text && index >= start && index <= start + length) {
					if (index < start + length || !el.nextSibling || (el.nextSibling as HTMLElement).dataset?.s === undefined) return [text, index - start];
					last = [text, index - start];
					continue;
				}
				if (text) last = [text, length];
			}
			return last ?? [p, p.childNodes.length - (p.querySelector("br[data-empty]") ? 1 : 0)];
		}
		return undefined;
	}

	// -- typing ---------------------------------------------------------------------------------
	/**
	 * A position Docs will not delete: a table's structure, or a segment's last newline (the body's,
	 * a cell's, the one before a table). A table's last cell ends with no index after it to say so,
	 * so a newline is a cell's last when the next unit is not in the same cell.
	 */
	fixed(text: string, i: number): boolean {
		if (isStruct(text[i]!)) return true;
		if (text[i] !== "\n") return false;
		if (i + 1 >= text.length || isStruct(text[i + 1]!)) return true;
		const cell = this.units[i]?.cell;
		const next = this.units[i + 1]?.cell;
		return !!cell && (!next || next.t !== cell.t || next.r !== cell.r || next.c !== cell.c);
	}

	// -- styles ---------------------------------------------------------------------------------
	/** What the selection reads as, for the toolbar. */
	state(): { bold: boolean; italic: boolean; underline: boolean; strike: boolean; baseline: string; type: string; font: string; size: number; align: string; bullet: boolean; numbered: boolean } {
		const range = this.range() ?? [1, 1];
		const nl = this.paragraphEnd(range[0]);
		const { ts: base, ps, type } = this.effective(this.units[nl]?.para);
		// With nothing selected: the style the next typing will have, which is the one chosen for it if any.
		const kept = this.pending && range[0] === range[1] && range[0] === this.pending.at ? this.pending.ts : undefined;
		const ts = { ...base, ...(kept ?? (range[0] === range[1] ? this.caretStyle(range[0]) : this.units[range[0]]?.ts) ?? {}) };
		const bullet = this.units[nl]?.para?.bullet;
		const glyph = bullet ? this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[bullet.nestingLevel ?? 0]?.glyphType : undefined;
		const numbered = !!bullet && !!glyph && glyph !== "GLYPH_TYPE_UNSPECIFIED" && glyph !== "NONE";
		return {
			bold: !!ts.bold,
			italic: !!ts.italic,
			underline: !!ts.underline,
			strike: !!ts.strikethrough,
			baseline: ts.baselineOffset ?? "NONE",
			type,
			font: ts.weightedFontFamily?.fontFamily ?? "Arial",
			size: pt(ts.fontSize, 11),
			align: ps.alignment ?? "START",
			bullet: !!bullet && !numbered,
			numbered,
		};
	}

	/** The style Docs gives text typed at `at`: the text before it, or at a paragraph's start the text after. */
	caretStyle(at: number): DocsTextStyle | undefined {
		const left = this.units[at - 1];
		const right = this.units[at];
		const ts = left && left.ch !== "\n" && !isStruct(left.ch) && !left.obj ? left.ts : right && right.ch !== "\n" && !right.obj ? right.ts : (left?.ts ?? right?.ts);
		return ts ? { ...ts } : undefined;
	}

	paragraphEnd(index: number): number {
		for (let i = Math.max(0, index); i < this.units.length; i++) if (this.units[i]!.ch === "\n") return i;
		return this.units.length - 1;
	}

	paragraphStart(index: number): number {
		let i = Math.max(1, index);
		while (i > 1 && this.units[i - 1]!.ch !== "\n" && !isStruct(this.units[i - 1]!.ch)) i--;
		return i;
	}

	/**
	 * What a style goes on: the selection; with nothing selected and the caret inside a word, that
	 * word, as Docs does; else "caret", the next typing there.
	 */
	textRange(): [number, number] | "caret" | undefined {
		const range = this.range();
		if (!range) return undefined;
		if (range[0] !== range[1]) return range;
		const text = this.sync.text;
		const at = range[0];
		if (!WORD.test(text[at - 1] ?? "") || !WORD.test(text[at] ?? "")) return "caret";
		let a = at;
		let b = at;
		while (a > 1 && WORD.test(text[a - 1]!)) a--;
		while (b < text.length && WORD.test(text[b]!)) b++;
		return [a, b];
	}


	/** What a bullets request made here means for the page, which never sees the tabs that tell Docs each paragraph's depth. */
	readonly hints = new WeakMap<object, { levels: number[]; listId?: string }>();

	/** The newlines of `count` paragraphs, from the one `index` is in. */
	paragraphsFrom(index: number, count: number): number[] {
		const out: number[] = [];
		for (let i = this.paragraphEnd(index); out.length < count && i < this.units.length; i = this.paragraphEnd(i + 1)) {
			out.push(i);
			if (i >= this.units.length - 1) break;
		}
		return out;
	}

	/** The newline of each paragraph a range touches. */
	paragraphsIn(from: number, to: number): number[] {
		const out: number[] = [];
		for (let i = this.paragraphEnd(from); i < this.units.length; i = this.paragraphEnd(i + 1)) {
			out.push(i);
			if (i + 1 >= to || i >= this.units.length - 1) break;
		}
		return out;
	}


	/** Words to put back in a row or column once the Doc has made it again. */
	fill: TableStep | undefined;

	focus(): void {
		this.page.focus();
	}

	/** The words selected, as a comment quotes them; empty when nothing is selected. */
	quote(): string {
		const range = this.range();
		if (!range || range[0] === range[1]) return "";
		return this.units
			.slice(range[0], range[1])
			.filter((u) => !isStruct(u.ch) && u.ch !== OBJECT_UNIT)
			.map((u) => (u.ch === "\u000b" ? "\n" : u.ch))
			.join("");
	}

	/** The page's text drawn as plain paragraphs, for a version in History. */
	static plain(text: string): string {
		return text.replace(/[\uE000-\uE004]/g, "").replace(/\uFFFC/g, "▢").replace(/\u000b/g, "\n");
	}
}
