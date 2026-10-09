import type { DocSync } from "../client.ts";
import { applySplice, type Splice } from "../index.ts";
import { spliceDiff } from "../merge.ts";
import type { DocsColor, DocsDimension, DocsDocument, DocsParagraphElement, DocsParagraphStyle, DocsRequest, DocsStructuralElement, DocsTextStyle } from "../gdoc/types.ts";
import { isStruct, OBJECT_UNIT, STRUCT } from "../gdoc/units.ts";
import type { Mark } from "./marks.ts";

/**
 * A Google Doc drawn as Google lays it out, from the Doc itself: its page size and margins, its
 * named styles, every run's font, size, weight, colour and highlight, every paragraph's alignment,
 * spacing and indents, its lists with their own glyphs and numbering, its tables, pictures and rules.
 *
 * The page edits the Doc's index-aligned text (`gdoc/units.ts`), one character per index, so a
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

interface Unit {
	ch: string;
	ts?: DocsTextStyle;
	/** On a newline: the paragraph it ends. */
	para?: { ps: DocsParagraphStyle; bullet?: { listId?: string; nestingLevel?: number } };
	/** A picture or any inline element that is not text. */
	obj?: DocsParagraphElement;
	/** Part of a suggestion made in Google's editor: text it adds, or text it takes out. */
	sug?: "ins" | "del";
	/** Inside a table cell: which table (its start index when read), row and column. */
	cell?: { t: number; r: number; c: number };
	/** On a table's own index: its column widths, and the id its cells name it by. */
	table?: NonNullable<DocsStructuralElement["table"]>;
	tid?: number;
	/** On a cell's own index: its style. */
	cellStyle?: Record<string, unknown>;
}

const PT = 96 / 72;
/** The grey between two pages, as Docs draws it. */
const GAP = 14;
const pt = (d: DocsDimension | undefined, fallback = 0) => (d?.magnitude ?? fallback) * (d?.unit === "PX" ? 1 / PT : 1);

/** Google's own defaults, for a Doc that does not state its named styles (a new Doc states them all). */
const DEFAULTS: Record<string, { ts: DocsTextStyle; ps: DocsParagraphStyle }> = {
	NORMAL_TEXT: { ts: { fontSize: { magnitude: 11, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial", weight: 400 }, foregroundColor: rgb(0, 0, 0) }, ps: { lineSpacing: 115, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } } },
	TITLE: { ts: { fontSize: { magnitude: 26, unit: "PT" } }, ps: { spaceBelow: { magnitude: 3, unit: "PT" } } },
	SUBTITLE: { ts: { fontSize: { magnitude: 15, unit: "PT" }, foregroundColor: rgb(0.4, 0.4, 0.4) }, ps: { spaceBelow: { magnitude: 16, unit: "PT" } } },
	HEADING_1: { ts: { fontSize: { magnitude: 20, unit: "PT" } }, ps: { spaceAbove: { magnitude: 20, unit: "PT" }, spaceBelow: { magnitude: 6, unit: "PT" } } },
	HEADING_2: { ts: { fontSize: { magnitude: 16, unit: "PT" } }, ps: { spaceAbove: { magnitude: 18, unit: "PT" }, spaceBelow: { magnitude: 6, unit: "PT" } } },
	HEADING_3: { ts: { fontSize: { magnitude: 14, unit: "PT" }, foregroundColor: rgb(0.263, 0.263, 0.263) }, ps: { spaceAbove: { magnitude: 16, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" } } },
	HEADING_4: { ts: { fontSize: { magnitude: 12, unit: "PT" }, foregroundColor: rgb(0.4, 0.4, 0.4) }, ps: { spaceAbove: { magnitude: 14, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" } } },
	HEADING_5: { ts: { fontSize: { magnitude: 11, unit: "PT" }, foregroundColor: rgb(0.4, 0.4, 0.4) }, ps: { spaceAbove: { magnitude: 12, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" } } },
	HEADING_6: { ts: { fontSize: { magnitude: 11, unit: "PT" }, italic: true, foregroundColor: rgb(0.4, 0.4, 0.4) }, ps: { spaceAbove: { magnitude: 12, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" } } },
};

function rgb(red: number, green: number, blue: number): DocsColor {
	return { color: { rgbColor: { red, green, blue } } };
}

/** A Docs colour as CSS. A colour with no `rgbColor` is none at all; an empty `rgbColor` is black, Google leaving out fields that are 0. */
const cssColor = (c: DocsColor | undefined) => {
	const v = c?.color?.rgbColor;
	if (!v) return undefined;
	return `rgb(${Math.round((v?.red ?? 0) * 255)}, ${Math.round((v?.green ?? 0) * 255)}, ${Math.round((v?.blue ?? 0) * 255)})`;
};

/** Two text styles alike, whatever order their fields came in. */
const sameStyle = (a: DocsTextStyle | undefined, b: DocsTextStyle | undefined) => {
	const flat = (t: DocsTextStyle | undefined) => JSON.stringify(Object.entries(t ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)));
	return flat(a) === flat(b);
};

/** A straight quote typed, as Docs' smart quotes make it: opening after a space, a line's start or an opening bracket; else closing. */
function smartQuote(before: string | undefined, quote: string): string {
	const opening = before === undefined || /[\s([{\u2018\u201c\uE000-\uE004\uFFFC\u2014\u2013-]/.test(before);
	return quote === '"' ? (opening ? "\u201c" : "\u201d") : opening ? "\u2018" : "\u2019";
}

/**
 * Pasted HTML as runs of text with the styles Docs keeps from a paste: bold, italic, underline,
 * strikethrough and links, from tags or inline styles (Google's own copy wraps everything in a
 * `<b style="font-weight:normal">`, which the style wins over). Blocks become paragraphs.
 */
function runsOf(html: string): Array<{ text: string; ts: DocsTextStyle }> {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const out: Array<{ text: string; ts: DocsTextStyle }> = [];
	const push = (text: string, ts: DocsTextStyle) => {
		if (!text) return;
		const last = out[out.length - 1];
		if (last && sameStyle(last.ts, ts)) last.text += text;
		else out.push({ text, ts });
	};
	const newline = () => {
		const last = out[out.length - 1];
		if (last && !last.text.endsWith("\n")) push("\n", {});
	};
	const block = /^(P|DIV|H[1-6]|LI|TR|BLOCKQUOTE|PRE|UL|OL|TABLE|SECTION|ARTICLE)$/;
	const walk = (node: Node, ts: DocsTextStyle, pre: boolean) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? "";
			// Whitespace between blocks is the HTML's layout, not words.
			const beside = (n: Node | null) => !n || (n.nodeType === Node.ELEMENT_NODE && block.test((n as HTMLElement).tagName));
			if (!pre && !text.trim() && (beside(node.previousSibling) || beside(node.nextSibling))) return;
			push(pre ? text : text.replace(/[\t\n\r ]+/g, " "), ts);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as HTMLElement;
		const tag = el.tagName;
		if (/^(SCRIPT|STYLE|META|TITLE|HEAD|TEMPLATE)$/.test(tag)) return;
		if (tag === "BR") return push("\n", {});
		const next = { ...ts } as Record<string, unknown>;
		if (tag === "B" || tag === "STRONG") next.bold = true;
		if (tag === "I" || tag === "EM") next.italic = true;
		if (tag === "U") next.underline = true;
		if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strikethrough = true;
		const href = tag === "A" ? el.getAttribute("href") : null;
		if (href && !href.startsWith("#")) next.link = { url: href };
		const st = el.style;
		if (st.fontWeight) next.bold = st.fontWeight === "bold" || st.fontWeight === "bolder" || Number(st.fontWeight) >= 600 || undefined;
		if (st.fontStyle) next.italic = st.fontStyle === "italic" || undefined;
		const lines = st.textDecorationLine || st.textDecoration;
		if (lines) {
			next.underline = (/underline/.test(lines) && !next.link) || undefined;
			next.strikethrough = /line-through/.test(lines) || undefined;
		}
		for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
		if (block.test(tag)) newline();
		for (const child of el.childNodes) walk(child, next as DocsTextStyle, pre || tag === "PRE");
		if (block.test(tag)) newline();
		else if (tag === "TD" || tag === "TH") push("\t", ts);
	};
	walk(doc.body, {}, false);
	// Spaces at a paragraph's edges, and newlines at the paste's edges, go.
	for (let k = 0; k < out.length; k++) {
		const run = out[k]!;
		run.text = run.text.replace(/ +\n/g, "\n").replace(/\n +/g, "\n");
		if (k === 0) run.text = run.text.replace(/^\n+/, "");
		if (k === out.length - 1) run.text = run.text.replace(/[\n\t]+$/, "");
	}
	return out.filter((run) => run.text);
}

/** Fonts the Doc uses that this browser may not have, fetched from Google Fonts once each. */
const loaded = new Set(["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Trebuchet MS", "Comic Sans MS", "Impact"]);
function loadFont(family: string): void {
	if (!family || loaded.has(family)) return;
	loaded.add(family);
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,100..900;1,100..900&display=swap`;
	// Some families have no variable axes: the plain request is the fallback.
	link.onerror = () => {
		link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
	};
	document.head.append(link);
}

export class GoogleView {
	readonly root: HTMLElement;
	readonly page: HTMLElement;
	private doc: DocsDocument | undefined;
	private units: Unit[] = [];
	private named: Record<string, { ts: DocsTextStyle; ps: DocsParagraphStyle }> = DEFAULTS;
	private composing: { from: number; to: number } | undefined;
	/** Undo and redo: a keystroke's splice, or a style's Docs requests with the requests that put it back. */
	private undoStack: Step[] = [];
	private redoStack: Step[] = [];
	private replaying = false;
	/** Which comment each index is quoted by, for its highlight (`comments`). */
	private commented = new Map<number, string>();
	/** The selection as last seen in the page, for a toolbar control that took the focus (a font list, a size box). */
	private lastRange: [number, number] | undefined;
	/**
	 * A style chosen with nothing selected and the caret not inside a word: Docs keeps it for the
	 * next thing typed there, as the whole style that text will read in.
	 */
	private pending: { at: number; ts: DocsTextStyle } | undefined;
	/**
	 * Typing being given a style of its own (`pending`, or over a styled selection) and where it
	 * has got to: each keystroke after it is styled too. Locally it would inherit the style anyway,
	 * but the keystrokes reach Google before the style does and take the plain text's style there.
	 */
	private styling: { end: number; want: DocsTextStyle } | undefined;
	/** Steps being gathered into one undo step (`transact`). */
	private batch: Step[] | undefined;
	/** Where the caret goes once the next Doc arrives: a cell the page asked Docs to make. */
	private afterLoad: { table: number; row: number; column: number } | undefined;
	/** Where the caret goes once the next Doc arrives: past a page break Docs made. */
	private caretAfterLoad: number | undefined;

	constructor(
		private readonly sync: DocSync,
		private readonly host: GoogleViewHost,
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

	private applyUnits(splice: Splice): void {
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

	private effective(para: Unit["para"]): { ps: DocsParagraphStyle; ts: DocsTextStyle; type: string } {
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
	private paginate(): void {
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
	private splitAt(p: HTMLElement, limit: number, origin: number): "split" | "whole" | "none" {
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
	private markAt(): Map<number, string> {
		const at = new Map<number, string>();
		for (const mark of this.host.marks()) if (mark.kind === "ins") for (let i = mark.start; i < mark.end; i++) at.set(i, mark.change);
		return at;
	}

	private paragraph(indices: number[], counters: Map<string, number[]>, marks: Map<number, string>): HTMLElement {
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

	private marker(bullet: NonNullable<NonNullable<Unit["para"]>["bullet"]>, base: DocsTextStyle, counters: Map<string, number[]>, start: number, first: number): HTMLElement {
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

	private object(unit: Unit, i: number): HTMLElement {
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

	private indexAt(node: Node, offset: number): number | undefined {
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

	private pointAt(index: number): [Node, number] | undefined {
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
	private fixed(text: string, i: number): boolean {
		if (isStruct(text[i]!)) return true;
		if (text[i] !== "\n") return false;
		if (i + 1 >= text.length || isStruct(text[i + 1]!)) return true;
		const cell = this.units[i]?.cell;
		const next = this.units[i + 1]?.cell;
		return !!cell && (!next || next.t !== cell.t || next.r !== cell.r || next.c !== cell.c);
	}

	/**
	 * Replace `from..to` with `text`, as typing does in Docs. What Docs cannot delete stays and the
	 * rest of the range goes around it; the text goes where the range began. It reads in the style
	 * chosen for the next typing (`pending`), else the first replaced character's, else Docs' own
	 * choice, the style of the text before it. The answer is where the text went, or undefined.
	 */
	private replace(from: number, to: number, text: string, typing = false): number | undefined {
		const current = this.sync.text;
		if (from < 1 || to > current.length || to < from) return undefined;
		const runs: Array<[number, number]> = [];
		for (let i = from; i < to; i++) {
			if (this.fixed(current, i)) continue;
			const last = runs[runs.length - 1];
			if (last && last[1] === i) last[1] = i + 1;
			else runs.push([i, i + 1]);
		}
		const at = runs[0]?.[0] ?? from;
		// A table's own index, or a row's or cell's, is no place for text in Docs.
		if (text && isStruct(current[at] ?? "")) return undefined;
		if (!runs.length && !text) return undefined;
		let want: DocsTextStyle | undefined;
		let force = false;
		if (text && this.pending && from === to && this.pending.at === from) want = this.pending.ts;
		else if (text && from < to) {
			const first = this.units.slice(from, to).find((u) => u.ch !== "\n" && !isStruct(u.ch) && !u.obj && u.ch !== OBJECT_UNIT);
			if (first) want = first.ts ?? {};
		} else if (text && from === to && this.styling?.end === from && !text.includes("\n")) {
			want = this.styling.want;
			force = true;
		}
		this.pending = undefined;
		this.styling = undefined;
		this.transact(() => {
			// Last piece first, so each one's index still holds; the first takes the text.
			for (const [a, b] of runs.slice(1).reverse()) this.edit(a, b, "", false);
			this.edit(at, runs[0]?.[1] ?? at, text, typing && runs.length <= 1);
			if (want && text && this.restyle(at, at + text.length, want, force) && typing) this.styling = { end: at + text.length, want };
		});
		this.select(at + text.length);
		return at;
	}

	/** One splice of the page's text, kept for undo. */
	private edit(at: number, end: number, text: string, typing: boolean): void {
		const before = this.sync.text.slice(at, end);
		if (!before && !text) return;
		// Paragraphs joined: undo splits them again, and gives each back the style it had.
		const restore = before && !this.replaying ? [...this.textAsItIs(at, end), ...(before.includes("\n") ? this.paragraphsAsTheyAre(at, end) : [])] : undefined;
		this.sync.edit({ at, before, text });
		const kind = !typing ? undefined : text && !text.includes("\n") ? "ins" : !text && before.length <= 2 ? "del" : undefined;
		const step: Step = { splice: { at, before: text, text: before }, ...(kind ? { typing: kind } : {}), time: Date.now() };
		this.record(restore?.length ? { group: [{ requests: [], inverse: restore }, step], ...(kind ? { typing: kind } : {}), time: step.time } : step);
	}

	/**
	 * Requests that give the text `from..to` the style it has now, run by run: undoing a deletion
	 * puts the words back as Docs does, bold where they were bold, not in the style beside them.
	 * None when neither the text nor what it would take its style from has any style of its own.
	 */
	private textAsItIs(from: number, to: number): DocsRequest[] {
		const plain = (u: Unit | undefined) => !u?.ts || !Object.keys(u.ts).length;
		const units = this.units.slice(from, to);
		if (units.every((u) => plain(u) || u.ch === "\n" || isStruct(u.ch)) && plain(this.units[from - 1]) && plain(this.units[to])) return [];
		const fields = "bold,italic,underline,strikethrough,smallCaps,baselineOffset,foregroundColor,backgroundColor,fontSize,weightedFontFamily,link";
		const out: DocsRequest[] = [];
		let start = -1;
		for (let i = from; i <= to; i++) {
			const unit = this.units[i];
			const text = i < to && unit && unit.ch !== "\n" && !isStruct(unit.ch) && !unit.obj && unit.ch !== OBJECT_UNIT;
			if (start !== -1 && (!text || !sameStyle(unit!.ts, this.units[start]!.ts))) {
				out.push({ updateTextStyle: { range: { startIndex: start, endIndex: i }, textStyle: { ...(this.units[start]!.ts ?? {}) }, fields } });
				start = -1;
			}
			if (text && start === -1) start = i;
		}
		return out;
	}

	/**
	 * Requests that give every paragraph `from..to` touches the style it has now: its named style,
	 * alignment, indents and spacing, and its bullet. Docs joins paragraphs into the first one's
	 * style, so this is what undoing a join needs once the text is back.
	 */
	private paragraphsAsTheyAre(from: number, to: number): DocsRequest[] {
		const out: DocsRequest[] = [];
		for (const nl of this.paragraphsIn(from, to + 1)) {
			const para = this.units[nl]?.para;
			const ps = { ...(para?.ps ?? {}) } as Record<string, unknown>;
			delete ps.headingId;
			const range = { startIndex: nl, endIndex: nl + 1 };
			const fields = [...new Set(["namedStyleType", "alignment", "indentStart", "indentFirstLine", "indentEnd", "spaceAbove", "spaceBelow", "lineSpacing", ...Object.keys(ps)])].filter((f) => !/^(headingId|tabStops|shading|border\w*)$/.test(f));
			const style = Object.fromEntries(fields.filter((f) => ps[f] !== undefined).map((f) => [f, ps[f]])) as DocsParagraphStyle;
			if (!style.namedStyleType) style.namedStyleType = "NORMAL_TEXT";
			out.push({ deleteParagraphBullets: { range } }, { updateParagraphStyle: { range, paragraphStyle: style, fields: fields.join(",") } });
			const bullet = para?.bullet;
			if (bullet) out.push(...this.bullets([nl], [bullet.nestingLevel ?? 0], this.isNumbered(bullet), bullet.listId));
		}
		return out;
	}

	/** Text set to read in `want`, when Docs would give it another style, or always with `force`; true when a style was sent. */
	private restyle(from: number, to: number, want: DocsTextStyle, force = false): boolean {
		const fields = new Set(Object.keys(want));
		let same = true;
		for (let i = from; i < to; i++) {
			const unit = this.units[i];
			if (!unit || unit.ch === "\n" || isStruct(unit.ch)) continue;
			for (const field of Object.keys(unit.ts ?? {})) fields.add(field);
			if (!sameStyle(unit.ts, want)) same = false;
		}
		if ((same && !force) || !fields.size) return false;
		this.run([{ updateTextStyle: { range: { startIndex: from, endIndex: to }, textStyle: want, fields: [...fields].join(",") } }]);
		return true;
	}

	/** Steps made inside `work` become one undo step. */
	private transact(work: () => void): void {
		if (this.batch || this.replaying) return work();
		const batch: Step[] = (this.batch = []);
		try {
			work();
		} finally {
			this.batch = undefined;
		}
		if (batch.length === 1) this.record(batch[0]!);
		else if (batch.length) this.record({ group: batch, ...(batch[0]!.typing === "ins" ? { typing: "ins" as const, time: batch[0]!.time } : {}) });
	}

	private record(step: Step): void {
		if (this.replaying) return;
		if (this.batch) return void this.batch.push(step);
		this.redoStack = [];
		const top = this.undoStack[this.undoStack.length - 1];
		if (step.typing && top?.typing === step.typing && (step.time ?? 0) - (top.time ?? 0) < 1500 && this.join(top, step)) return;
		this.undoStack.push(step);
		if (this.undoStack.length > 500) this.undoStack.shift();
	}

	/** Typing joined to the step before it: Docs undoes a burst of typing, or of deleting, at once. */
	private join(top: Step, step: Step): boolean {
		// Deleting styled text: the deletion and the styles that undo puts back, joined to the deleting before.
		if (top.group?.length === 2 && step.group?.length === 2 && step.typing === "del" && top.group[1]!.splice && step.group[1]!.splice && top.group[0]!.inverse && step.group[0]!.inverse) {
			const a = top.group[1]!.splice;
			const b = step.group[1]!.splice;
			if (a.before || b.before) return false;
			let later = step.group[0]!.inverse;
			if (b.at + b.text.length === a.at) top.group[1]!.splice = { at: b.at, before: "", text: b.text + a.text };
			else if (b.at === a.at) {
				top.group[1]!.splice = { at: a.at, before: "", text: a.text + b.text };
				// Deleted forward: these words sit after the ones already deleted once both are back.
				later = structuredClone(later);
				for (const request of later) {
					const range = (Object.values(request)[0] as { range?: { startIndex: number; endIndex: number } }).range;
					if (range) {
						range.startIndex += a.text.length;
						range.endIndex += a.text.length;
					}
				}
			} else return false;
			// The styles were read with the text in place, so they hold once all of it is back.
			top.group[0]!.inverse = [...top.group[0]!.inverse, ...later];
			top.time = step.time;
			return true;
		}
		// Styled typing: a keystroke and the style sent with it, joined to the run of them before.
		if (top.group && step.group) {
			const [ta, tb] = top.group;
			const [sa, sb] = step.group;
			const tr = tb?.requests?.[0];
			const sr = sb?.requests?.[0];
			if (top.group.length !== 2 || step.group.length !== 2 || !ta?.splice || !sa?.splice || !tr || !sr || !("updateTextStyle" in tr) || !("updateTextStyle" in sr)) return false;
			if (sa.splice.text || ta.splice.at + ta.splice.before.length !== sa.splice.at) return false;
			if (JSON.stringify([tr.updateTextStyle.textStyle, tr.updateTextStyle.fields]) !== JSON.stringify([sr.updateTextStyle.textStyle, sr.updateTextStyle.fields]) || tr.updateTextStyle.range.endIndex !== sr.updateTextStyle.range.startIndex) return false;
			ta.splice = { ...ta.splice, before: ta.splice.before + sa.splice.before };
			tb!.requests = [{ updateTextStyle: { ...tr.updateTextStyle, range: { startIndex: tr.updateTextStyle.range.startIndex, endIndex: sr.updateTextStyle.range.endIndex } } }];
			tb!.inverse = [...(sb!.inverse ?? []), ...(tb!.inverse ?? [])];
			top.time = step.time;
			return true;
		}
		const a = top.splice;
		const b = step.splice;
		if (!a || !b) return false;
		if (step.typing === "ins") {
			if (b.text || a.at + a.before.length !== b.at) return false;
			top.splice = { at: a.at, before: a.before + b.before, text: a.text };
		} else {
			if (a.before || b.before) return false;
			if (b.at + b.text.length === a.at) top.splice = { at: b.at, before: "", text: b.text + a.text };
			else if (b.at === a.at) top.splice = { at: a.at, before: "", text: a.text + b.text };
			else return false;
		}
		top.time = step.time;
		return true;
	}

	private input(event: InputEvent): void {
		if (this.composing || event.inputType === "insertCompositionText") return;
		event.preventDefault();
		const range = this.range();
		if (!range || this.sync.readOnly) return;
		let [from, to] = range;
		const text = this.sync.text;
		switch (event.inputType) {
			case "insertText":
			case "insertReplacementText": {
				let data = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
				// Docs' smart quotes: curly, opening after a space or the start of a line, closing after anything else.
				if (data === '"' || data === "'") data = smartQuote(text[from - 1], data);
				const at = this.replace(from, to, data, event.inputType === "insertText");
				if (at !== undefined && data === " ") this.autoformat(at);
				return;
			}
			case "insertParagraph":
				this.enter(from, to);
				return;
			case "insertLineBreak":
				this.replace(from, to, "\u000b");
				return;
			case "insertFromPaste":
			case "insertFromDrop":
				this.paste(from, to, event.dataTransfer);
				return;
			case "deleteByCut":
			case "deleteContent":
				this.replace(from, to, "");
				return;
			case "deleteContentBackward":
			case "deleteWordBackward":
			case "deleteSoftLineBackward":
			case "deleteHardLineBackward":
				if (from === to) {
					// At a paragraph's start Docs first takes off its bullet, then its indent, and only then joins it to the one before.
					if (event.inputType === "deleteContentBackward" && this.paragraphStart(from) === from && this.outdent(from)) return;
					if (event.inputType === "deleteContentBackward") from = from - (/[\uDC00-\uDFFF]/.test(text[from - 1] ?? "") ? 2 : 1);
					else if (event.inputType === "deleteWordBackward") from = wordStart(text, from);
					else from = lineStart(text, from);
					if (from < 1 || isStruct(text[from]!) || isStruct(text[from - 1] ?? "") && text[from] === undefined) return;
				}
				if (this.replace(from, to, "", event.inputType === "deleteContentBackward") === undefined) this.select(range[0]);
				return;
			case "deleteContentForward":
			case "deleteWordForward":
				if (from === to) to = event.inputType === "deleteWordForward" ? wordEnd(text, to) : to + (/[\uD800-\uDBFF]/.test(text[to] ?? "") ? 2 : 1);
				if (this.replace(from, to, "", event.inputType === "deleteContentForward") === undefined) this.select(range[0]);
				return;
			case "historyUndo":
				this.undo();
				return;
			case "historyRedo":
				this.redo();
				return;
			case "formatBold":
				this.toggle("bold");
				return;
			case "formatItalic":
				this.toggle("italic");
				return;
			case "formatUnderline":
				this.toggle("underline");
				return;
		}
	}

	/**
	 * Enter, as Docs takes it: on an empty list item it leaves the list, or goes up a level; at the
	 * end of a heading the new paragraph is Normal text; anywhere else both halves keep the style.
	 */
	private enter(from: number, to: number): void {
		const nl = this.paragraphEnd(from);
		const para = this.units[nl]?.para;
		if (from === to && this.paragraphStart(from) === nl && para?.bullet) {
			if ((para.bullet.nestingLevel ?? 0) > 0) this.nest(-1);
			else {
				const range = { startIndex: from, endIndex: from + 1 };
				this.run([{ deleteParagraphBullets: { range } }, { updateParagraphStyle: { range, paragraphStyle: { indentStart: { magnitude: 0, unit: "PT" }, indentFirstLine: { magnitude: 0, unit: "PT" } }, fields: "indentStart,indentFirstLine" } }]);
			}
			return;
		}
		const heading = to === nl && this.effective(para).type !== "NORMAL_TEXT";
		let at: number | undefined;
		this.transact(() => {
			at = this.replace(from, to, "\n");
			if (at !== undefined && heading) this.run([{ updateParagraphStyle: { range: { startIndex: at + 1, endIndex: at + 2 }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } }]);
		});
		if (at === undefined) return;
		this.select(at + 1);
		// What is typed after a heading reads as Normal text, not in the heading's own run style.
		if (heading) this.pending = { at: at + 1, ts: {} };
		this.autolink(at);
	}

	/** At a paragraph's start: its bullet off (Docs keeps where its text sat), or its indent back a step. */
	private outdent(at: number): boolean {
		const nl = this.paragraphEnd(at);
		const para = this.units[nl]?.para;
		const range = { startIndex: at, endIndex: Math.max(at + 1, nl) };
		if (para?.bullet) {
			this.run([{ deleteParagraphBullets: { range } }]);
			return true;
		}
		const start = pt(para?.ps.indentStart);
		if (start <= 0) return false;
		const step = (d: DocsDimension | undefined) => ({ magnitude: Math.max(0, pt(d) - 36), unit: "PT" });
		this.run([{ updateParagraphStyle: { range, paragraphStyle: { indentStart: step(para?.ps.indentStart), indentFirstLine: step(para?.ps.indentFirstLine) }, fields: "indentStart,indentFirstLine" } }]);
		return true;
	}

	/** After a space: "* ", "- ", "1. ", "1) ", "A. " or "I. " at a paragraph's start becomes a list, as Docs detects one; a web address before it a link. */
	private autoformat(space: number): void {
		const text = this.sync.text;
		const start = this.paragraphStart(space);
		const head = text.slice(start, space);
		const preset = { "*": "BULLET_DISC_CIRCLE_SQUARE", "-": "BULLET_DISC_CIRCLE_SQUARE", "1.": "NUMBERED_DECIMAL_ALPHA_ROMAN", "1)": "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS", "A.": "NUMBERED_UPPERALPHA_ALPHA_ROMAN", "I.": "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL" }[head];
		if (preset && !this.units[this.paragraphEnd(space)]?.para?.bullet) {
			this.transact(() => {
				if (this.replace(start, space + 1, "") === undefined) return;
				const range = { startIndex: start, endIndex: Math.max(start + 1, this.paragraphEnd(start)) };
				this.run([{ createParagraphBullets: { range, bulletPreset: preset } }]);
			});
			this.select(start);
			return;
		}
		this.autolink(space);
	}

	/** A web address or an email address just finished, before `end`: linked, as Docs detects one. */
	private autolink(end: number): void {
		const text = this.sync.text;
		let start = end;
		while (start > 1 && !/[\s-￼]/.test(text[start - 1]!)) start--;
		const word = text.slice(start, end).replace(/[.,;:!?)\]'"’”]+$/, "");
		if (!word || this.units[start]?.ts?.link) return;
		const url = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(word) ? word : /^www\.[^\s/]+\.[^\s]+$/i.test(word) ? `https://${word}` : /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(word) ? `mailto:${word}` : undefined;
		if (!url) return;
		const caret = this.range();
		this.run([{ updateTextStyle: { range: { startIndex: start, endIndex: start + word.length }, textStyle: { link: { url } }, fields: "link" } }]);
		if (caret) this.select(caret[0], caret[1]);
	}

	/** Pasted: Docs keeps bold, italic, underline, strikethrough and links from what was copied. */
	private paste(from: number, to: number, data: DataTransfer | null): void {
		const plain = (data?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
		const html = data?.getData("text/html");
		const runs = html ? runsOf(html) : undefined;
		if (!runs?.length || !runs.some((r) => Object.keys(r.ts).length)) {
			this.replace(from, to, plain);
			return;
		}
		const text = runs.map((r) => r.text).join("");
		this.transact(() => {
			const at = this.replace(from, to, text);
			if (at === undefined) return;
			const requests: DocsRequest[] = [];
			let i = at;
			for (const run of runs) {
				const fields = Object.keys(run.ts);
				if (fields.length) requests.push({ updateTextStyle: { range: { startIndex: i, endIndex: i + run.text.length }, textStyle: run.ts, fields: fields.join(",") } });
				i += run.text.length;
			}
			if (requests.length) this.run(requests);
			this.select(at + text.length);
		});
	}

	/** Copied as Docs copies: the words as plain text, and as styled HTML without the page's own furniture. */
	private copy(event: ClipboardEvent, cut: boolean): void {
		const range = this.range(true);
		const selection = document.getSelection();
		if (!range || range[0] === range[1] || !selection?.rangeCount || !event.clipboardData) return;
		event.preventDefault();
		const live = selection.getRangeAt(0);
		const holder = document.createElement("div");
		let content: Node = live.cloneContents();
		// A selection inside one run copies only its text: the run's own style goes round it, and any run it sits in.
		for (let node: Node | null = live.commonAncestorContainer.nodeType === Node.TEXT_NODE ? live.commonAncestorContainer.parentElement : live.commonAncestorContainer; node && node instanceof HTMLElement && !node.classList.contains("gd-p") && node !== this.page; node = node.parentElement) {
			const wrap = node.cloneNode(false) as HTMLElement;
			wrap.append(content);
			content = wrap;
		}
		holder.append(content);
		for (const junk of holder.querySelectorAll(".gd-gap, .gd-marker, br[data-empty]")) junk.remove();
		// Inside one paragraph the copy holds only runs: the paragraph's own font and size go round them.
		const p = (live.commonAncestorContainer.nodeType === Node.TEXT_NODE ? live.commonAncestorContainer.parentElement : (live.commonAncestorContainer as HTMLElement))?.closest<HTMLElement>(".gd-p");
		let html = holder.innerHTML;
		if (p) {
			const s = getComputedStyle(p);
			html = `<span style="font-family: ${s.fontFamily.replace(/"/g, "'")}; font-size: ${s.fontSize}; color: ${s.color}">${html}</span>`;
		}
		event.clipboardData.setData("text/html", html);
		event.clipboardData.setData("text/plain", this.quote());
		if (cut && !this.sync.readOnly) this.replace(range[0], range[1], "");
	}

	private key(event: KeyboardEvent): void {
		// The board's own keys (its editor, its undo) are not this page's: the Doc keeps them.
		event.stopPropagation();
		if (event.isComposing) return;
		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (mod && !event.altKey && key === "z") {
			event.preventDefault();
			if (event.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if (mod && !event.altKey && !event.shiftKey && key === "y") {
			event.preventDefault();
			this.redo();
			return;
		}
		if (this.sync.readOnly) return;
		const action = this.shortcut(event, mod);
		if (action) {
			event.preventDefault();
			action();
		} else if (event.key === "Tab" && !mod && !event.altKey) {
			event.preventDefault();
			this.tab(event.shiftKey);
		} else if (event.key === "Enter" && mod && !event.altKey && !event.shiftKey) {
			event.preventDefault();
			this.pageBreak();
		}
	}

	/** Docs' keyboard shortcuts, by the key's place on the keyboard so a layout or Option does not change them. */
	private shortcut(event: KeyboardEvent, mod: boolean): (() => void) | undefined {
		const code = event.code;
		if (!mod) return event.altKey && event.shiftKey && code === "Digit5" ? () => this.toggle("strikethrough") : undefined;
		if (event.altKey) {
			if (event.shiftKey) return undefined;
			const digit = /^Digit([0-6])$/.exec(code)?.[1];
			if (digit) return () => this.setParagraph({ namedStyleType: digit === "0" ? "NORMAL_TEXT" : `HEADING_${digit}` }, "namedStyleType");
			if (code === "KeyM") return () => this.host.command?.("comment");
			return undefined;
		}
		if (event.shiftKey) {
			const align = { KeyL: "START", KeyE: "CENTER", KeyR: "END", KeyJ: "JUSTIFIED" }[code];
			if (align) return () => this.setParagraph({ alignment: align }, "alignment");
			if (code === "Digit7") return () => this.list(true);
			if (code === "Digit8") return () => this.list(false);
			if (code === "KeyX") return () => this.toggle("strikethrough");
			if (code === "Period") return () => this.bump(1);
			if (code === "Comma") return () => this.bump(-1);
			return undefined;
		}
		switch (code) {
			case "KeyB":
				return () => this.toggle("bold");
			case "KeyI":
				return () => this.toggle("italic");
			case "KeyU":
				return () => this.toggle("underline");
			case "Period":
				return () => this.baseline("SUPERSCRIPT");
			case "Comma":
				return () => this.baseline("SUBSCRIPT");
			case "Backslash":
				return () => this.clearFormatting();
			case "BracketRight":
				return () => this.indent(1);
			case "BracketLeft":
				return () => this.indent(-1);
			case "KeyK":
				return this.host.command ? () => this.host.command!("link") : undefined;
		}
		return undefined;
	}

	/**
	 * Tab, as Docs takes it: in a table, the next cell (Shift, the one before), and past the last a
	 * new row; at a list item's start, or across several, a level down (Shift, up); else a tab.
	 */
	private tab(back: boolean): void {
		const range = this.range();
		if (!range) return;
		const nls = this.paragraphsIn(range[0], range[1]);
		const listed = nls.some((nl) => this.units[nl]!.para?.bullet);
		if (listed && (back || nls.length > 1 || this.paragraphStart(range[0]) === range[0])) return void this.nest(back ? -1 : 1);
		const at = this.cellAt();
		if (at) {
			const grid = this.grid(at.table);
			const k = grid?.cells.findIndex((c) => c.r === at.row && c.c === at.column) ?? -1;
			const next = grid?.cells[k + (back ? -1 : 1)];
			if (next) this.select(next.start, next.end);
			else if (!back && grid) {
				this.table("rowBelow");
				this.afterLoad = { table: at.table, row: at.row + 1, column: 0 };
			}
			return;
		}
		if (!back) this.replace(range[0], range[1], "\t", true);
	}

	/** A page break where the caret is: Docs makes it, with a new paragraph after. */
	private pageBreak(): void {
		const range = this.range();
		if (!range) return;
		let at = range[0];
		if (range[0] !== range[1]) at = this.replace(range[0], range[1], "") ?? at;
		const done = this.breakPage({ at, op: "insert" });
		if (done) this.record({ pagebreak: done });
	}

	private breakPage(step: { at: number; op: "insert" | "delete" }): { at: number; op: "insert" | "delete" } | undefined {
		if (step.op === "insert") {
			if (this.cellAt()) return undefined;
			this.host.style([{ insertPageBreak: { location: { index: step.at } } }]);
			this.caretAfterLoad = step.at + 2;
			return { at: step.at, op: "delete" };
		}
		if (this.sync.text.slice(step.at, step.at + 2) !== `${OBJECT_UNIT}\n`) return undefined;
		this.replaying = true;
		try {
			this.replace(step.at, step.at + 2, "");
		} finally {
			this.replaying = false;
		}
		return { at: step.at, op: "insert" };
	}

	undo(): void {
		this.step(this.undoStack, this.redoStack);
	}

	redo(): void {
		this.step(this.redoStack, this.undoStack);
	}

	private step(from: Step[], to: Step[]): void {
		this.pending = undefined;
		for (let step = from.pop(); step; step = from.pop()) {
			const done = this.apply(step);
			// A step whose words someone else has since changed is passed over, as Docs passes it.
			if (!done) continue;
			to.push(done);
			return;
		}
	}

	/** Do what a step says, and answer the step that takes it back. */
	private apply(step: Step): Step | undefined {
		if (step.group) {
			const done: Step[] = [];
			for (const part of [...step.group].reverse()) {
				const back = this.apply(part);
				if (back) done.push(back);
			}
			return done.length ? { group: done } : undefined;
		}
		if (step.splice) {
			const s = step.splice;
			if (this.sync.text.slice(s.at, s.at + s.before.length) !== s.before) return undefined;
			this.replaying = true;
			try {
				this.pending = undefined;
				const before = this.sync.text.slice(s.at, s.at + s.before.length);
				this.sync.edit({ at: s.at, before, text: s.text });
				this.select(s.at + s.text.length);
			} finally {
				this.replaying = false;
			}
			return { splice: { at: s.at, before: s.text, text: s.before } };
		}
		if (step.table) {
			const done = this.perform(step.table);
			return done ? { table: done } : undefined;
		}
		if (step.pagebreak) {
			const done = this.breakPage(step.pagebreak);
			return done ? { pagebreak: done } : undefined;
		}
		if (step.requests && step.inverse) {
			this.applyLocal(step.inverse);
			this.host.style(structuredClone(step.inverse));
			this.render();
			const range = (Object.values(step.inverse[0] ?? {})[0] as { range?: { startIndex: number; endIndex: number } } | undefined)?.range;
			if (range) this.select(range.startIndex, range.endIndex);
			return { requests: step.inverse, inverse: step.requests };
		}
		return undefined;
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
	private caretStyle(at: number): DocsTextStyle | undefined {
		const left = this.units[at - 1];
		const right = this.units[at];
		const ts = left && left.ch !== "\n" && !isStruct(left.ch) && !left.obj ? left.ts : right && right.ch !== "\n" && !right.obj ? right.ts : (left?.ts ?? right?.ts);
		return ts ? { ...ts } : undefined;
	}

	private paragraphEnd(index: number): number {
		for (let i = Math.max(0, index); i < this.units.length; i++) if (this.units[i]!.ch === "\n") return i;
		return this.units.length - 1;
	}

	private paragraphStart(index: number): number {
		let i = Math.max(1, index);
		while (i > 1 && this.units[i - 1]!.ch !== "\n" && !isStruct(this.units[i - 1]!.ch)) i--;
		return i;
	}

	/**
	 * What a style goes on: the selection; with nothing selected and the caret inside a word, that
	 * word, as Docs does; else "caret", the next typing there.
	 */
	private textRange(): [number, number] | "caret" | undefined {
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

	/**
	 * Docs requests made here: applied to the page at once, sent to Google, and kept for undo with
	 * the requests that put back what they changed.
	 */
	private run(requests: DocsRequest[], select?: [number, number]): void {
		if (!requests.length) return;
		const inverse = this.inverseOf(requests);
		this.applyLocal(requests);
		// A copy goes out: the step's own requests move with later edits, and what was sent must not.
		this.host.style(structuredClone(requests));
		this.record({ requests, inverse });
		this.render();
		if (select) this.select(select[0], select[1]);
	}

	/** Requests as Docs would apply them, to the units here: the styles a page draws with. */
	private applyLocal(requests: readonly DocsRequest[]): void {
		for (const request of requests) {
			if ("updateTextStyle" in request) {
				const { range, textStyle, fields } = request.updateTextStyle;
				for (let i = range.startIndex; i < Math.min(range.endIndex, this.units.length); i++) {
					const unit = this.units[i]!;
					if (unit.ch === "\n" || isStruct(unit.ch)) continue;
					const next = { ...(unit.ts ?? {}) } as Record<string, unknown>;
					for (const field of fields.split(",")) {
						// A field left out goes back to the paragraph's; false is kept, as Docs keeps it, to undo a heading's bold.
						const value = (textStyle as Record<string, unknown>)[field];
						if (value === undefined) delete next[field];
						else next[field] = value;
					}
					unit.ts = next as DocsTextStyle;
				}
			} else if ("updateParagraphStyle" in request) {
				const { range, paragraphStyle, fields } = request.updateParagraphStyle;
				for (const nl of this.paragraphsIn(range.startIndex, range.endIndex)) {
					const para = (this.units[nl]!.para ??= { ps: {} });
					const next = { ...para.ps } as Record<string, unknown>;
					for (const field of fields.split(",")) {
						const value = (paragraphStyle as Record<string, unknown>)[field];
						if (value === undefined) delete next[field];
						else next[field] = value;
					}
					para.ps = next as DocsParagraphStyle;
				}
			} else if ("createParagraphBullets" in request) {
				const numbered = request.createParagraphBullets.bulletPreset.startsWith("NUMBERED");
				const hint = this.hints.get(request);
				const listId = hint?.listId ?? this.localList(numbered);
				const { startIndex, endIndex } = request.createParagraphBullets.range;
				// Made here with leading tabs for depth: the page has no tabs, so the paragraphs are counted instead of the range.
				const nls = hint ? this.paragraphsFrom(startIndex, hint.levels.length) : this.paragraphsIn(startIndex, endIndex);
				nls.forEach((nl, k) => ((this.units[nl]!.para ??= { ps: {} }).bullet = { listId, nestingLevel: hint?.levels[k] ?? 0 }));
			} else if ("deleteParagraphBullets" in request) {
				// Docs keeps the text where it sat: the list's indent becomes the paragraph's own.
				for (const nl of this.paragraphsIn(request.deleteParagraphBullets.range.startIndex, request.deleteParagraphBullets.range.endIndex)) {
					const para = this.units[nl]!.para;
					const bullet = para?.bullet;
					if (!para || !bullet) continue;
					const level = this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[bullet.nestingLevel ?? 0];
					delete para.bullet;
					if (level?.indentStart) para.ps = { ...para.ps, indentStart: level.indentStart, indentFirstLine: level.indentStart };
				}
			}
		}
	}

	/** The requests that put back what `requests` would change, from the units as they are now. */
	private inverseOf(requests: readonly DocsRequest[]): DocsRequest[] {
		const groups: DocsRequest[][] = [];
		for (const request of requests) {
			const out: DocsRequest[] = [];
			groups.push(out);
			if ("updateTextStyle" in request) {
				const { range, fields } = request.updateTextStyle;
				for (const field of fields.split(",")) {
					// Runs of the same old value, each set back to it.
					let start = range.startIndex;
					const value = (i: number) => JSON.stringify((this.units[i]?.ts as Record<string, unknown> | undefined)?.[field] ?? null);
					for (let i = range.startIndex + 1; i <= range.endIndex; i++) {
						if (i < range.endIndex && value(i) === value(start)) continue;
						const old = (this.units[start]?.ts as Record<string, unknown> | undefined)?.[field];
						out.push({ updateTextStyle: { range: { startIndex: start, endIndex: i }, textStyle: (old === undefined ? {} : { [field]: old }) as DocsTextStyle, fields: field } });
						start = i;
					}
				}
			} else if ("updateParagraphStyle" in request) {
				const { range, fields } = request.updateParagraphStyle;
				for (const nl of this.paragraphsIn(range.startIndex, range.endIndex)) {
					const ps = (this.units[nl]!.para?.ps ?? {}) as Record<string, unknown>;
					const old: Record<string, unknown> = {};
					for (const field of fields.split(",")) if (ps[field] !== undefined) old[field] = ps[field];
					const start = this.paragraphStart(nl);
					out.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: Math.max(start + 1, nl) }, paragraphStyle: old as DocsParagraphStyle, fields } });
				}
			} else if ("createParagraphBullets" in request || "deleteParagraphBullets" in request) {
				const range = "createParagraphBullets" in request ? request.createParagraphBullets.range : request.deleteParagraphBullets.range;
				const hint = "createParagraphBullets" in request ? this.hints.get(request) : undefined;
				const nls = hint ? this.paragraphsFrom(range.startIndex, hint.levels.length) : this.paragraphsIn(range.startIndex, range.endIndex);
				if (!nls.length) continue;
				const first = this.paragraphStart(nls[0]!);
				out.push({ deleteParagraphBullets: { range: { startIndex: first, endIndex: Math.max(first + 1, nls[nls.length - 1]!) } } });
				// Each paragraph's own indents as they were, then each run of list items as it was, last first.
				for (const nl of nls) {
					const ps = this.units[nl]!.para?.ps ?? {};
					const start = this.paragraphStart(nl);
					out.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: Math.max(start + 1, nl) }, paragraphStyle: { ...(ps.indentStart ? { indentStart: ps.indentStart } : {}), ...(ps.indentFirstLine ? { indentFirstLine: ps.indentFirstLine } : {}) }, fields: "indentStart,indentFirstLine" } });
				}
				const runs: number[][] = [];
				nls.forEach((nl, k) => {
					const bullet = this.units[nl]!.para?.bullet;
					const prev = k > 0 ? this.units[nls[k - 1]!]!.para?.bullet : undefined;
					if (!bullet) return;
					if (prev && prev.listId === bullet.listId) runs[runs.length - 1]!.push(nl);
					else runs.push([nl]);
				});
				for (const run of runs.reverse()) {
					const bullet = this.units[run[0]!]!.para!.bullet!;
					out.push(...this.bullets(run, run.map((nl) => this.units[nl]!.para?.bullet?.nestingLevel ?? 0), this.isNumbered(bullet), bullet.listId));
				}
			}
		}
		// Undone in the opposite order, so a later request's undo does not fight an earlier one's.
		return dedupeBullets(groups.reverse().flat());
	}

	/** What a bullets request made here means for the page, which never sees the tabs that tell Docs each paragraph's depth. */
	private readonly hints = new WeakMap<object, { levels: number[]; listId?: string }>();

	/**
	 * Requests that make `nls` one list at these depths: Docs reads a list item's depth from the
	 * tabs it starts with, and takes them away, so a tab goes in for each level, last paragraph first.
	 */
	private bullets(nls: number[], levels: number[], numbered: boolean, listId?: string): DocsRequest[] {
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
	}

	/** The newlines of `count` paragraphs, from the one `index` is in. */
	private paragraphsFrom(index: number, count: number): number[] {
		const out: number[] = [];
		for (let i = this.paragraphEnd(index); out.length < count && i < this.units.length; i = this.paragraphEnd(i + 1)) {
			out.push(i);
			if (i >= this.units.length - 1) break;
		}
		return out;
	}

	/**
	 * List items a level deeper or shallower: the list they are in is made again with each item's
	 * new depth, so its numbering carries on. False when none of the selection is a list item.
	 */
	nest(delta: number): boolean {
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
	}

	/** The paragraphs' indent a step in or out (Docs' half inch), or a list's items a level. */
	indent(delta: number): void {
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
	}

	/** The font a point bigger or smaller, as Ctrl+Shift+. and , do. */
	bump(delta: number): void {
		this.setText("fontSize", { magnitude: Math.max(1, Math.round(this.state().size) + delta), unit: "PT" });
	}

	/** Superscript or subscript, or back to the line when it already is. */
	baseline(kind: "SUPERSCRIPT" | "SUBSCRIPT"): void {
		this.setText("baselineOffset", this.state().baseline === kind ? "NONE" : kind);
	}

	/** The newline of each paragraph a range touches. */
	private paragraphsIn(from: number, to: number): number[] {
		const out: number[] = [];
		for (let i = this.paragraphEnd(from); i < this.units.length; i = this.paragraphEnd(i + 1)) {
			out.push(i);
			if (i + 1 >= to || i >= this.units.length - 1) break;
		}
		return out;
	}

	private isNumbered(bullet: { listId?: string; nestingLevel?: number }): boolean {
		const glyph = this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[bullet.nestingLevel ?? 0]?.glyphType;
		return !!glyph && glyph !== "GLYPH_TYPE_UNSPECIFIED" && glyph !== "NONE";
	}

	/** A list for bullets made here, drawn until Google's own comes back. */
	private localList(numbered: boolean): string {
		const listId = numbered ? "local-numbered" : "local-bulleted";
		if (this.doc && !this.doc.lists?.[listId]) {
			this.doc.lists = { ...(this.doc.lists ?? {}), [listId]: { listProperties: { nestingLevels: Array.from({ length: 9 }, (_, k) => ({ glyphType: numbered ? "DECIMAL" : "GLYPH_TYPE_UNSPECIFIED", glyphFormat: numbered ? `%${k}.` : "", indentStart: { magnitude: 36 + 36 * k, unit: "PT" }, indentFirstLine: { magnitude: 18 + 36 * k, unit: "PT" } })) } } };
		}
		return listId;
	}

	/** Set one text style on the selection (`undefined` clears it), here at once and in Google next. */
	setText(field: keyof DocsTextStyle, value: unknown): void {
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
	}

	/** On for the whole selection unless all of it already has it, as Docs decides. */
	toggle(field: "bold" | "italic" | "underline" | "strikethrough"): void {
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
	}

	/** Set a paragraph style on every paragraph the selection touches. */
	setParagraph(style: DocsParagraphStyle, fields: string): void {
		const range = this.range();
		if (!range) return;
		const from = this.paragraphStart(range[0]);
		const to = this.paragraphEnd(range[1]);
		this.run([{ updateParagraphStyle: { range: { startIndex: from, endIndex: Math.max(from + 1, to) }, paragraphStyle: style, fields } }], range);
	}

	/** Bullets or numbers on the selection's paragraphs, or off when they already have that kind. */
	list(numbered: boolean): void {
		const range = this.range();
		if (!range) return;
		const from = this.paragraphStart(range[0]);
		const to = this.paragraphEnd(range[1]);
		const now = this.state();
		const off = numbered ? now.numbered : now.bullet;
		const r = { startIndex: from, endIndex: Math.max(from + 1, to) };
		this.run(off ? [{ deleteParagraphBullets: { range: r } }] : [{ deleteParagraphBullets: { range: r } }, { createParagraphBullets: { range: r, bulletPreset: numbered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } }], range);
	}

	clearFormatting(): void {
		const range = this.textRange();
		if (!range) return;
		if (range === "caret") {
			this.pending = { at: this.range()![0], ts: {} };
			this.host.selection?.();
			return;
		}
		this.run([{ updateTextStyle: { range: { startIndex: range[0], endIndex: range[1] }, textStyle: {}, fields: "bold,italic,underline,strikethrough,smallCaps,foregroundColor,backgroundColor,fontSize,weightedFontFamily,baselineOffset" } }], range);
	}

	// -- tables ---------------------------------------------------------------------------------

	/** The table cell the caret is in: the table's index now, and the cell's row and column. */
	cellAt(): { table: number; row: number; column: number } | undefined {
		const range = this.range();
		const unit = range ? this.units[range[0]] ?? this.units[range[0] - 1] : undefined;
		const cell = unit?.cell;
		if (!cell) return undefined;
		const table = this.units.findIndex((u) => u.ch === STRUCT.table && u.tid === cell.t);
		return table === -1 ? undefined : { table, row: cell.r, column: cell.c };
	}

	/**
	 * A table's shape changed: a row or column in or out, or a new table. Docs makes the structure, so
	 * the page waits for the Doc to come back to draw it; these are not undone here.
	 */
	table(action: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "deleteRow" | "deleteCol" | "insert"): void {
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
	}

	/**
	 * A table's shape changed, as Docs requests: a row or a column in or out, or a whole table. The
	 * answer is the step that undoes it. A row or column taken out keeps its cells' words, so
	 * putting it back fills them in once the Doc has made the new cells.
	 */
	private perform(step: TableStep): TableStep | undefined {
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
	}

	/** A table as it stands, by the index of its start: its rows, columns, cells and where it ends. */
	private grid(start: number): { rows: number; columns: number; end: number; cells: Array<{ r: number; c: number; start: number; end: number; text: string }> } | undefined {
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
	}

	/** Words to put back in a row or column once the Doc has made it again. */
	private fill: TableStep | undefined;

	/** After a Doc arrives: the row or column waiting for its words, given them as typing. */
	private refill(): void {
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
	}

	/** A link on the selection or the word; with neither, the address goes in as linked text, as Docs puts it. */
	link(url: string | undefined): void {
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
	}

	focus(): void {
		this.page.focus();
	}

	// -- comments -------------------------------------------------------------------------------

	/**
	 * The Doc's open comments, each highlighted on the words it quotes. Drive keeps a comment's
	 * quoted words, not its place, so each is found in the text in order, the first not taken
	 * by an earlier one; a comment whose words are gone shows in the list with no highlight.
	 */
	setComments(comments: ReadonlyArray<{ id: string; quotedFileContent?: { value?: string } }>): void {
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

function firstIndex(node: Node): number | undefined {
	const el = node as HTMLElement;
	if (el.dataset?.s !== undefined && !el.classList.contains("gd-p")) return Number(el.dataset.s);
	if (node.nodeType === Node.TEXT_NODE) {
		const span = node.parentElement?.closest<HTMLElement>("[data-s]");
		return span ? Number(span.dataset.s) : undefined;
	}
	for (const child of node.childNodes) {
		const at = firstIndex(child);
		if (at !== undefined) return at;
	}
	return undefined;
}

function lastIndex(node: Node): number | undefined {
	const el = node as HTMLElement;
	if (el.dataset?.s !== undefined && !el.classList.contains("gd-p")) return Number(el.dataset.s) + (el.dataset.obj !== undefined ? 1 : (el.textContent?.length ?? 0));
	for (const child of [...node.childNodes].reverse()) {
		const at = lastIndex(child);
		if (at !== undefined) return at;
	}
	return undefined;
}

const WORD = /[\p{L}\p{N}_'’]/u;
function wordStart(text: string, at: number): number {
	let i = at;
	while (i > 1 && /[ \t]/.test(text[i - 1]!)) i--;
	while (i > 1 && WORD.test(text[i - 1]!)) i--;
	return i === at && at > 1 && text[at - 1] !== "\n" && !isStruct(text[at - 1]!) ? at - 1 : i;
}
function wordEnd(text: string, at: number): number {
	let i = at;
	while (i < text.length && WORD.test(text[i]!)) i++;
	while (i < text.length && /[ \t]/.test(text[i]!)) i++;
	return i;
}
function lineStart(text: string, at: number): number {
	let i = at;
	while (i > 1 && text[i - 1] !== "\n" && !isStruct(text[i - 1]!)) i--;
	return i;
}

function numeral(n: number, type: string): string {
	if (type === "ALPHA" || type === "UPPER_ALPHA") {
		let s = "";
		for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
		return type === "UPPER_ALPHA" ? s.toUpperCase() : s;
	}
	if (type === "ROMAN" || type === "UPPER_ROMAN") {
		const table: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
		let s = "";
		let k = n;
		for (const [v, r] of table) while (k >= v) {
			s += r;
			k -= v;
		}
		return type === "UPPER_ROMAN" ? s.toUpperCase() : s;
	}
	if (type === "ZERO_DECIMAL") return String(n).padStart(2, "0");
	return String(n);
}

/** A run's style as CSS; `base` is what the paragraph already says, so only differences are written. */
function applyText(el: HTMLElement, ts: DocsTextStyle, base?: DocsTextStyle): void {
	const s = el.style;
	const family = ts.weightedFontFamily?.fontFamily;
	if (family && family !== base?.weightedFontFamily?.fontFamily) {
		loadFont(family);
		s.fontFamily = `"${family}", Arial, sans-serif`;
	}
	const weight = ts.bold ? 700 : (ts.weightedFontFamily?.weight ?? 400);
	if (!base || weight !== (base.bold ? 700 : (base.weightedFontFamily?.weight ?? 400))) s.fontWeight = String(weight);
	if (!base || !!ts.italic !== !!base.italic) s.fontStyle = ts.italic ? "italic" : "normal";
	const size = ts.fontSize?.magnitude;
	const sub = ts.baselineOffset === "SUPERSCRIPT" || ts.baselineOffset === "SUBSCRIPT";
	if (size && (!base || size !== base.fontSize?.magnitude || sub)) s.fontSize = `${size * PT * (sub ? 0.66 : 1)}px`;
	if (sub) s.verticalAlign = ts.baselineOffset === "SUPERSCRIPT" ? "super" : "sub";
	const lines = [ts.underline || ts.link?.url ? "underline" : "", ts.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
	if (lines || base) s.textDecoration = lines || "none";
	const color = cssColor(ts.foregroundColor) ?? (ts.link?.url ? "rgb(17, 85, 204)" : undefined);
	if (color && (!base || color !== cssColor(base.foregroundColor))) s.color = color;
	const background = cssColor(ts.backgroundColor);
	if (background) s.backgroundColor = background;
	if (ts.smallCaps) s.fontVariant = "small-caps";
}

function cellStyle(td: HTMLTableCellElement, style: Record<string, unknown> | undefined): void {
	const st = (style ?? {}) as { backgroundColor?: DocsColor; paddingTop?: DocsDimension; paddingBottom?: DocsDimension; paddingLeft?: DocsDimension; paddingRight?: DocsDimension; contentAlignment?: string; columnSpan?: number; rowSpan?: number } & Record<string, unknown>;
	const bg = cssColor(st.backgroundColor);
	if (bg) td.style.background = bg;
	const p = (d: DocsDimension | undefined, f: number) => `${pt(d, f) * PT}px`;
	td.style.padding = `${p(st.paddingTop, 5)} ${p(st.paddingRight, 5)} ${p(st.paddingBottom, 5)} ${p(st.paddingLeft, 5)}`;
	td.style.verticalAlign = { MIDDLE: "middle", BOTTOM: "bottom" }[st.contentAlignment ?? ""] ?? "top";
	if (st.columnSpan && st.columnSpan > 1) td.colSpan = st.columnSpan;
	if (st.rowSpan && st.rowSpan > 1) td.rowSpan = st.rowSpan;
	for (const side of ["Top", "Bottom", "Left", "Right"] as const) {
		const border = st[`border${side}`] as { width?: DocsDimension; color?: DocsColor; dashStyle?: string } | undefined;
		if (!border) continue;
		// A width Google leaves out is 0: no line.
		const width = pt(border.width) * PT;
		td.style.setProperty(`border-${side.toLowerCase()}`, width > 0 ? `${width}px ${border.dashStyle === "DOT" ? "dotted" : border.dashStyle === "DASH" ? "dashed" : "solid"} ${cssColor(border.color) ?? "transparent"}` : "none");
	}
}

/** Every index of the Doc as a unit with the style it reads in. */
function buildUnits(doc: DocsDocument): Unit[] {
	const units: Unit[] = [];
	const pad = (index: number | undefined, cell?: Unit["cell"]) => {
		while (index !== undefined && units.length < index) units.push({ ch: STRUCT.other, ...(cell ? { cell } : {}) });
	};
	const walk = (content: readonly DocsStructuralElement[] | undefined, cell?: Unit["cell"]) => {
		for (const element of content ?? []) {
			pad(element.startIndex, cell);
			if (element.sectionBreak) units.push({ ch: STRUCT.section });
			else if (element.paragraph) {
				const para = { ps: element.paragraph.paragraphStyle ?? {}, ...(element.paragraph.bullet ? { bullet: element.paragraph.bullet } : {}) };
				for (const part of element.paragraph.elements ?? []) {
					pad(part.startIndex, cell);
					if (part.textRun) {
						const content = part.textRun.content ?? "";
						for (let i = 0; i < content.length; i++) {
							const ch = content[i]!;
							const sug = (part.textRun as { suggestedInsertionIds?: string[] }).suggestedInsertionIds?.length ? "ins" : (part.textRun as { suggestedDeletionIds?: string[] }).suggestedDeletionIds?.length ? "del" : undefined;
							units.push({ ch, ...(part.textRun.textStyle ? { ts: part.textRun.textStyle } : {}), ...(cell ? { cell } : {}), ...(ch === "\n" ? { para } : {}), ...(sug ? { sug } : {}) });
						}
					} else {
						const span = Math.max(1, (part.endIndex ?? 0) - (part.startIndex ?? 0));
						for (let i = 0; i < span; i++) units.push({ ch: OBJECT_UNIT, ...(i === 0 ? { obj: part } : {}), ...(cell ? { cell } : {}) });
					}
				}
			} else if (element.table) {
				const t = units.length;
				units.push({ ch: STRUCT.table, table: element.table, tid: t, ...(cell ? { cell } : {}) });
				(element.table.tableRows ?? []).forEach((row, r) => {
					pad(row.startIndex, { t, r, c: 0 });
					units.push({ ch: STRUCT.row, cell: { t, r, c: 0 } });
					(row.tableCells ?? []).forEach((c, k) => {
						pad(c.startIndex, { t, r, c: k });
						units.push({ ch: STRUCT.cell, cell: { t, r, c: k }, ...(c.tableCellStyle ? { cellStyle: c.tableCellStyle } : {}) });
						walk(c.content, { t, r, c: k });
					});
				});
			} else units.push({ ch: STRUCT.other, ...(cell ? { cell } : {}) });
			pad(element.endIndex, cell);
		}
	};
	walk(doc.body?.content);
	return units;
}

/** One undo step: a keystroke's splice, or a style's requests and the ones that undo it. */
interface Step {
	splice?: Splice;
	requests?: DocsRequest[];
	inverse?: DocsRequest[];
	/** A table's shape, done in Docs: what to do to undo it. */
	table?: TableStep;
	/** A page break in or out at `at`. */
	pagebreak?: { at: number; op: "insert" | "delete" };
	/** Several steps that undo as one: typing and the style it was given, a paste, an autoformat. */
	group?: Step[];
	/** Typing more of the same kind may join this step (`join`), when it comes soon after `time`. */
	typing?: "ins" | "del";
	time?: number;
}

/** A row or column in or out at `index`, or a table in or out at `at`, for a table starting at `table`. */
interface TableStep {
	kind: "row" | "col" | "table";
	op: "insert" | "delete";
	table: number;
	index: number;
	at?: number;
	/** The words of the cells a deleted row or column had, to put back. */
	texts?: string[];
}

/** An index moved past a splice: inside text it replaced, to where that text starts. */
function movePoint(p: number, s: Splice, end = false): number {
	if (p < s.at || (p === s.at && !end)) return p;
	if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
	return end ? s.at + s.text.length : s.at;
}

/** An undo step moved past someone's splice, so it still means the same words. */
function shiftStep(step: Step, s: Splice): void {
	for (const part of step.group ?? []) shiftStep(part, s);
	if (step.pagebreak) step.pagebreak = { ...step.pagebreak, at: movePoint(step.pagebreak.at, s) };
	if (step.splice) step.splice = { ...step.splice, at: movePoint(step.splice.at, s) };
	if (step.table) {
		step.table.table = movePoint(step.table.table, s);
		if (step.table.at !== undefined) step.table.at = movePoint(step.table.at, s);
	}
	for (const list of [step.requests, step.inverse]) {
		for (const request of list ?? []) {
			const body = Object.values(request)[0] as { range?: { startIndex: number; endIndex: number }; location?: { index: number } };
			if (body.range) {
				body.range.startIndex = movePoint(body.range.startIndex, s);
				body.range.endIndex = movePoint(body.range.endIndex, s, true);
			}
			if (body.location) body.location.index = movePoint(body.location.index, s);
		}
	}
}

/** One delete-then-create per paragraph is enough when several requests touched it. */
function dedupeBullets(requests: DocsRequest[]): DocsRequest[] {
	const seen = new Set<string>();
	return requests.filter((r) => {
		if (!("deleteParagraphBullets" in r) && !("createParagraphBullets" in r)) return true;
		const key = JSON.stringify(r);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export { applySplice };
