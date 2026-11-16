// What the person's typing, pasting and clicking do: words that style themselves, undo
// and redo, a double click into a held block, committing and leaving.
import { isScribbleCatch } from "@decks/ui";
import { type Tokens } from "marked";
import { cardMarked } from "../card-syntax.ts";
import { BLOCKS, INLINE, ZW, h } from "./model.ts";
import { placeAfter, sel } from "./markup.ts";
import type { EditorCtx } from "./ctx.ts";

// Typing
export function onInput(cx: EditorCtx, event: InputEvent) {
	// Words typed straight into the card, outside any block, become a paragraph of their own.
	const loose = sel().anchorNode;
	if (loose?.nodeType === 3 && loose.parentNode === cx.ed) {
		const at = sel().anchorOffset;
		const p = h("p");
		cx.ed.insertBefore(p, loose);
		p.append(loose);
		const r = document.createRange();
		r.setStart(loose, at);
		r.collapse(true);
		sel().removeAllRanges();
		sel().addRange(r);
	}
	if (event.inputType === "insertText") {
		const node = sel().anchorNode;
		const off = sel().anchorOffset;
		if (node && node.nodeType === 3 && cx.ed.contains(node)) {
			const before = (node.textContent ?? "").slice(0, off);
			const blk = cx.topOf(node);
			if (event.data === " " && blk && (blk.tagName === "P" || blk.tagName === "DIV")) {
				const typed = (blk.textContent ?? "").replace(/​/g, "");
				const head = before.replace(/​/g, "").replace(/ /g, " ");
				const rule = typed.replace(/ /g, " ").startsWith(head) && blk.firstChild === node ? BLOCKS[head] : undefined;
				if (rule) {
					const r = document.createRange();
					r.setStart(node, 0);
					r.setEnd(node, off);
					r.deleteContents();
					const outer = h((rule === "check" ? "ul" : rule) as "p");
					const inner = rule === "ul" || rule === "ol" || rule === "check" ? outer.appendChild(h("li")) : rule === "blockquote" ? outer.appendChild(h("p")) : outer;
					if (rule === "check") inner.append(h("span", { class: "pce-check", contenteditable: "false" }));
					while (blk.firstChild) inner.append(blk.firstChild);
					const z = document.createTextNode(ZW);
					inner.append(z);
					blk.replaceWith(outer);
					const c = document.createRange();
					c.setStart(z, 1);
					c.collapse(true);
					sel().removeAllRanges();
					sel().addRange(c);
					return cx.changed();
				}
			}
			// In a list already, a list's marker typed at the start of an item is the item itself.
			const li = node.parentElement?.closest("li");
			if (event.data === " " && li && cx.ed.contains(li) && (li.firstChild === node || (li.firstChild as HTMLElement | null)?.classList?.contains("pce-check"))) {
				const head = before.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
				if (/^([-*+]|\d+[.)]|\[ ?\])\s$/.test(head)) {
					const r = document.createRange();
					r.setStart(node, 0);
					r.setEnd(node, off);
					r.deleteContents();
					if (head.startsWith("[") && !li.querySelector(":scope > .pce-check")) li.prepend(h("span", { class: "pce-check", contenteditable: "false" }));
					return cx.changed();
				}
			}
			for (const [re, tag] of INLINE) {
				const m = re.exec(before);
				if (!m) continue;
				const full = /^[*_=~`]/.test(m[0]) ? m[0] : m[0].slice(1);
				const r = document.createRange();
				r.setStart(node, off - full.length);
				r.setEnd(node, off);
				r.deleteContents();
				const el = h(tag as "strong", {}, m[1]);
				r.insertNode(el);
				placeAfter(el);
				break;
			}
		}
	}
	cx.changed();
}

// Undo and redo
export function changed(cx: EditorCtx) {
	cx.frame ??= requestAnimationFrame(() => {
		cx.frame = undefined;
		if (cx.done) return;
		const now = cx.serialise();
		if (cx.past.at(-1) !== now) {
			cx.past.push(now);
			if (cx.past.length > 200) cx.past.shift();
			cx.future.length = 0;
		}
		cx.props.onInput(now);
	});
	cx.showBar();
}

export function travel(cx: EditorCtx, back: boolean) {
	const from = back ? cx.past : cx.future;
	const to = back ? cx.future : cx.past;
	if (back ? from.length < 2 : !from.length) return;
	const moved = from.pop()!;
	to.push(moved);
	const md = back ? cx.past.at(-1)! : moved;
	cx.build(md);
	let end: Node = cx.ed;
	while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
	caretInto(end as Element, false);
	const r = sel().getRangeAt(0);
	r.selectNodeContents(end);
	r.collapse(false);
	cx.props.onInput(md);
	cx.showBar();
}

// Pasting
export function onPaste(cx: EditorCtx, event: ClipboardEvent) {
	const text = event.clipboardData?.getData("text/plain");
	if (!text) return;
	event.preventDefault();
	const r = sel().getRangeAt(0);
	r.deleteContents();
	if (/\n/.test(text)) {
		const holder = h("div");
		const saved = cx.ed;
		cx.ed = holder as HTMLDivElement;
		cx.build(text);
		cx.ed = saved;
		const at = cx.topOf(r.startContainer);
		const frag = document.createDocumentFragment();
		for (const el of [...holder.children] as HTMLElement[]) {
			delete el.dataset.raw;
			frag.append(el);
		}
		if (at) at.after(frag);
		else cx.ed.append(frag);
	} else {
		const holder = h("span");
		const first = cardMarked().lexer(text)[0] as Tokens.Paragraph | undefined;
		cx.inline(holder, first?.tokens ?? [{ type: "text", raw: text, text } as Tokens.Text]);
		const nodes = [...holder.childNodes];
		for (const n of nodes.reverse()) r.insertNode(n);
	}
	cx.changed();
}

// Clicks
export function onClick(cx: EditorCtx, event: MouseEvent) {
	const t = event.target as HTMLElement;
	if (t.classList.contains("pce-check")) {
		t.toggleAttribute("data-on");
		return cx.changed();
	}
	const sug = t.closest(".pce-sug") as HTMLElement | null;
	if (sug && (t.closest("[data-accept]") || t.closest("[data-reject]"))) {
		const keep = t.closest("[data-accept]") ? sug.querySelector("ins")?.textContent : sug.querySelector("del")?.textContent;
		sug.replaceWith(document.createTextNode(keep ?? ""));
		return cx.changed();
	}
}

export function onDblClick(cx: EditorCtx, event: MouseEvent) {
	const raw = (event.target as HTMLElement).closest(".pce-raw") as HTMLElement | null;
	if (!raw || raw.tagName !== "DIV" || raw.parentElement !== cx.ed) return;
	const box = h("pre", { class: "pce-rawedit", contenteditable: "true", "data-sep": raw.dataset.sep ?? "\n\n" }, raw.dataset.raw ?? "");
	raw.replaceWith(box);
	box.focus({ preventScroll: true });
	cx.changed();
}

/** The caret in an element: at its start, or with all of its words selected. */
export function caretInto(el: Element, all: boolean) {
	const r = document.createRange();
	r.selectNodeContents(el);
	if (!all) r.collapse(true);
	sel().removeAllRanges();
	sel().addRange(r);
}

// Committing and leaving
export function commit(cx: EditorCtx) {
	if (cx.done) return;
	cx.done = true;
	cx.props.onCommit(cx.serialise());
}

export function onFocusOut(cx: EditorCtx, event: FocusEvent) {
	if (event.relatedTarget instanceof Node && cx.wrap.contains(event.relatedTarget)) return;
	// The pencil writing over the canvas (`ScribbleCatch`): the card stays open until it is done.
	if (isScribbleCatch(event.relatedTarget)) return;
	// A press on the style bar or a piece keeps the focus where it was.
	setTimeout(() => {
		if (!cx.done && !cx.wrap.contains(document.activeElement) && !isScribbleCatch(document.activeElement)) cx.commit();
	}, 0);
}

/** Handwritten words, at the end of the card's last line, as typing them there would put them. */
export function appendWords(cx: EditorCtx, text: string) {
	// The last line with words: the editor keeps an empty paragraph at the foot, which is not where writing goes on.
	const blocks = [...cx.ed.children].filter((one) => (one as HTMLElement).getAttribute("contenteditable") !== "false");
	let end: Node = [...blocks].reverse().find((one) => (one.textContent ?? "").trim() !== "") ?? blocks[0] ?? cx.ed;
	while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
	(end as Element).append(document.createTextNode(text));
	cx.changed();
}
