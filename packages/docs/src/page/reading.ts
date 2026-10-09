import type { Splice } from "../index.ts";
import type { DocSync } from "../client.ts";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
import { blocks, docxBlocks, paragraphSplices, readParagraph, type Block, type Paragraph } from "./blocks.ts";
import type { Mark } from "./marks.ts";
import { spliceBetween } from "./marks.ts";
import { texToHtml } from "./render.ts";

/**
 * The page as it reads: the document drawn block by block, and a block turned back into its own
 * text when it is clicked, typed into, and drawn again when it is left.
 *
 * A Word document is drawn whole by docx-preview, a third-party renderer that reads the file as
 * Word lays it out (its styles, tables, pictures and colours), and each paragraph it draws is
 * matched to the paragraph of the XML it came from, in order.
 *
 * Markdown and LaTeX blocks are edited as their source, which is the only text that says exactly
 * what the file holds; a Word paragraph is edited as the words Word shows, and each keystroke is
 * turned into splices of its XML (`paragraphSplices`), so the runs and their bold and italics stay
 * where they were. Either way an edit is splices of the file at the block's own offset, and goes
 * out like any other.
 */

export interface ReadingHost {
	/** Draw markdown into an element, as the host draws markdown everywhere else. */
	markdown?(into: HTMLElement, source: string): Promise<void> | void;
	/** Set the maths in an element (KaTeX's auto-render, in Decks). */
	math?(into: HTMLElement): Promise<void> | void;
	marks(): readonly Mark[];
	/** The bytes of a file the server has, by the path the page calls it: a `.docx` needs its whole zip to be drawn. */
	file?(path: string): Promise<ArrayBuffer>;
}

interface Editing {
	start: number;
	end: number;
	el: HTMLElement;
	text: string;
	para?: Paragraph;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Reading {
	readonly root: HTMLElement;
	private editing: Editing | undefined;
	private composing = false;
	/** Drawn blocks by their source, so a redraw after someone else's keystroke reuses the rest. */
	private readonly drawn = new Map<string, string>();
	/** A Word document's zip as the server last had it, for drawing; its `document.xml` is replaced by the text. */
	private zip: Promise<JSZip | undefined> | undefined;
	private wordTimer: ReturnType<typeof setTimeout> | undefined;
	private wordRun = 0;

	constructor(
		private readonly sync: DocSync,
		private readonly host: ReadingHost,
	) {
		this.root = document.createElement("div");
		this.root.className = "dp-page";
		this.root.addEventListener("mousedown", (event) => this.pressed(event));
		this.root.addEventListener("compositionstart", () => (this.composing = true));
		this.root.addEventListener("compositionend", () => {
			this.composing = false;
			this.typed();
		});
		this.root.addEventListener("input", () => {
			if (!this.composing) this.typed();
		});
		this.root.addEventListener("focusout", (event) => {
			if (this.editing && event.target === this.editing.el) this.leave();
		});
		this.root.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && this.editing) this.editing.el.blur();
		});
	}

	private get tex(): boolean {
		return /\.(tex|sty|cls|ltx)$/i.test(this.sync.path);
	}

	/** Draw every block, keeping the one being typed into as it is. */
	render(): void {
		if (this.sync.format === "docx") return this.renderWord();
		const all = blocks(this.sync.text, this.sync.format, this.tex);
		const children: Node[] = [];
		const editing = this.editing;
		let placed = false;
		const marks = this.host.marks().filter((m): m is Extract<Mark, { kind: "ins" }> => m.kind === "ins");
		for (const block of all) {
			if (editing && block.end > editing.start && block.start < editing.end) {
				if (!placed) children.push(editing.el);
				placed = true;
				continue;
			}
			if (editing && !placed && block.start >= editing.end) {
				children.push(editing.el);
				placed = true;
			}
			if (block.kind === "hidden") continue;
			children.push(this.blockEl(block, marks.some((m) => m.end > block.start && m.start < block.end)));
		}
		if (editing && !placed) children.push(editing.el);
		if (children.length === 0) {
			const empty = document.createElement("div");
			empty.className = "dp-block dp-empty-doc";
			empty.dataset.start = "0";
			empty.dataset.end = "0";
			empty.textContent = this.sync.readOnly ? "This document is empty." : "Empty. Click to write.";
			children.push(empty);
		}
		// The block being typed into is never taken out of the page, which would drop its focus.
		if (editing && editing.el.parentNode === this.root) {
			for (const child of [...this.root.childNodes]) if (child !== editing.el) child.remove();
			const at = children.indexOf(editing.el);
			for (const node of children.slice(0, at)) this.root.insertBefore(node, editing.el);
			for (const node of children.slice(at + 1)) this.root.append(node);
		} else this.root.replaceChildren(...children);
	}

	/** Someone else's splices landed: move the block being typed into, and redraw the rest. */
	update(applied: readonly Splice[] | undefined): void {
		const editing = this.editing;
		if (editing && applied) {
			for (const s of applied) {
				const delta = s.text.length - s.before.length;
				// Wholly before the block, an insertion at its very start included: the block moves.
				if (s.at + s.before.length <= editing.start) {
					editing.start += delta;
					editing.end += delta;
				} else if (s.at < editing.end) editing.end = Math.max(editing.start, editing.end + delta);
			}
			const source = this.sync.text.slice(editing.start, editing.end);
			const para = this.sync.format === "docx" ? readParagraph(source) : undefined;
			const now = para ? para.text : source;
			if (now !== editing.text) {
				const at = this.caretIn(editing.el);
				editing.text = now;
				editing.para = para;
				editing.el.textContent = now;
				this.placeIn(editing.el, Math.min(at ?? now.length, now.length));
			}
		} else if (editing && !applied) {
			// The text was replaced whole: nothing to keep the edit against.
			this.editing = undefined;
		}
		// The zip's other parts may have changed with a write from outside: read it again before drawing.
		if (!applied || this.sync.changes.length) this.zip = undefined;
		this.render();
	}

	private blockEl(block: Block, changed: boolean): HTMLElement {
		const source = this.sync.text.slice(block.start, block.end);
		const el = document.createElement("div");
		el.className = `dp-block${changed ? " dp-changed" : ""}${block.kind === "preamble" ? " dp-preamble" : ""}`;
		el.dataset.start = String(block.start);
		el.dataset.end = String(block.end);
		if (block.kind === "preamble") {
			const lines = source.split("\n").length - 1;
			el.textContent = `Preamble · ${lines} lines`;
			return el;
		}
		const key = `${this.sync.format}:${this.tex ? "tex" : ""}:${source}`;
		const known = this.drawn.get(key);
		if (known !== undefined) {
			el.innerHTML = known;
			return el;
		}
		if (this.tex) {
			el.innerHTML = texToHtml(source);
			void Promise.resolve(this.host.math?.(el)).then(() => this.drawn.set(key, el.innerHTML));
		} else if (this.host.markdown) {
			el.innerHTML = `<p>${escapeHtml(source)}</p>`;
			void Promise.resolve(this.host.markdown(el, source)).then(() => this.drawn.set(key, el.innerHTML));
		} else {
			el.innerHTML = `<p style="white-space: pre-wrap">${escapeHtml(source)}</p>`;
		}
		return el;
	}

	// --- Word ------------------------------------------------------------------------------

	/**
	 * Draw the Word document whole, soon: a burst of keystrokes from another page is one drawing.
	 * Not while a paragraph is being typed into, since drawing replaces every element in the page;
	 * leaving the paragraph draws it.
	 */
	private renderWord(): void {
		clearTimeout(this.wordTimer);
		if (this.editing) return;
		this.wordTimer = setTimeout(() => void this.drawWord(), 120);
	}

	private async drawWord(): Promise<void> {
		const run = ++this.wordRun;
		if (!this.host.file) {
			this.root.textContent = "This page cannot read the Word file to draw it: open Source.";
			return;
		}
		this.zip ??= this.host
			.file(this.sync.path)
			.then((bytes) => JSZip.loadAsync(bytes))
			.catch(() => undefined);
		const zip = await this.zip;
		if (run !== this.wordRun || this.editing) return;
		if (!zip) {
			this.root.textContent = "The Word file could not be read to draw it: open Source.";
			return;
		}
		zip.file("word/document.xml", this.sync.text);
		const blob = await zip.generateAsync({ type: "blob" });
		const into = document.createElement("div");
		into.className = "dp-word";
		try {
			await renderAsync(blob, into, undefined, {
				inWrapper: false,
				breakPages: false,
				ignoreWidth: true,
				ignoreHeight: true,
				ignoreLastRenderedPageBreak: true,
				renderHeaders: false,
				renderFooters: false,
				renderFootnotes: false,
				renderEndnotes: false,
				className: "docx",
			});
		} catch (error) {
			if (run === this.wordRun) this.root.textContent = `Word could not be drawn: ${(error as Error).message}. Open Source.`;
			return;
		}
		if (run !== this.wordRun || this.editing) return;
		// Each drawn paragraph is the XML paragraph at the same place in the body; when the counts
		// differ (paragraphs inside text boxes, say) the page is read-only and Source edits it.
		const drawn = [...into.querySelectorAll<HTMLElement>("section p")];
		const paragraphs = docxBlocks(this.sync.text).filter((b) => b.kind === "text");
		const matched = drawn.length === paragraphs.length;
		const marks = this.host.marks().filter((m): m is Extract<Mark, { kind: "ins" }> => m.kind === "ins");
		if (matched) {
			drawn.forEach((p, i) => {
				const block = paragraphs[i]!;
				p.classList.add("dp-block", "dp-para");
				p.dataset.start = String(block.start);
				p.dataset.end = String(block.end);
				if (marks.some((m) => m.end > block.start && m.start < block.end)) p.classList.add("dp-changed");
			});
		}
		into.toggleAttribute("data-unmatched", !matched);
		this.root.replaceChildren(into);
		if (!matched) {
			const note = document.createElement("p");
			note.className = "dp-chip";
			note.textContent = "This document's paragraphs could not all be matched to the file, so it is edited in Source.";
			this.root.prepend(note);
		}
	}

	// --- editing one block ------------------------------------------------------------------

	private pressed(event: MouseEvent): void {
		if (this.sync.readOnly || !this.sync.ready || event.button !== 0) return;
		const target = (event.target as HTMLElement).closest<HTMLElement>(".dp-block");
		if (!target || target === this.editing?.el || !this.root.contains(target)) return;
		const start = Number(target.dataset.start);
		const end = Number(target.dataset.end);
		// Where in the drawn words the press was, to put the caret near it in the text.
		const shown = target.textContent ?? "";
		const near = this.shownOffset(target, event.clientX, event.clientY);
		event.preventDefault();
		const source = this.sync.text.slice(start, end);
		const para = this.sync.format === "docx" ? readParagraph(source) : undefined;
		const text = para ? para.text : source;
		const el = document.createElement("div");
		el.className = "dp-block dp-editing";
		el.setAttribute("contenteditable", "plaintext-only");
		el.spellcheck = false;
		el.textContent = text;
		el.dataset.start = String(start);
		this.editing = { start, end, el, text, ...(para ? { para } : {}) };
		target.replaceWith(el);
		// The block left behind, if any, reads again; the new one stays where it was put. A Word page
		// is drawn whole, so it is only drawn again when the paragraph is left.
		if (this.sync.format !== "docx") this.render();
		el.focus();
		this.placeIn(el, this.caretFor(text, shown, near));
	}

	private typed(): void {
		const editing = this.editing;
		if (!editing) return;
		const now = editing.el.textContent ?? "";
		const local = spliceBetween(editing.text, now, this.caretIn(editing.el) ?? now.length);
		if (!local) return;
		if (!editing.para) {
			editing.text = now;
			editing.end += local.text.length - local.before.length;
			this.sync.edit({ at: editing.start + local.at, before: local.before, text: local.text });
			return;
		}
		const xml = this.sync.text.slice(editing.start, editing.end);
		for (const splice of paragraphSplices(xml, editing.para, local)) {
			editing.end += splice.text.length - splice.before.length;
			this.sync.edit({ at: editing.start + splice.at, before: splice.before, text: splice.text });
		}
		editing.para = readParagraph(this.sync.text.slice(editing.start, editing.end));
		editing.text = editing.para.text;
		if (editing.text !== now) {
			// What Word will show differs from what was typed (a character it cannot hold): show Word's.
			const at = this.caretIn(editing.el);
			editing.el.textContent = editing.text;
			this.placeIn(editing.el, Math.min(at ?? editing.text.length, editing.text.length));
		}
	}

	private leave(draw = true): void {
		this.editing = undefined;
		if (draw) this.render();
	}

	/** Stop any drawing still to come. */
	destroy(): void {
		clearTimeout(this.wordTimer);
		this.wordRun++;
	}

	// --- carets -------------------------------------------------------------------------------

	private shownOffset(el: HTMLElement, x: number, y: number): number {
		const doc = el.ownerDocument as Document & { caretRangeFromPoint?(x: number, y: number): Range | null; caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
		let node: Node | undefined;
		let offset = 0;
		const pos = doc.caretPositionFromPoint?.(x, y);
		if (pos) {
			node = pos.offsetNode;
			offset = pos.offset;
		} else {
			const range = doc.caretRangeFromPoint?.(x, y);
			if (range) {
				node = range.startContainer;
				offset = range.startOffset;
			}
		}
		if (!node || !el.contains(node)) return (el.textContent ?? "").length;
		const range = doc.createRange();
		range.setStart(el, 0);
		range.setEnd(node, offset);
		return range.toString().length;
	}

	/** The caret in the block's text for a press at `near` in its drawn words. */
	private caretFor(text: string, shown: string, near: number): number {
		if (this.sync.format === "docx") return Math.min(near, text.length);
		// The words just before the press, found in the source; else the same share of the way in.
		for (const width of [16, 8, 4]) {
			const cue = shown.slice(Math.max(0, near - width), near);
			if (cue.trim().length < 2) continue;
			const at = text.indexOf(cue);
			if (at !== -1 && text.indexOf(cue, at + 1) === -1) return at + cue.length;
		}
		return Math.round((near / Math.max(1, shown.length)) * text.length);
	}

	private caretIn(el: HTMLElement): number | undefined {
		const selection = el.ownerDocument.getSelection();
		if (!selection || selection.rangeCount === 0 || !el.contains(selection.focusNode)) return undefined;
		const range = el.ownerDocument.createRange();
		range.setStart(el, 0);
		range.setEnd(selection.focusNode!, selection.focusOffset);
		return range.toString().length;
	}

	private placeIn(el: HTMLElement, offset: number): void {
		const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let left = offset;
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			if (left <= node.data.length) {
				el.ownerDocument.getSelection()?.collapse(node, left);
				return;
			}
			left -= node.data.length;
		}
		el.ownerDocument.getSelection()?.collapse(el, el.childNodes.length);
	}
}
