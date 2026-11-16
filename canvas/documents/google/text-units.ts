import { applySplice, type Splice } from "../model.ts";
import type { DocsColor, DocsDimension, DocsDocument, DocsParagraphElement, DocsParagraphStyle, DocsRequest, DocsStructuralElement, DocsTextStyle } from "./types.ts";
import { isStruct, OBJECT_UNIT, STRUCT } from "./units.ts";

/** The Doc as units, one per index, and the small conversions its drawing and editing share. */

export interface Unit {
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

export const PT = 96 / 72;
/** The grey between two pages, as Docs draws it. */
export const GAP = 14;
export const pt = (d: DocsDimension | undefined, fallback = 0) => (d?.magnitude ?? fallback) * (d?.unit === "PX" ? 1 / PT : 1);

/** Google's own defaults, for a Doc that does not state its named styles (a new Doc states them all). */
export const DEFAULTS: Record<string, { ts: DocsTextStyle; ps: DocsParagraphStyle }> = {
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

export function rgb(red: number, green: number, blue: number): DocsColor {
	return { color: { rgbColor: { red, green, blue } } };
}

/** A Docs colour as CSS. A colour with no `rgbColor` is none at all; an empty `rgbColor` is black, Google leaving out fields that are 0. */
export const cssColor = (c: DocsColor | undefined) => {
	const v = c?.color?.rgbColor;
	if (!v) return undefined;
	return `rgb(${Math.round((v?.red ?? 0) * 255)}, ${Math.round((v?.green ?? 0) * 255)}, ${Math.round((v?.blue ?? 0) * 255)})`;
};

/** Two text styles alike, whatever order their fields came in. */
export const sameStyle = (a: DocsTextStyle | undefined, b: DocsTextStyle | undefined) => {
	const flat = (t: DocsTextStyle | undefined) => JSON.stringify(Object.entries(t ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)));
	return flat(a) === flat(b);
};

/** A straight quote typed, as Docs' smart quotes make it: opening after a space, a line's start or an opening bracket; else closing. */
export function smartQuote(before: string | undefined, quote: string): string {
	const opening = before === undefined || /[\s([{\u2018\u201c\uE000-\uE004\uFFFC\u2014\u2013-]/.test(before);
	return quote === '"' ? (opening ? "\u201c" : "\u201d") : opening ? "\u2018" : "\u2019";
}

/**
 * Pasted HTML as runs of text with the styles Docs keeps from a paste: bold, italic, underline,
 * strikethrough and links, from tags or inline styles (Google's own copy wraps everything in a
 * `<b style="font-weight:normal">`, which the style wins over). Blocks become paragraphs.
 */
export function runsOf(html: string): Array<{ text: string; ts: DocsTextStyle }> {
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
export const loaded = new Set(["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Trebuchet MS", "Comic Sans MS", "Impact"]);
export function loadFont(family: string): void {
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

export function firstIndex(node: Node): number | undefined {
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

export function lastIndex(node: Node): number | undefined {
	const el = node as HTMLElement;
	if (el.dataset?.s !== undefined && !el.classList.contains("gd-p")) return Number(el.dataset.s) + (el.dataset.obj !== undefined ? 1 : (el.textContent?.length ?? 0));
	for (const child of [...node.childNodes].reverse()) {
		const at = lastIndex(child);
		if (at !== undefined) return at;
	}
	return undefined;
}

export const WORD = /[\p{L}\p{N}_'’]/u;
export function wordStart(text: string, at: number): number {
	let i = at;
	while (i > 1 && /[ \t]/.test(text[i - 1]!)) i--;
	while (i > 1 && WORD.test(text[i - 1]!)) i--;
	return i === at && at > 1 && text[at - 1] !== "\n" && !isStruct(text[at - 1]!) ? at - 1 : i;
}
export function wordEnd(text: string, at: number): number {
	let i = at;
	while (i < text.length && WORD.test(text[i]!)) i++;
	while (i < text.length && /[ \t]/.test(text[i]!)) i++;
	return i;
}
export function lineStart(text: string, at: number): number {
	let i = at;
	while (i > 1 && text[i - 1] !== "\n" && !isStruct(text[i - 1]!)) i--;
	return i;
}

export function numeral(n: number, type: string): string {
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
export function applyText(el: HTMLElement, ts: DocsTextStyle, base?: DocsTextStyle): void {
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

export function cellStyle(td: HTMLTableCellElement, style: Record<string, unknown> | undefined): void {
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
export function buildUnits(doc: DocsDocument): Unit[] {
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
export interface Step {
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
export interface TableStep {
	kind: "row" | "col" | "table";
	op: "insert" | "delete";
	table: number;
	index: number;
	at?: number;
	/** The words of the cells a deleted row or column had, to put back. */
	texts?: string[];
}

/** An index moved past a splice: inside text it replaced, to where that text starts. */
export function movePoint(p: number, s: Splice, end = false): number {
	if (p < s.at || (p === s.at && !end)) return p;
	if (p >= s.at + s.before.length) return p + s.text.length - s.before.length;
	return end ? s.at + s.text.length : s.at;
}

/** An undo step moved past someone's splice, so it still means the same words. */
export function shiftStep(step: Step, s: Splice): void {
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
export function dedupeBullets(requests: DocsRequest[]): DocsRequest[] {
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
