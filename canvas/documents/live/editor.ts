import { transformSplices, type DocChange, type Splice } from "../model.ts";
import type { DocSync } from "../client.ts";
import { invert } from "../merge.ts";
import { blocks } from "../blocks.ts";
import { spliceBetween, type Mark } from "../marks.ts";
import { texMeta } from "../tex.ts";
import type { FormatState, LiveHost, Range2, UndoEntry } from "../live.ts";
import { Builder, h } from "./builder.ts";

/** The LiveEditor: its state, how it draws the file, where the caret is, and its history. What keys and the toolbar do is in input.ts. */

/** Text nodes of an element that are the file's: not those of drawn maths or pictures. */
function textNodes(root: Node): Text[] {
	const out: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
		acceptNode: (node) => (node.nodeType === Node.ELEMENT_NODE ? ((node as HTMLElement).dataset.widget ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
	});
	for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
	return out;
}

const shown = (node: Text) => (node.parentElement?.getClientRects().length ?? 0) > 0;

export class LiveEditor {
	readonly root: HTMLElement;
	tex = false;
	/** The text the page was last drawn from. */
	drawnText = "";
	/** The key each drawn block was drawn for, to keep the ones that did not change. */
	readonly keys = new Map<HTMLElement, string>();
	end: HTMLElement;
	composing = false;
	/** Others' splices that arrived while an input method was composing, to move its result past. */
	deferred: Splice[] = [];
	opened: HTMLElement[] = [];
	undoStack: UndoEntry[] = [];
	redoStack: UndoEntry[] = [];
	/** Inside `apply`: the editor draws once at the end, not once per splice. */
	applying = false;
	readonly mathCache = new Map<string, string>();
	readonly onSelection = () => this.selectionMoved();

	constructor(
		readonly sync: DocSync,
		readonly host: LiveHost,
	) {
		this.root = h("div", "lv");
		this.root.contentEditable = "true";
		this.root.spellcheck = true;
		this.root.setAttribute("role", "textbox");
		this.root.setAttribute("aria-multiline", "true");
		this.end = h("div", "lv-line lv-end");
		this.end.append(h("br"));
		this.root.addEventListener("beforeinput", (event) => this.beforeInput(event));
		this.root.addEventListener("input", (event) => {
			// Anything the browser did on its own (an autocorrect, a spelling fix it applied itself).
			if (!this.composing && !(event as InputEvent).isComposing) this.readBack();
		});
		this.root.addEventListener("compositionstart", () => (this.composing = true));
		this.root.addEventListener("compositionend", () => {
			this.composing = false;
			this.readBack();
		});
		this.root.addEventListener("keydown", (event) => this.keydown(event));
		this.root.addEventListener("copy", (event) => this.copy(event, false));
		this.root.addEventListener("cut", (event) => this.copy(event, true));
		this.root.addEventListener("paste", (event) => this.paste(event));
		this.root.addEventListener("drop", (event) => this.drop(event));
		this.root.addEventListener("mousedown", (event) => this.pressed(event));
		this.root.addEventListener("click", (event) => this.clicked(event));
		document.addEventListener("selectionchange", this.onSelection);
	}

	destroy(): void {
		document.removeEventListener("selectionchange", this.onSelection);
	}

	// --- drawing ---------------------------------------------------------------------------

	/** The whole text was replaced (opened, or opened again). */
	reset(): void {
		this.tex = /\.(tex|sty|cls|ltx)$/i.test(this.sync.path);
		this.root.contentEditable = this.sync.readOnly ? "false" : "true";
		this.undoStack = [];
		this.redoStack = [];
		this.deferred = [];
		this.render();
		this.state();
	}

	/** Others' splices landed: draw them, and keep the caret on the same words. */
	remote(applied: readonly Splice[]): void {
		this.moveHistory(applied);
		if (this.composing) {
			this.deferred.push(...applied);
			return;
		}
		const at = this.selection();
		this.render();
		if (at && document.activeElement === this.root) this.place(shiftRange(at, applied));
	}

	/** The highlights changed without the text changing. */
	redraw(): void {
		if (this.composing) return;
		const at = this.selection();
		this.render();
		if (at && document.activeElement === this.root) this.place(at);
	}

	/** Draw the text, keeping every block whose source and highlights did not change. */
	render(): void {
		const text = this.sync.text;
		this.drawnText = text;
		const marks = this.host.marks();
		const changes = this.host.changes();
		const pool = new Map<string, HTMLElement[]>();
		for (const [el, key] of this.keys) {
			const list = pool.get(key) ?? [];
			list.push(el);
			pool.set(key, list);
		}
		this.keys.clear();
		const kids: HTMLElement[] = [];
		const all = text.length ? blocks(text, "text", this.tex) : [];
		// What the whole LaTeX file numbers and titles, which a block that refers to it is drawn with.
		const meta = this.tex ? texMeta(text) : undefined;
		for (const block of all) {
			const source = text.slice(block.start, block.end);
			const sig = marks
				.filter((m) => (m.kind === "ins" ? m.end > block.start && m.start < block.end : m.at >= block.start && m.at <= block.end))
				.map((m) => (m.kind === "ins" ? `${m.start - block.start}:${m.end - block.start}` : `d${m.at - block.start}`))
				.join(",");
			const refers = meta && /\\(ref|eqref|autoref|cref|Cref|cite[a-z]*|maketitle)\b|\\begin\{(equation|figure|table|abstract|proof|[a-z]*(theorem|lemma|proposition|corollary|definition|remark|example|conjecture|assumption|claim|hypothesis))/.test(source);
			const usesMacros = !!meta?.macros && /\$|\\\(|\\\[|\\begin\{(equation|align|gather|multline)/.test(source);
			const key = `${block.kind}|${block.start === 0 ? 1 : 0}|${sig}|${refers ? meta.sig : usesMacros ? meta.macros : ""}|${source}`;
			let el = pool.get(key)?.pop();
			if (!el) {
				const builder = new Builder(this.tex, meta, block.start);
				el = builder.block(source, block.kind, block.start === 0);
				this.highlight(el, block.start, marks, changes);
				this.drawWidgets(builder);
			}
			el.dataset.start = String(block.start);
			el.dataset.end = String(block.end);
			this.keys.set(el, key);
			kids.push(el);
		}
		// A last, empty line to type on after a closing newline, and in an empty document.
		if (text.length === 0 || text.endsWith("\n")) kids.push(this.end);
		this.end.classList.toggle("lv-placeholder", text.length === 0);
		this.end.dataset.placeholder = this.sync.readOnly ? "This document is empty." : "Start writing…";
		let i = 0;
		for (; i < kids.length; i++) {
			const want = kids[i]!;
			if (this.root.childNodes[i] !== want) this.root.insertBefore(want, this.root.childNodes[i] ?? null);
		}
		while (this.root.childNodes.length > kids.length) this.root.lastChild!.remove();
		this.opened = [];
	}

	drawWidgets(builder: Builder): void {
		for (const item of builder.widgets) {
			if (item.kind === "math") {
				const known = this.mathCache.get(item.source);
				if (known !== undefined) {
					item.el.innerHTML = known;
					continue;
				}
				item.el.textContent = item.source;
				void Promise.resolve(this.host.math?.(item.el)).then(() => {
					// A formula KaTeX cannot read is shown as written, quietly, with the reason on hover:
					// LaTeX may still compile it (a package KaTeX lacks), so it is not marked as wrong.
					// KaTeX flags a formula it cannot parse as .katex-error, and draws a command it does not know in its error colour.
					const failed = item.el.querySelector<HTMLElement>(".katex-error") ?? [...item.el.querySelectorAll<HTMLElement>(".katex-html [style]")].find((e) => /cc0000|204,\s*0,\s*0/i.test(e.style.color));
					if (failed || item.el.textContent === item.source) {
						if (!failed && !/\$|\\[([]/.test(item.source)) return;
						const unknown = failed && !failed.classList.contains("katex-error") ? `${failed.textContent} is not a command KaTeX knows` : "";
						const reason = unknown || (failed?.title ?? "").replace(/^KaTeX parse error:\s*/, "").replace(/ at position \d+:[\s\S]*$/, "");
						const plain = h("span", "lv-matherr", (item.shows ?? item.source).trim());
						plain.title = reason ? `Not drawn: ${reason}` : "Not drawn";
						item.el.replaceChildren(plain);
					}
					this.mathCache.set(item.source, item.el.innerHTML);
				});
			} else {
				const img = item.el as HTMLImageElement;
				// A LaTeX picture named without its extension is looked for as each likely one in turn.
				const tries = item.source.split("|");
				const next = (): void => {
					const src = tries.shift();
					if (!src) {
						img.closest(".lv-figimg")?.classList.add("lv-missing");
						return;
					}
					if (/\.pdf$/i.test(src)) {
						// A PDF figure cannot be an <img> itself: its first page is drawn as one, or it is named instead.
						if (!this.host.pdfPicture) return next();
						void this.host.pdfPicture(src).then((url) => (url ? (img.src = url) : next()));
						return;
					}
					if (/^(https?:|data:|blob:)/.test(src)) img.src = src;
					else void this.host.asset?.(src).then((url) => (url ? (img.src = url) : next()));
				};
				img.onerror = () => next();
				next();
			}
		}
	}

	/** Others' words in a drawn block: each run its own highlight, and a line when only words were taken out. */
	highlight(el: HTMLElement, start: number, marks: readonly Mark[], changes: readonly DocChange[]): void {
		const nodes = textNodes(el);
		const offsets: number[] = [];
		let total = 0;
		for (const node of nodes) {
			offsets.push(total);
			total += node.data.length;
		}
		const title = (id: string) => {
			const change = changes.find((c) => c.id === id);
			if (!change) return "Edited";
			const who = change.by === "outside" ? "another program" : change.by;
			return `Edited by ${who} at ${new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
		};
		const local = marks.filter((m) => (m.kind === "ins" ? m.end > start && m.start < start + total : m.at >= start && m.at <= start + total));
		if (local.length === 0) return;
		const lineOf = (offset: number) => [...el.querySelectorAll<HTMLElement>(".lv-line")].find((line) => Number(line.dataset.s) <= offset && offset <= Number(line.dataset.e));
		/** Lines where a change's new words are already highlighted, which need no bar for its cuts. */
		const spanned = new Map<string, Set<HTMLElement>>();
		// New words first, so a cut on a line that also gained words shows as those words alone.
		const ordered = [...local.filter((m) => m.kind === "ins"), ...local.filter((m) => m.kind === "del")];
		for (const mark of ordered) {
			if (mark.kind === "del") {
				const line = lineOf(mark.at - start);
				if (line && !spanned.get(mark.change)?.has(line)) {
					line.classList.add("lv-hl-line");
					line.dataset.change = mark.change;
				}
				continue;
			}
			const s = Math.max(0, mark.start - start);
			const e = Math.min(total, mark.end - start);
			if (e <= s) continue;
			// Read again for each run: the one before split some of them.
			const nodes = textNodes(el);
			const offsets: number[] = [];
			let sum = 0;
			for (const node of nodes) {
				offsets.push(sum);
				sum += node.data.length;
			}
			let visible = false;
			for (let k = nodes.length - 1; k >= 0; k--) {
				const node = nodes[k]!;
				const ns = offsets[k]!;
				const ne = ns + node.data.length;
				if (ne <= s || ns >= e) continue;
				let target = node;
				if (e < ne) target.splitText(e - ns);
				if (s > ns) target = target.splitText(s - ns);
				if (target.data.trim() === "") continue;
				const wrap = h("span", "lv-hl");
				wrap.dataset.change = mark.change;
				target.replaceWith(wrap);
				wrap.append(target);
				if (!wrap.closest(".lv-mk, .lv-src")) {
					visible = true;
					const line = wrap.closest<HTMLElement>(".lv-line");
					if (line) {
						const set = spanned.get(mark.change) ?? new Set<HTMLElement>();
						set.add(line);
						spanned.set(mark.change, set);
					}
				}
			}
			if (!visible) {
				const line = lineOf(s);
				line?.classList.add("lv-hl-line");
				if (line) line.dataset.change = mark.change;
			}
		}
	}

	// --- where the caret is ------------------------------------------------------------------

	chunks(): HTMLElement[] {
		return [...this.root.children].filter((c) => c !== this.end) as HTMLElement[];
	}

	/** A DOM position as an offset into the text the page was drawn from. */
	offsetAt(node: Node, offset: number): number {
		if (node === this.root) {
			const child = this.root.childNodes[offset] as HTMLElement | undefined;
			if (!child || child === this.end) return this.drawnText.length;
			return Number(child.dataset.start ?? 0);
		}
		if (this.end.contains(node)) return this.drawnText.length;
		const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
		// Inside something drawn: the start of what it draws.
		const drawn = element?.closest<HTMLElement>("[data-widget]");
		if (drawn) {
			const owner = drawn.closest<HTMLElement>(".lv-i, .lv-line, .lv-chunk")!;
			const chunk = drawn.closest<HTMLElement>(".lv-chunk")!;
			const s = owner.classList.contains("lv-chunk") ? 0 : Number(owner.dataset.s ?? 0);
			return Number(chunk.dataset.start) + s;
		}
		const chunk = element?.closest<HTMLElement>(".lv-chunk");
		if (!chunk) return 0;
		const base = Number(chunk.dataset.start);
		let total = 0;
		const ref = node.nodeType === Node.TEXT_NODE ? undefined : (node.childNodes[offset] ?? null);
		for (const t of textNodes(chunk)) {
			if (t === node) return base + total + offset;
			if (node.nodeType !== Node.TEXT_NODE) {
				const before = ref ? !!(t.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING) && !ref.contains(t) : node.contains(t) || !!(t.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
				if (!before) return base + total;
			}
			total += t.data.length;
		}
		return base + total;
	}

	/** The selection as offsets into the text, `start` before `end`, and which end the caret is at. */
	selection(): (Range2 & { backward: boolean }) | undefined {
		const sel = getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !this.root.contains(sel.anchorNode)) return undefined;
		const a = this.offsetAt(sel.anchorNode, sel.anchorOffset);
		const f = this.offsetAt(sel.focusNode!, sel.focusOffset);
		return { start: Math.min(a, f), end: Math.max(a, f), backward: f < a };
	}

	/** The DOM position for an offset, on a character the person can see when there is a choice. */
	pointAt(offset: number): [Node, number] {
		const chunks = this.chunks();
		if (offset >= this.drawnText.length && this.end.isConnected) return [this.end, 0];
		let chunk = chunks[0];
		for (const c of chunks) {
			if (Number(c.dataset.start) <= offset) chunk = c;
			else break;
		}
		if (!chunk) return [this.root, 0];
		const local = offset - Number(chunk.dataset.start);
		const nodes = textNodes(chunk);
		let total = 0;
		let found: [Text, number] | undefined;
		for (const t of nodes) {
			const len = t.data.length;
			if (local >= total && local <= total + len) {
				// At a boundary the node that can be seen wins, and of two, the later one past a newline.
				const candidate: [Text, number] = [t, local - total];
				const atNewline = local - total === len && t.data.endsWith("\n");
				if (!found) found = candidate;
				if (shown(t) && !atNewline) {
					if (!found || !shown(found[0]) || found[1] === found[0].data.length) found = candidate;
					if (local - total < len) break;
				}
			}
			total += len;
			if (total > local + 1) break;
		}
		if (!found) {
			const last = nodes.at(-1);
			return last ? [last, last.data.length] : [chunk, 0];
		}
		// Just before a newline is the end of that line; the browser draws a caret after it on the next.
		if (found[1] === found[0].data.length && found[0].data.endsWith("\n")) return [found[0], found[1] - 1];
		return found;
	}

	place(at: Range2 & { backward?: boolean }): void {
		const [sn, so] = this.pointAt(at.start);
		const [en, eo] = at.end === at.start ? [sn, so] : this.pointAt(at.end);
		const sel = getSelection();
		if (!sel) return;
		// A spot in syntax that is hidden until the caret arrives (a new equation's empty line, say)
		// cannot be told apart from the end of the line before it: once shown, it can, so place it again.
		const hidden = (n: Node) => n.nodeType === Node.TEXT_NODE && !shown(n as Text);
		const again = hidden(sn) || hidden(en);
		if (at.backward) sel.setBaseAndExtent(en, eo, sn, so);
		else sel.setBaseAndExtent(sn, so, en, eo);
		this.reveal();
		if (again) {
			const [a, ao] = this.pointAt(at.start);
			const [f, fo] = at.end === at.start ? [a, ao] : this.pointAt(at.end);
			if (at.backward) sel.setBaseAndExtent(f, fo, a, ao);
			else sel.setBaseAndExtent(a, ao, f, fo);
		}
	}

	/** Show the syntax of what the caret is in: its line's, its inline element's, its block's. */
	reveal(): void {
		for (const el of this.opened) el.classList.remove("open");
		this.opened = [];
		const sel = getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !this.root.contains(sel.anchorNode)) return;
		const open = (node: Node | null) => {
			for (let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null); el && el !== this.root; el = el.parentElement) {
				if (el.classList.contains("lv-i") || el.classList.contains("lv-line") || el.classList.contains("lv-chunk")) {
					if (!el.classList.contains("open")) {
						el.classList.add("open");
						this.opened.push(el);
					}
				}
			}
		};
		open(sel.anchorNode);
		open(sel.focusNode);
		// Lines between the two ends of a selection open too, so what is selected is what is shown.
		if (!sel.isCollapsed) {
			const range = sel.getRangeAt(0);
			for (const line of this.root.querySelectorAll<HTMLElement>(".lv-line")) {
				if (range.intersectsNode(line) && !line.classList.contains("open")) {
					line.classList.add("open");
					this.opened.push(line);
				}
			}
		}
	}

	selectionMoved(): void {
		const sel = getSelection();
		if (!sel?.anchorNode || !this.root.contains(sel.anchorNode)) return;
		this.reveal();
		this.state();
	}

	/** What the toolbar shows as pressed, for where the caret is. */
	state(): FormatState {
		const sel = getSelection();
		const node = sel?.anchorNode && this.root.contains(sel.anchorNode) ? sel.anchorNode : null;
		const el = node ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) : null;
		const has = (cls: string) => !!el?.closest(`.${cls}`);
		const line = el?.closest<HTMLElement>(".lv-line");
		const chunk = el?.closest<HTMLElement>(".lv-chunk");
		const state: FormatState = {
			bold: has("lv-b"),
			italic: has("lv-em"),
			strike: has("lv-s"),
			underline: has("lv-u"),
			code: has("lv-code"),
			mark: has("lv-mark"),
			link: has("lv-a"),
			math: has("lv-math"),
			block: chunk?.dataset.kind === "code" ? "code" : (line?.dataset.block ?? "p"),
		};
		this.host.onState?.(state);
		return state;
	}

	// --- editing -----------------------------------------------------------------------------

	/**
	 * Apply splices made on the current text, one after another, and put the caret where it goes.
	 * Every edit the page makes comes through here, so each is one undo step.
	 */
	apply(splices: Splice[], caret: Range2, kind = "edit", record = true): void {
		const before = this.selection() ?? caret;
		const clean = splices.filter((s) => s.before || s.text);
		if (clean.length === 0) {
			this.place(caret);
			return;
		}
		this.applying = true;
		const start = this.sync.text;
		try {
			for (const splice of clean) this.sync.edit(splice);
		} finally {
			this.applying = false;
		}
		if (this.sync.text === start) return;
		if (record) {
			const now = Date.now();
			const top = this.undoStack.at(-1);
			// Letters typed one after another are one step until a pause or a move.
			const merge = top && kind === "type" && top.kind === "type" && now - top.at < 1000 && top.after.start === before.start && top.after.end === before.end;
			if (merge) {
				top.undo = [...invert(clean), ...top.undo];
				top.after = caret;
				top.at = now;
			} else this.undoStack.push({ undo: invert(clean), caret: { start: before.start, end: before.end }, after: caret, at: now, kind });
			if (this.undoStack.length > 500) this.undoStack.shift();
			this.redoStack = [];
		}
		this.render();
		this.root.focus({ preventScroll: true });
		this.place(caret);
		this.state();
		this.scrollToCaret();
	}

	/** Called by the page after each of this page's own splices; drawing waits for `apply` to finish. */
	local(): void {
		if (!this.applying && !this.composing) this.render();
	}

	/** Put the caret at an offset of the text and bring it into view: a LaTeX error's line, say. */
	goto(offset: number): void {
		this.root.focus({ preventScroll: true });
		this.place({ start: offset, end: offset });
		this.state();
		const sel = getSelection();
		const node = sel?.anchorNode;
		const el = node ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) : null;
		el?.closest(".lv-line, .lv-chunk")?.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	scrollToCaret(): void {
		const sel = getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const rect = sel.getRangeAt(0).getBoundingClientRect();
		const scroller = this.root.closest(".dp-scroll");
		if (!scroller || (rect.top === 0 && rect.bottom === 0)) return;
		const box = scroller.getBoundingClientRect();
		if (rect.bottom > box.bottom - 24) scroller.scrollTop += rect.bottom - box.bottom + 48;
		else if (rect.top < box.top + 8) scroller.scrollTop -= box.top - rect.top + 48;
	}

	/** Replace the selection with `text`, the caret after it. */
	replace(at: Range2, text: string, kind = "edit"): void {
		const before = this.sync.text.slice(at.start, at.end);
		const end = at.start + text.length;
		this.apply([{ at: at.start, before, text }], { start: end, end }, kind);
	}

	undo(): void {
		const entry = this.undoStack.pop();
		if (!entry) return;
		if (!this.applicable(entry.undo)) {
			this.undoStack = [];
			return;
		}
		const redo = invert(entry.undo);
		this.apply(entry.undo, entry.caret, "undo", false);
		this.redoStack.push({ undo: redo, caret: entry.after, after: entry.caret, at: Date.now(), kind: "redo" });
	}

	redo(): void {
		const entry = this.redoStack.pop();
		if (!entry) return;
		if (!this.applicable(entry.undo)) {
			this.redoStack = [];
			return;
		}
		const back = invert(entry.undo);
		this.apply(entry.undo, entry.caret, "redo", false);
		this.undoStack.push({ undo: back, caret: entry.after, after: entry.caret, at: Date.now(), kind: "edit" });
	}

	applicable(splices: readonly Splice[]): boolean {
		let text = this.sync.text;
		for (const s of splices) {
			if (text.slice(s.at, s.at + s.before.length) !== s.before) return false;
			text = text.slice(0, s.at) + s.text + text.slice(s.at + s.before.length);
		}
		return true;
	}

	/** Others wrote: every undo step is moved past their words, so undo takes back only this page's own. */
	moveHistory(applied: readonly Splice[]): void {
		for (const stack of [this.undoStack, this.redoStack]) {
			let theirs: Splice[] = [...applied];
			for (let k = stack.length - 1; k >= 0 && theirs.length; k--) {
				const entry = stack[k]!;
				const moved = transformSplices(entry.undo, theirs, true);
				entry.undo = moved.a;
				entry.caret = shiftRange(entry.caret, theirs);
				entry.after = shiftRange(entry.after, theirs);
				theirs = moved.b;
			}
		}
	}

	/** What the browser did to the page by itself, read back as a splice of the text it was drawn from. */
	readBack(): void {
		const now = this.chunks()
			.map((c) => textNodes(c).map((t) => t.data).join(""))
			.join("");
		const caret = this.selection();
		const local = spliceBetween(this.drawnText, now, caret?.end ?? now.length);
		const deferred = this.deferred;
		this.deferred = [];
		if (!local) {
			if (deferred.length) this.render();
			return;
		}
		const moved = deferred.length ? transformSplices([local], deferred, true).a : [local];
		const last = moved.at(-1);
		const end = last ? last.at + last.text.length : (caret?.end ?? 0);
		// The page holds the browser's version of the drawn text, not the file's: put the file's back before applying.
		this.drawnText = this.sync.text;
		this.keys.clear();
		this.root.replaceChildren();
		this.apply(moved, { start: end, end }, "type");
	}
}

/** A range moved past splices that landed around it. */
function shiftRange<T extends Range2>(at: T, applied: readonly Splice[]): T {
	const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
	return { ...at, start: move(at.start), end: move(at.end) };
}
