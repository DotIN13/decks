import type { Splice } from "../model.ts";
import type { BlockStyle, InlineStyle, Range2 } from "../live.ts";
import { Builder, isWord } from "./builder.ts";
import { LiveEditor } from "./editor.ts";

/** What keys, the clipboard, the mouse and the toolbar do to a LiveEditor's text, added to its prototype. */

declare module "./editor.ts" {
	interface LiveEditor {
		beforeInput(event: InputEvent): void;
		targetRange(event: InputEvent): Range2 | undefined;
		lineAround(offset: number): { start: number; end: number; text: string };
		chunkKind(offset: number): string;
		prefixOf(line: string): { len: number; kind: string; match: RegExpExecArray } | undefined;
		enter(at: Range2): void;
		backspaceAtLineStart(offset: number): boolean;
		keydown(event: KeyboardEvent): void;
		hiddenSourceAt(offset: number, forward: boolean): number | undefined;
		copy(event: ClipboardEvent, cut: boolean): void;
		paste(event: ClipboardEvent): void;
		drop(event: DragEvent): void;
		pressed(event: MouseEvent): void;
		clicked(event: MouseEvent): void;
		delimiters(style: InlineStyle): [string, string] | undefined;
		around(cls: string, at: Range2): { s: number; e: number; o: number; c: number } | undefined;
		toggle(style: InlineStyle): void;
		link(): void;
		setBlock(style: BlockStyle): void;
		inTexList(offset: number): boolean;
		codeBlock(at: Range2): void;
		insertBlock(kind: "hr" | "table" | "math"): void;
	}
}

LiveEditor.prototype.beforeInput = function (this: LiveEditor, event: InputEvent): void {
	const type = event.inputType;
	if (type === "insertCompositionText" || this.composing || event.isComposing) return;
	event.preventDefault();
	if (this.sync.readOnly || !this.sync.ready) return;
	const at = this.selection();
	if (!at) return;
	const text = this.sync.text;
	switch (type) {
		case "insertText":
		case "insertReplacementText": {
			const data = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
			const range = type === "insertReplacementText" ? this.targetRange(event) ?? at : at;
			return this.replace(range, data, type === "insertText" ? "type" : "edit");
		}
		case "insertParagraph":
			return this.enter(at);
		case "insertLineBreak":
			return this.replace(at, this.tex ? "\\\\\n" : "\n");
		case "insertFromPaste":
		case "insertFromDrop":
		case "insertFromYank": {
			const data = event.dataTransfer?.getData("text/plain") ?? event.data ?? "";
			return this.replace(at, data.replace(/\r\n?/g, "\n"));
		}
		case "historyUndo":
			return this.undo();
		case "historyRedo":
			return this.redo();
		case "formatBold":
			return this.toggle("bold");
		case "formatItalic":
			return this.toggle("italic");
		case "formatUnderline":
			return this.toggle("underline");
		case "formatStrikeThrough":
			return this.toggle("strike");
		default:
			break;
	}
	if (type.startsWith("delete")) {
		const backward = type.includes("Backward");
		if (at.start === at.end && backward && type === "deleteContentBackward") {
			const special = this.backspaceAtLineStart(at.start);
			if (special) return;
		}
		let range = at.start !== at.end ? at : this.targetRange(event);
		if (!range || range.start === range.end) {
			if (backward) {
				const step = at.start >= 2 && /[\uDC00-\uDFFF]/.test(text[at.start - 1] ?? "") ? 2 : 1;
				range = { start: Math.max(0, at.start - step), end: at.start };
			} else {
				const step = /[\uD800-\uDBFF]/.test(text[at.end] ?? "") ? 2 : 1;
				range = { start: at.end, end: Math.min(text.length, at.end + step) };
			}
		}
		this.apply([{ at: range.start, before: text.slice(range.start, range.end), text: "" }], { start: range.start, end: range.start }, backward ? "delete" : "delete");
	}
};

LiveEditor.prototype.targetRange = function (this: LiveEditor, event: InputEvent): Range2 | undefined {
	const range = event.getTargetRanges?.()[0];
	if (!range) return undefined;
	const a = this.offsetAt(range.startContainer, range.startOffset);
	const b = this.offsetAt(range.endContainer, range.endOffset);
	return { start: Math.min(a, b), end: Math.max(a, b) };
};

LiveEditor.prototype.lineAround = function (this: LiveEditor, offset: number): { start: number; end: number; text: string } {
	const text = this.sync.text;
	const start = text.lastIndexOf("\n", offset - 1) + 1;
	let end = text.indexOf("\n", offset);
	if (end === -1) end = text.length;
	return { start, end, text: text.slice(start, end) };
};

LiveEditor.prototype.chunkKind = function (this: LiveEditor, offset: number): string {
	let kind = "flow";
	for (const c of this.chunks()) {
		if (Number(c.dataset.start) <= offset) kind = c.dataset.kind ?? "flow";
		else break;
	}
	return kind;
};

/** The block syntax a line starts with: a heading's `#`, a quote's `>`, a list's marker, `\item`. */
LiveEditor.prototype.prefixOf = function (this: LiveEditor, line: string): { len: number; kind: string; match: RegExpExecArray } | undefined {
	if (this.tex) {
		const item = /^(\s*)\\item(\[[^\]]*\])?[ \t]*/.exec(line);
		return item ? { len: item[0].length, kind: "ul", match: item } : undefined;
	}
	let m: RegExpExecArray | null;
	if ((m = /^ {0,3}(#{1,6})[ \t]+/.exec(line))) return { len: m[0].length, kind: `h${m[1]!.length}`, match: m };
	if ((m = /^([ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line))) return { len: m[0].length, kind: m[6] ? "task" : m[3] ? "ol" : "ul", match: m };
	if ((m = /^( {0,3}>[ \t]?)+/.exec(line))) return { len: m[0].length, kind: "quote", match: m };
	return undefined;
};

LiveEditor.prototype.enter = function (this: LiveEditor, at: Range2): void {
	const line = this.lineAround(at.start);
	const kind = this.chunkKind(at.start);
	if (kind !== "flow") {
		const indent = /^[ \t]*/.exec(line.text)![0];
		return this.replace(at, `\n${kind === "code" ? indent : ""}`);
	}
	const prefix = this.prefixOf(line.text);
	const m = prefix?.match;
	if (prefix && (prefix.kind === "ul" || prefix.kind === "ol" || prefix.kind === "task" || prefix.kind === "quote")) {
		if (line.text.slice(prefix.len).trim() === "" && at.start === at.end) {
			// Enter on an empty item ends the list, as it does in every editor.
			return this.apply([{ at: line.start, before: line.text, text: "" }], { start: line.start, end: line.start });
		}
		let next: string;
		if (this.tex) next = `${m![1]}\\item `;
		else if (prefix.kind === "quote") next = m![0];
		else if (prefix.kind === "ol") next = `${m![1]}${Number(m![3]) + 1}${m![4]}${m![5]}`;
		else next = `${m![1]}${m![2]}${m![5]}${prefix.kind === "task" ? "[ ] " : ""}`;
		return this.replace(at, `\n${next}`);
	}
	if (line.text.trim() === "") return this.replace(at, "\n");
	// A new paragraph: a blank line between, which is what a paragraph is in markdown and LaTeX.
	this.replace(at, "\n\n");
};

/** Backspace just after a line's block syntax takes the syntax off, as Typora does. True when it did. */
LiveEditor.prototype.backspaceAtLineStart = function (this: LiveEditor, offset: number): boolean {
	const line = this.lineAround(offset);
	const prefix = this.prefixOf(line.text);
	if (prefix && offset === line.start + prefix.len && this.chunkKind(offset) === "flow") {
		this.apply([{ at: line.start, before: line.text.slice(0, prefix.len), text: "" }], { start: line.start, end: line.start });
		return true;
	}
	// At the start of a paragraph after blank lines: join it to the one before, in one press.
	if (offset === line.start && offset > 1 && this.sync.text[offset - 1] === "\n" && this.sync.text[offset - 2] === "\n") {
		let from = offset - 1;
		while (from > 0 && /\s/.test(this.sync.text[from - 1]!)) from--;
		if (from === 0) return false;
		this.apply([{ at: from, before: this.sync.text.slice(from, offset), text: "" }], { start: from, end: from });
		return true;
	}
	return false;
};

LiveEditor.prototype.keydown = function (this: LiveEditor, event: KeyboardEvent): void {
	// The page owns the keyboard while it has the caret: the board around it must not take ⌘Z or Backspace too.
	if (event.key !== "Escape") event.stopPropagation();
	if (event.isComposing || this.composing) return;
	const mod = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();
	const run = (fn: () => void) => {
		event.preventDefault();
		fn();
	};
	if (mod && !event.altKey) {
		if (key === "z") return run(() => (event.shiftKey ? this.redo() : this.undo()));
		if (key === "y") return run(() => this.redo());
		if (key === "b") return run(() => this.toggle("bold"));
		if (key === "i") return run(() => this.toggle("italic"));
		if (key === "u") return run(() => this.toggle("underline"));
		if (key === "k") return run(() => this.link());
		if (key === "e" || key === "`") return run(() => this.toggle("code"));
		if (event.shiftKey && key === "x") return run(() => this.toggle("strike"));
		if (event.shiftKey && key === "h") return run(() => this.toggle("mark"));
		if (event.shiftKey && key === "m") return run(() => this.toggle("math"));
		if (/^[0-6]$/.test(event.key)) return run(() => this.setBlock(event.key === "0" ? "p" : (`h${event.key}` as BlockStyle)));
		if (event.shiftKey && (event.key === "7" || event.key === "&")) return run(() => this.setBlock("ol"));
		if (event.shiftKey && (event.key === "8" || event.key === "*")) return run(() => this.setBlock("ul"));
	}
	if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !mod && !event.shiftKey && !event.altKey) {
		// A reference, inline maths or a picture hides its source, which the caret would step over: step into it instead.
		const at = this.selection();
		if (at && at.start === at.end) {
			const into = this.hiddenSourceAt(at.start, event.key === "ArrowRight");
			if (into !== undefined) {
				event.preventDefault();
				this.place({ start: into, end: into });
				this.state();
				return;
			}
		}
	}
	if (event.key === "Tab" && !mod) {
		const at = this.selection();
		if (!at) return;
		const line = this.lineAround(at.start);
		const prefix = this.prefixOf(line.text);
		if (prefix && prefix.kind !== "quote" && !prefix.kind.startsWith("h")) {
			event.preventDefault();
			if (event.shiftKey) {
				const lead = /^( {1,4}|\t)/.exec(line.text)?.[0];
				if (lead) this.apply([{ at: line.start, before: lead, text: "" }], { start: at.start - lead.length, end: at.end - lead.length });
			} else this.apply([{ at: line.start, before: "", text: this.tex ? "  " : "    " }], { start: at.start + (this.tex ? 2 : 4), end: at.end + (this.tex ? 2 : 4) });
			return;
		}
		event.preventDefault();
		if (!event.shiftKey) this.replace(at, this.chunkKind(at.start) === "code" ? "    " : "\t");
	}
	if (event.key === "Escape") this.root.blur();
};

/**
 * Where the caret goes to step into a closed element whose source is hidden (a reference, inline
 * maths, a picture) from just before it (`forward`) or just after it; undefined when there is none.
 */
LiveEditor.prototype.hiddenSourceAt = function (this: LiveEditor, offset: number, forward: boolean): number | undefined {
	for (const el of this.root.querySelectorAll<HTMLElement>(".lv-i:not(.open)")) {
		if (!el.querySelector(":scope > .lv-src") || el.closest("[data-widget]")) continue;
		const chunk = el.closest<HTMLElement>(".lv-chunk");
		if (!chunk) continue;
		const s = Number(chunk.dataset.start) + Number(el.dataset.s);
		const e = Number(chunk.dataset.start) + Number(el.dataset.e);
		if (forward && offset === s) return s + Math.max(1, Number(el.dataset.o ?? 1));
		if (!forward && offset === e) return e - Math.max(1, Number(el.dataset.c ?? 1));
	}
	return undefined;
};

LiveEditor.prototype.copy = function (this: LiveEditor, event: ClipboardEvent, cut: boolean): void {
	const at = this.selection();
	if (!at || at.start === at.end) return;
	event.preventDefault();
	// The file's own characters, syntax and all, so pasting it elsewhere keeps its formatting.
	event.clipboardData?.setData("text/plain", this.sync.text.slice(at.start, at.end));
	if (cut && !this.sync.readOnly) this.apply([{ at: at.start, before: this.sync.text.slice(at.start, at.end), text: "" }], { start: at.start, end: at.start });
};

LiveEditor.prototype.paste = function (this: LiveEditor, event: ClipboardEvent): void {
	event.preventDefault();
	if (this.sync.readOnly) return;
	const at = this.selection();
	const data = event.clipboardData?.getData("text/plain");
	if (at && data) this.replace(at, data.replace(/\r\n?/g, "\n"));
};

LiveEditor.prototype.drop = function (this: LiveEditor, event: DragEvent): void {
	event.preventDefault();
	if (this.sync.readOnly) return;
	const data = event.dataTransfer?.getData("text/plain");
	const pos = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
	if (!data || !pos || !this.root.contains(pos.startContainer)) return;
	const at = this.offsetAt(pos.startContainer, pos.startOffset);
	this.replace({ start: at, end: at }, data);
};

LiveEditor.prototype.pressed = function (this: LiveEditor, event: MouseEvent): void {
	const target = event.target as HTMLElement;
	const drawn = target.closest<HTMLElement>("[data-widget]");
	if (!drawn || !this.root.contains(drawn)) return;
	event.preventDefault();
	if (drawn.dataset.widget === "task") {
		if (this.sync.readOnly) return;
		const chunk = drawn.closest<HTMLElement>(".lv-chunk")!;
		const at = Number(chunk.dataset.start) + Number(drawn.dataset.at);
		const now = this.sync.text[at];
		const caret = this.selection() ?? { start: at, end: at };
		this.apply([{ at, before: now ?? "", text: now === " " ? "x" : " " }], caret, "edit");
		return;
	}
	// A press on drawn maths, a reference, a picture or a table opens its source there. Something drawn
	// inside something drawn (a reference in a table's caption) belongs to the outer one: its own
	// offsets count from the caption, not from the file.
	let outer = drawn;
	for (let up = drawn.parentElement?.closest<HTMLElement>("[data-widget]"); up && this.root.contains(up); up = up.parentElement?.closest<HTMLElement>("[data-widget]")) outer = up;
	const chunk = outer.closest<HTMLElement>(".lv-chunk")!;
	const inline = outer.parentElement?.closest<HTMLElement>(".lv-i");
	const line = outer.closest<HTMLElement>(".lv-line");
	const start =
		Number(chunk.dataset.start) +
		(inline && chunk.contains(inline) ? Number(inline.dataset.s) + Number(inline.dataset.o ?? 0) : line && chunk.contains(line) ? Number(line.dataset.s) + Number(line.dataset.p ?? 0) : 0);
	this.root.focus({ preventScroll: true });
	this.place({ start, end: start });
	this.state();
};

LiveEditor.prototype.clicked = function (this: LiveEditor, event: MouseEvent): void {
	const link = (event.target as HTMLElement).closest<HTMLElement>("[data-href]");
	if (link && (event.metaKey || event.ctrlKey)) {
		event.preventDefault();
		window.open(link.dataset.href, "_blank", "noopener");
	}
};

// --- the styling tools -------------------------------------------------------------------

LiveEditor.prototype.delimiters = function (this: LiveEditor, style: InlineStyle): [string, string] | undefined {
	if (this.tex) {
		const map: Partial<Record<InlineStyle, [string, string]>> = { bold: ["\\textbf{", "}"], italic: ["\\emph{", "}"], underline: ["\\underline{", "}"], code: ["\\texttt{", "}"], math: ["$", "$"], strike: ["\\sout{", "}"] };
		return map[style];
	}
	const map: Record<InlineStyle, [string, string]> = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], underline: ["<u>", "</u>"], code: ["`", "`"], mark: ["==", "=="], math: ["$", "$"] };
	return map[style];
};

const CLASS: Record<InlineStyle, string> = { bold: "lv-b", italic: "lv-em", strike: "lv-s", underline: "lv-u", code: "lv-code", mark: "lv-mark", math: "lv-math" };

/** The drawn element of a style around an offset, with its place in the text. */
LiveEditor.prototype.around = function (this: LiveEditor, cls: string, at: Range2): { s: number; e: number; o: number; c: number } | undefined {
	const sel = getSelection();
	const node = sel?.anchorNode;
	const el = node ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) : null;
	const found = el?.closest<HTMLElement>(`.${cls}`);
	if (!found || !this.root.contains(found)) return undefined;
	const chunk = found.closest<HTMLElement>(".lv-chunk")!;
	const base = Number(chunk.dataset.start);
	const s = base + Number(found.dataset.s);
	const e = base + Number(found.dataset.e);
	if (at.start < s || at.end > e) return undefined;
	return { s, e, o: Number(found.dataset.o), c: Number(found.dataset.c) };
};

/** Bold, italic and the rest: taken off when the caret is in it, put round the selection or the word otherwise. */
LiveEditor.prototype.toggle = function (this: LiveEditor, style: InlineStyle): void {
	if (this.sync.readOnly) return;
	const at = this.selection();
	const delims = this.delimiters(style);
	if (!at || !delims) return;
	const text = this.sync.text;
	const inside = this.around(CLASS[style], at);
	if (inside) {
		// Closing syntax first, so the opening's offset still holds.
		const splices: Splice[] = [
			{ at: inside.e - inside.c, before: text.slice(inside.e - inside.c, inside.e), text: "" },
			{ at: inside.s, before: text.slice(inside.s, inside.s + inside.o), text: "" },
		];
		const shift = (p: number) => Math.max(inside.s, Math.min(p - inside.o, inside.e - inside.o - inside.c));
		return this.apply(splices, { start: shift(at.start), end: shift(at.end) });
	}
	let { start, end } = at;
	if (start === end) {
		// No selection: the word the caret is in, or an empty pair to type into.
		while (start > 0 && isWord(text[start - 1])) start--;
		while (end < text.length && isWord(text[end])) end++;
		if (start === end || at.start === start || at.start === end) {
			start = end = at.start;
		}
	} else {
		while (start < end && /\s/.test(text[start]!)) start++;
		while (end > start && /\s/.test(text[end - 1]!)) end--;
	}
	const [open, close] = delims;
	const splices: Splice[] = [
		{ at: end, before: "", text: close },
		{ at: start, before: "", text: open },
	];
	if (start === end) return this.apply(splices, { start: start + open.length, end: start + open.length });
	const caret = at.start === at.end ? at.start + open.length : start + open.length;
	this.apply(splices, at.start === at.end ? { start: caret, end: caret } : { start: start + open.length, end: end + open.length });
};

/** A link round the selection, with its address selected to type over; in a link, the link taken off. */
LiveEditor.prototype.link = function (this: LiveEditor): void {
	if (this.sync.readOnly) return;
	const at = this.selection();
	if (!at) return;
	const text = this.sync.text;
	const inside = this.around("lv-a", at);
	if (inside && inside.o > 0) {
		const splices: Splice[] = [
			{ at: inside.e - inside.c, before: text.slice(inside.e - inside.c, inside.e), text: "" },
			{ at: inside.s, before: text.slice(inside.s, inside.s + inside.o), text: "" },
		];
		return this.apply(splices, { start: inside.s, end: inside.e - inside.o - inside.c });
	}
	const label = text.slice(at.start, at.end);
	const url = /^https?:\/\//.test(label) ? label : "https://";
	if (this.tex) {
		const insert = `\\href{${url}}{${label || "link"}}`;
		const urlAt = at.start + 6;
		return this.apply([{ at: at.start, before: label, text: insert }], { start: urlAt, end: urlAt + url.length });
	}
	const insert = `[${label}](${url})`;
	const urlAt = at.start + label.length + 3;
	if (!label) return this.apply([{ at: at.start, before: "", text: insert }], { start: at.start + 1, end: at.start + 1 });
	this.apply([{ at: at.start, before: label, text: insert }], { start: urlAt, end: urlAt + url.length });
};

/** Turn the lines of the selection into a heading, a list, a quote or a paragraph; pressed again, back to a paragraph. */
LiveEditor.prototype.setBlock = function (this: LiveEditor, style: BlockStyle): void {
	if (this.sync.readOnly) return;
	const at = this.selection();
	if (!at) return;
	const text = this.sync.text;
	if (style === "code") return this.codeBlock(at);
	const first = this.lineAround(at.start);
	const last = this.lineAround(at.end);
	const lines: Array<{ start: number; text: string }> = [];
	for (let s = first.start; s <= last.start; ) {
		const line = this.lineAround(s);
		lines.push({ start: line.start, text: line.text });
		if (line.end >= text.length) break;
		s = line.end + 1;
	}
	const state = this.state();
	const off = state.block === style;
	const splices: Splice[] = [];
	let caretShift = 0;
	let endShift = 0;
	let number = 1;
	const plan: Array<{ start: number; before: string; text: string }> = [];
	for (const line of lines) {
		if (line.text.trim() === "" && lines.length > 1) continue;
		if (this.tex) {
			const head = /^(\s*)\\(section|subsection|subsubsection|paragraph|chapter|part)\*?\{(.*)\}\s*$/.exec(line.text);
			const words = head ? head[3]! : line.text.replace(/^\s*\\item(\[[^\]]*\])?[ \t]*/, "");
			const make = off || style === "p" ? words : style === "h1" ? `\\section{${words}}` : style === "h2" ? `\\subsection{${words}}` : style === "h3" ? `\\subsubsection{${words}}` : style === "h4" ? `\\paragraph{${words}}` : style === "ul" || style === "ol" ? `\\item ${words}` : words;
			plan.push({ start: line.start, before: line.text, text: make });
			continue;
		}
		const prefix = this.prefixOf(line.text);
		const old = prefix ? line.text.slice(0, prefix.len) : "";
		const indent = prefix && (prefix.kind === "ul" || prefix.kind === "ol" || prefix.kind === "task") ? prefix.match[1]! : "";
		let next: string;
		if (off || style === "p") next = "";
		else if (style.startsWith("h")) next = `${"#".repeat(Number(style.slice(1)))} `;
		else if (style === "quote") next = "> ";
		else if (style === "ul") next = `${indent}- `;
		else if (style === "ol") next = `${indent}${number++}. `;
		else next = `${indent}- [ ] `;
		plan.push({ start: line.start, before: old, text: next });
	}
	// A LaTeX \item outside a list does not compile: lines turned into items get a list round them.
	const wrap = this.tex && (style === "ul" || style === "ol") && !off && plan.length > 0 && !this.inTexList(plan[0]!.start);
	const env = style === "ol" ? "enumerate" : "itemize";
	const lastLine = plan.length ? this.lineAround(plan.at(-1)!.start) : undefined;
	if (wrap && lastLine) splices.push({ at: lastLine.end, before: "", text: `\n\\end{${env}}` });
	// Bottom up, so every earlier line's offset still holds.
	for (const p of [...plan].reverse()) splices.push({ at: p.start, before: p.before, text: p.text });
	const open = `\\begin{${env}}\n`;
	if (wrap) splices.push({ at: plan[0]!.start, before: "", text: open });
	for (const p of plan) {
		const delta = p.text.length - p.before.length;
		if (p.start <= at.start) caretShift += delta;
		if (p.start <= at.end) endShift += delta;
	}
	if (wrap) {
		caretShift += open.length;
		endShift += open.length;
	}
	const firstPlan = plan[0];
	const minStart = firstPlan ? firstPlan.start + (this.tex ? 0 : firstPlan.text.length) : at.start;
	this.apply(splices, { start: Math.max(minStart, at.start + caretShift), end: Math.max(minStart, at.end + endShift) });
};

/** Whether an offset of a LaTeX file sits inside an itemize, enumerate or description list. */
LiveEditor.prototype.inTexList = function (this: LiveEditor, offset: number): boolean {
	const before = this.sync.text.slice(0, offset).replace(/(^|[^\\])%.*$/gm, "$1");
	const opened = (before.match(/\\begin\{(itemize|enumerate|description)\}/g) ?? []).length;
	const closed = (before.match(/\\end\{(itemize|enumerate|description)\}/g) ?? []).length;
	return opened > closed;
};

LiveEditor.prototype.codeBlock = function (this: LiveEditor, at: Range2): void {
	const text = this.sync.text;
	if (this.tex) return;
	const chunk = this.chunks().find((c) => Number(c.dataset.start) <= at.start && at.start < Number(c.dataset.end));
	if (chunk?.dataset.kind === "code") {
		const s = Number(chunk.dataset.start);
		const lines = Builder.lines(text.slice(s, Number(chunk.dataset.end)));
		let content = lines.length;
		while (content > 0 && lines[content - 1]!.text.trim() === "") content--;
		const open = lines[0]!;
		const close = lines[content - 1]!;
		const splices: Splice[] = [];
		if (content > 1 && /^ {0,3}(```|~~~)/.test(close.text)) splices.push({ at: s + close.s, before: close.text + (close.nl ? "\n" : ""), text: "" });
		splices.push({ at: s + open.s, before: open.text + "\n", text: "" });
		const shift = open.text.length + 1;
		return this.apply(splices, { start: Math.max(s, at.start - shift), end: Math.max(s, at.end - shift) });
	}
	const first = this.lineAround(at.start);
	const last = this.lineAround(at.end);
	const before = text.slice(0, first.start);
	const lead = before === "" || before.endsWith("\n\n") ? "" : "\n";
	const after = text.slice(last.end);
	const trail = after.startsWith("\n\n") || after === "" ? "" : "\n";
	const splices: Splice[] = [
		{ at: last.end, before: "", text: `\n\`\`\`${trail}` },
		{ at: first.start, before: "", text: `${lead}\`\`\`\n` },
	];
	const shift = lead.length + 4;
	this.apply(splices, { start: at.start + shift, end: at.end + shift });
};

/** Put something of its own on a new line after the caret's block: a rule, a table, a maths block. */
LiveEditor.prototype.insertBlock = function (this: LiveEditor, kind: "hr" | "table" | "math"): void {
	if (this.sync.readOnly) return;
	const at = this.selection();
	if (!at) return;
	const text = this.sync.text;
	const line = this.lineAround(at.end);
	const piece = kind === "hr" ? "---" : kind === "math" ? (this.tex ? "\\begin{equation}\n\n\\end{equation}" : "$$\n\n$$") : "| Column | Column |\n| --- | --- |\n|  |  |";
	if (kind === "table" && this.tex) return;
	const empty = line.text.trim() === "";
	const insertAt = empty ? line.start : line.end;
	const before = empty ? text.slice(line.start, line.end) : "";
	const lead = empty ? (insertAt === 0 || text.slice(0, insertAt).endsWith("\n\n") ? "" : "\n") : "\n\n";
	const rest = text.slice(empty ? line.end : line.end);
	const trail = rest.startsWith("\n\n") ? "" : rest.startsWith("\n") ? "\n" : "\n\n";
	const insert = `${lead}${piece}${trail}`;
	let caret = insertAt + lead.length;
	if (kind === "math") caret += this.tex ? 17 : 3;
	else if (kind === "table") caret += 2;
	else caret = insertAt + insert.length;
	this.apply([{ at: insertAt, before, text: insert }], { start: caret, end: kind === "table" ? caret + 6 : caret });
};
