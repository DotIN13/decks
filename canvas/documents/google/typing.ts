import type { DocsDimension, DocsParagraphStyle, DocsRequest, DocsTextStyle } from "./types.ts";
import { isStruct, OBJECT_UNIT } from "./units.ts";
import { type Unit, pt, sameStyle, smartQuote, runsOf, wordStart, wordEnd, lineStart, type Step } from "./text-units.ts";
import { GoogleView } from "./view.ts";

/** How typing, keys and the clipboard change a GoogleView's Doc, added to its prototype. */

declare module "./view.ts" {
	interface GoogleView {
		replace(from: number, to: number, text: string, typing?: boolean): number | undefined;
		edit(at: number, end: number, text: string, typing: boolean): void;
		textAsItIs(from: number, to: number): DocsRequest[];
		paragraphsAsTheyAre(from: number, to: number): DocsRequest[];
		restyle(from: number, to: number, want: DocsTextStyle, force?: boolean): boolean;
		input(event: InputEvent): void;
		enter(from: number, to: number): void;
		outdent(at: number): boolean;
		autoformat(space: number): void;
		autolink(end: number): void;
		paste(from: number, to: number, data: DataTransfer | null): void;
		copy(event: ClipboardEvent, cut: boolean): void;
		key(event: KeyboardEvent): void;
		shortcut(event: KeyboardEvent, mod: boolean): (() => void) | undefined;
		tab(back: boolean): void;
		pageBreak(): void;
		breakPage(step: { at: number; op: "insert" | "delete" }): { at: number; op: "insert" | "delete" } | undefined;
		run(requests: DocsRequest[], select?: [number, number]): void;
	}
}

/**
 * Replace `from..to` with `text`, as typing does in Docs. What Docs cannot delete stays and the
 * rest of the range goes around it; the text goes where the range began. It reads in the style
 * chosen for the next typing (`pending`), else the first replaced character's, else Docs' own
 * choice, the style of the text before it. The answer is where the text went, or undefined.
 */
GoogleView.prototype.replace = function (this: GoogleView, from: number, to: number, text: string, typing = false): number | undefined {
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
};

/** One splice of the page's text, kept for undo. */
GoogleView.prototype.edit = function (this: GoogleView, at: number, end: number, text: string, typing: boolean): void {
	const before = this.sync.text.slice(at, end);
	if (!before && !text) return;
	// Paragraphs joined: undo splits them again, and gives each back the style it had.
	const restore = before && !this.replaying ? [...this.textAsItIs(at, end), ...(before.includes("\n") ? this.paragraphsAsTheyAre(at, end) : [])] : undefined;
	this.sync.edit({ at, before, text });
	const kind = !typing ? undefined : text && !text.includes("\n") ? "ins" : !text && before.length <= 2 ? "del" : undefined;
	const step: Step = { splice: { at, before: text, text: before }, ...(kind ? { typing: kind } : {}), time: Date.now() };
	this.record(restore?.length ? { group: [{ requests: [], inverse: restore }, step], ...(kind ? { typing: kind } : {}), time: step.time } : step);
};

/**
 * Requests that give the text `from..to` the style it has now, run by run: undoing a deletion
 * puts the words back as Docs does, bold where they were bold, not in the style beside them.
 * None when neither the text nor what it would take its style from has any style of its own.
 */
GoogleView.prototype.textAsItIs = function (this: GoogleView, from: number, to: number): DocsRequest[] {
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
};

/**
 * Requests that give every paragraph `from..to` touches the style it has now: its named style,
 * alignment, indents and spacing, and its bullet. Docs joins paragraphs into the first one's
 * style, so this is what undoing a join needs once the text is back.
 */
GoogleView.prototype.paragraphsAsTheyAre = function (this: GoogleView, from: number, to: number): DocsRequest[] {
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
};

/** Text set to read in `want`, when Docs would give it another style, or always with `force`; true when a style was sent. */
GoogleView.prototype.restyle = function (this: GoogleView, from: number, to: number, want: DocsTextStyle, force = false): boolean {
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
};

GoogleView.prototype.input = function (this: GoogleView, event: InputEvent): void {
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
};

/**
 * Enter, as Docs takes it: on an empty list item it leaves the list, or goes up a level; at the
 * end of a heading the new paragraph is Normal text; anywhere else both halves keep the style.
 */
GoogleView.prototype.enter = function (this: GoogleView, from: number, to: number): void {
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
};

/** At a paragraph's start: its bullet off (Docs keeps where its text sat), or its indent back a step. */
GoogleView.prototype.outdent = function (this: GoogleView, at: number): boolean {
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
};

/** After a space: "* ", "- ", "1. ", "1) ", "A. " or "I. " at a paragraph's start becomes a list, as Docs detects one; a web address before it a link. */
GoogleView.prototype.autoformat = function (this: GoogleView, space: number): void {
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
};

/** A web address or an email address just finished, before `end`: linked, as Docs detects one. */
GoogleView.prototype.autolink = function (this: GoogleView, end: number): void {
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
};

/** Pasted: Docs keeps bold, italic, underline, strikethrough and links from what was copied. */
GoogleView.prototype.paste = function (this: GoogleView, from: number, to: number, data: DataTransfer | null): void {
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
};

/** Copied as Docs copies: the words as plain text, and as styled HTML without the page's own furniture. */
GoogleView.prototype.copy = function (this: GoogleView, event: ClipboardEvent, cut: boolean): void {
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
};

GoogleView.prototype.key = function (this: GoogleView, event: KeyboardEvent): void {
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
};

/** Docs' keyboard shortcuts, by the key's place on the keyboard so a layout or Option does not change them. */
GoogleView.prototype.shortcut = function (this: GoogleView, event: KeyboardEvent, mod: boolean): (() => void) | undefined {
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
};

/**
 * Tab, as Docs takes it: in a table, the next cell (Shift, the one before), and past the last a
 * new row; at a list item's start, or across several, a level down (Shift, up); else a tab.
 */
GoogleView.prototype.tab = function (this: GoogleView, back: boolean): void {
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
};

/** A page break where the caret is: Docs makes it, with a new paragraph after. */
GoogleView.prototype.pageBreak = function (this: GoogleView): void {
	const range = this.range();
	if (!range) return;
	let at = range[0];
	if (range[0] !== range[1]) at = this.replace(range[0], range[1], "") ?? at;
	const done = this.breakPage({ at, op: "insert" });
	if (done) this.record({ pagebreak: done });
};

GoogleView.prototype.breakPage = function (this: GoogleView, step: { at: number; op: "insert" | "delete" }): { at: number; op: "insert" | "delete" } | undefined {
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
};

/**
 * Docs requests made here: applied to the page at once, sent to Google, and kept for undo with
 * the requests that put back what they changed.
 */
GoogleView.prototype.run = function (this: GoogleView, requests: DocsRequest[], select?: [number, number]): void {
	if (!requests.length) return;
	const inverse = this.inverseOf(requests);
	this.applyLocal(requests);
	// A copy goes out: the step's own requests move with later edits, and what was sent must not.
	this.host.style(structuredClone(requests));
	this.record({ requests, inverse });
	this.render();
	if (select) this.select(select[0], select[1]);
};
