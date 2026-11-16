import { For, onCleanup, onMount, type JSX } from "solid-js";
import { isScribbleCatch, ScribbleCatch } from "@decks/ui";
import Baseline from "lucide-solid/icons/baseline";
import Bold from "lucide-solid/icons/bold";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Code from "lucide-solid/icons/code";
import Highlighter from "lucide-solid/icons/highlighter";
import Italic from "lucide-solid/icons/italic";
import Link from "lucide-solid/icons/link";
import List from "lucide-solid/icons/list";
import ListChecks from "lucide-solid/icons/list-checks";
import ListOrdered from "lucide-solid/icons/list-ordered";
import Minus from "lucide-solid/icons/minus";
import Redo2 from "lucide-solid/icons/redo-2";
import RemoveFormatting from "lucide-solid/icons/remove-formatting";
import SquareCode from "lucide-solid/icons/square-code";
import Strikethrough from "lucide-solid/icons/strikethrough";
import Table from "lucide-solid/icons/table";
import TextQuote from "lucide-solid/icons/text-quote";
import Underline from "lucide-solid/icons/underline";
import Undo2 from "lucide-solid/icons/undo-2";
import { pageFont } from "../look/look.ts";
import type { Tokens } from "marked";
import { cardMarked, FONT_GROUPS } from "../model/card-syntax.ts";
import { cut, splitAround, STYLES, unwrap, type Style } from "./card-styles.ts";
import { atom, h, inline, readCard, writeCard, ZW, type WordsHost } from "./card-words.ts";
import { pictureAddress } from "../host.ts";

/**
 * The editor over a card (`Stage.tsx`): its words as they read, typed into in place, and written back
 * as the card's markdown (`card-syntax.ts`).
 *
 * Words style themselves as they are typed (`**bold**`, `==mark==`, `# ` at the start of a line), a
 * selection gets a bar of styles, an agent's suggestion waits for ✓ or ✕, and a picture, a file or a
 * `[[link]]` is a piece that drags: a whole-line piece between lines, an in-line one into a sentence,
 * with a ghost beside the pointer and a mark where it will land.
 *
 * A card can hold more than this editor can show as it reads: a table, raw HTML, a link definition.
 * Those stay as their markdown in a grey box, and a double click opens it as text. And a block that
 * was not touched is written back exactly as it was read: each top-level block keeps its source
 * (`data-raw`) until something in it changes, so an edit to one line never rewrites the rest.
 */

interface CardEditorProps {
	value: string;
	/** Where the deck's files are, for the card's pictures. */
	base: string;
	/** A new empty line before this block, the caret in it: a double-click in a gap of the card. */
	insertAt?: number;
	/** Where the caret goes, a screen point: a double-click on the card's words. */
	caretAt?: { x: number; y: number };
	/** Items in the card the editor keeps but cannot type into, by id: what to call each (`card-frame.ts`). */
	held?: Record<string, string>;
	/** The camera's zoom: the editor is drawn in the stage's units, its style bar in the screen's. */
	zoom: number;
	class?: string;
	style: JSX.CSSProperties;
	onInput(markdown: string): void;
	onCommit(markdown: string): void;
	/** Escape: with the words as they are now, for a card just made, which keeps them. */
	onCancel(markdown: string): void;
}

const BLOCK_MENU: ReadonlyArray<[string, string]> = [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["quote", "Quote"], ["code", "Code block"]];
const SIZE_MENU: ReadonlyArray<[string, string]> = [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]];
const SIX = ["yellow", "orange", "red", "green", "blue", "purple"] as const;

export function CardEditor(props: CardEditorProps) {
	let wrap!: HTMLDivElement;
	let ed!: HTMLDivElement;
	let bar!: HTMLDivElement;
	let caret!: HTMLDivElement;
	let tools!: HTMLDivElement;
	let line!: HTMLDivElement;
	/** Whitespace before the first block, kept as it was. */
	let lead = "";
	let trail = "";
	let done = false;
	const url = (src: string) => {
		try {
			return pictureAddress(src, new URL(props.base || "/", location.origin).href);
		} catch {
			return src;
		}
	};

	/* ---------- the card's markdown, in and out (`card-words.ts`) ---------- */

	const words: WordsHost = { url, held: (id) => props.held?.[id] };
	const build = (md: string) => {
		({ lead, trail } = readCard(words, ed, md));
	};
	const serialise = () => writeCard(ed, lead, trail);

	/* ---------- typing ---------- */

	const sel = () => getSelection()!;
	const topOf = (n: Node | null): HTMLElement | undefined => {
		while (n && n.parentNode !== ed) n = n.parentNode;
		return n instanceof HTMLElement ? n : undefined;
	};
	function placeAfter(node: Node) {
		const z = document.createTextNode(ZW);
		node.parentNode!.insertBefore(z, node.nextSibling);
		const r = document.createRange();
		r.setStart(z, 1);
		r.collapse(true);
		sel().removeAllRanges();
		sel().addRange(r);
	}
	const INLINE: Array<[RegExp, string]> = [
		[/\*\*([^*​]+)\*\*$/, "strong"],
		[/==([^=​]+)==$/, "mark"],
		[/~~([^~​]+)~~$/, "s"],
		[/`([^`​]+)`$/, "code"],
		[/(?:^|[^*])\*([^*​]+)\*$/, "em"],
		[/(?:^|[^_\w])_([^_​]+)_$/, "em"],
	];
	const BLOCKS: Record<string, string> = { "# ": "h1", "## ": "h2", "### ": "h3", "> ": "blockquote", "- ": "ul", "* ": "ul", "1. ": "ol", "[] ": "check", "[ ] ": "check" };
	function onInput(event: InputEvent) {
		// Words typed straight into the card, outside any block, become a paragraph of their own.
		const loose = sel().anchorNode;
		if (loose?.nodeType === 3 && loose.parentNode === ed) {
			const at = sel().anchorOffset;
			const p = h("p");
			ed.insertBefore(p, loose);
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
			if (node && node.nodeType === 3 && ed.contains(node)) {
				const before = (node.textContent ?? "").slice(0, off);
				const blk = topOf(node);
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
						return changed();
					}
				}
				// In a list already, a list's marker typed at the start of an item is the item itself.
				const li = node.parentElement?.closest("li");
				if (event.data === " " && li && ed.contains(li) && (li.firstChild === node || (li.firstChild as HTMLElement | null)?.classList?.contains("pce-check"))) {
					const head = before.replace(/\u200b/g, "").replace(/\u00a0/g, " ");
					if (/^([-*+]|\d+[.)]|\[ ?\])\s$/.test(head)) {
						const r = document.createRange();
						r.setStart(node, 0);
						r.setEnd(node, off);
						r.deleteContents();
						if (head.startsWith("[") && !li.querySelector(":scope > .pce-check")) li.prepend(h("span", { class: "pce-check", contenteditable: "false" }));
						return changed();
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
		changed();
	}
	let frame: number | undefined;
	/** What the card said after each change, for undo; what was undone, for redo. */
	const past: string[] = [];
	const future: string[] = [];
	function changed() {
		frame ??= requestAnimationFrame(() => {
			frame = undefined;
			if (done) return;
			const now = serialise();
			if (past.at(-1) !== now) {
				past.push(now);
				if (past.length > 200) past.shift();
				future.length = 0;
			}
			props.onInput(now);
		});
		showBar();
	}
	function travel(back: boolean) {
		const from = back ? past : future;
		const to = back ? future : past;
		if (back ? from.length < 2 : !from.length) return;
		const moved = from.pop()!;
		to.push(moved);
		const md = back ? past.at(-1)! : moved;
		build(md);
		let end: Node = ed;
		while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
		caretInto(end as Element, false);
		const r = sel().getRangeAt(0);
		r.selectNodeContents(end);
		r.collapse(false);
		props.onInput(md);
		showBar();
	}
	function onPaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData("text/plain");
		if (!text) return;
		event.preventDefault();
		const r = sel().getRangeAt(0);
		r.deleteContents();
		if (/\n/.test(text)) {
			const holder = h("div");
			const saved = ed;
			ed = holder as HTMLDivElement;
			build(text);
			ed = saved;
			const at = topOf(r.startContainer);
			const frag = document.createDocumentFragment();
			for (const el of [...holder.children] as HTMLElement[]) {
				delete el.dataset.raw;
				frag.append(el);
			}
			if (at) at.after(frag);
			else ed.append(frag);
		} else {
			const holder = h("span");
			const first = cardMarked().lexer(text)[0] as Tokens.Paragraph | undefined;
			inline(words, holder, first?.tokens ?? [{ type: "text", raw: text, text } as Tokens.Text]);
			const nodes = [...holder.childNodes];
			for (const n of nodes.reverse()) r.insertNode(n);
		}
		changed();
	}

	/* ---------- the style bar ---------- */

	/*
	 * The toolbar: over the words selected, as a selection's bar is, at the screen's size whatever the
	 * zoom, in two rows that scroll sideways when the screen is narrower than them. Above the words, or
	 * under them when the app's own bars or the screen's top are in the way, and never past an edge.
	 * It goes the moment the camera moves and comes back with a fade where the words came to rest, as
	 * the board pill does (`placing`).
	 */
	let wanted = false;
	/*
	 * Shown once a selection stops changing, not while it is being made: a pointer selecting words
	 * shows the bar when it lifts, and a selection the keyboard grows shows it after a short pause.
	 */
	let selecting = false;
	let settleBar: ReturnType<typeof setTimeout> | undefined;
	const SELECTION_PAUSE_MS = 300;
	function placeBar() {
		if (!bar.isConnected || !wanted || !sel().rangeCount) return;
		const r = sel().getRangeAt(0).getBoundingClientRect();
		const w = wrap.getBoundingClientRect();
		const z = props.zoom;
		bar.style.transform = `scale(${1 / z})`;
		const bw = bar.offsetWidth;
		const bh = bar.offsetHeight;
		const ceiling = Math.max(8, ...[...document.querySelectorAll('[data-inset="top"]')].map((el) => el.getBoundingClientRect().bottom + 6));
		const above = r.top - bh - 10;
		const top = above >= ceiling ? above : Math.min(innerHeight - bh - 8, r.bottom + 10);
		// Centred on the words selected, kept on the screen and clear of the app's tool column at its side.
		const floor = Math.max(8, ...[...document.querySelectorAll(".pen-tools")].map((el) => el.getBoundingClientRect()).filter((t) => t.width && t.top < top + bh && t.bottom > top && t.left < innerWidth / 3).map((t) => t.right + 6));
		const left = Math.max(floor, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
		bar.style.left = `${(left - w.left) / z}px`;
		bar.style.top = `${(top - w.top) / z}px`;
	}
	/** The toolbar says what the words under the caret are: their block, font and size, and which styles are on. */
	function showBar() {
		const s = sel();
		const was = wanted;
		// Shown while words are selected, as before; a press inside the bar keeps the selection, so it stays.
		wanted = !dragging && !selecting && s.rangeCount > 0 && !s.isCollapsed && ed.contains(s.anchorNode);
		bar.toggleAttribute("data-off", !wanted);
		if (!wanted) closeMenus();
		if (!wanted) return;
		if (!was || !bar.hasAttribute("data-hidden")) placeBar();
		const at = s.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode?.parentElement;
		const label = (name: string, text: string) => {
			const el = bar.querySelector(`[data-label="${name}"]`);
			if (el) el.textContent = text;
		};
		const kind = blockKind();
		label("block", BLOCK_MENU.find(([k]) => k === kind)?.[1] ?? "Body text");
		const face = (at?.closest("span[data-font]") as HTMLElement | null)?.dataset.font;
		label("font", face ?? "Inter");
		label("size", SIZE_MENU.find(([k]) => k === ((at?.closest("span[data-size]") as HTMLElement | null)?.dataset.size ?? "normal"))?.[1] ?? "Normal");
		const on: Record<string, boolean> = {
			bold: !!at?.closest("strong, b"),
			italic: !!at?.closest("em, i"),
			underline: !!at?.closest("u"),
			strikeThrough: !!at?.closest("s, strike, del"),
			code: !!at?.closest("code"),
			link: !!at?.closest("a[data-href]"),
			ul: kind === "ul",
			ol: kind === "ol",
			check: kind === "check",
			quote: kind === "quote",
			codeblock: kind === "code",
		};
		for (const button of bar.querySelectorAll<HTMLElement>("[data-cmd], [data-block-button]")) {
			const key = button.dataset.cmd ?? button.dataset.blockButton ?? "";
			if (key in on) button.setAttribute("aria-pressed", String(on[key]));
		}
	}
	/** Open one of the toolbar's menus under its button, or close it; one at a time. */
	function toggleMenu(name: string, button: HTMLElement) {
		const menu = bar.querySelector<HTMLElement>(`.pce-menu[data-for="${name}"]`);
		const open = menu?.hasAttribute("data-open");
		closeMenus();
		if (!menu || open) return;
		// The font menu fetches its faces the first time it opens, each name shown in its own.
		if (name === "font") for (const el of menu.querySelectorAll<HTMLElement>("[data-font]")) if (!el.style.fontFamily && el.dataset.font !== "default") el.style.fontFamily = pageFont(el.dataset.font!, 400, false);
		menu.style.left = `${button.offsetLeft - tools.scrollLeft}px`;
		menu.setAttribute("data-open", "");
	}
	const closeMenus = () => bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));
	/** A table of two columns and one row, or a rule, under the block the caret is in. */
	function insertBlock(kind: "table" | "rule") {
		const node = sel().anchorNode;
		const after = topOf(node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null) ?? (ed.lastElementChild as HTMLElement | null);
		let made: HTMLElement;
		if (kind === "table") {
			made = h("table", { class: "pce-table", "data-align": "," });
			const head = made.appendChild(h("thead")).appendChild(h("tr"));
			head.append(h("th", {}, "Column"), h("th", {}, "Column"));
			made.appendChild(h("tbody")).appendChild(h("tr")).append(h("td"), h("td"));
		} else made = atom("---", "", "pce-atom pce-rule", "div");
		const next = h("p");
		next.append(document.createTextNode(ZW));
		if (after) after.after(made, next);
		else ed.append(made, next);
		caretInto(kind === "table" ? made.querySelector("td")! : next, false);
	}
	function restyle(styles: Style[], value: string | null) {
		const runs = cut(ed);
		if (!runs.length) return;
		const texts = runs.flatMap((run) => {
			const walk = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
			const out: Text[] = [];
			for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
			return out;
		});
		for (const name of styles) {
			const style = STYLES[name];
			// Bold on what is all bold already takes it off, as everywhere.
			const off = value === null || (style.toggles && runs.every((run) => run.closest(style.selector) || run.querySelector(style.selector)?.textContent === run.textContent));
			for (const run of runs) {
				for (let outer = run.parentElement?.closest(style.selector) as HTMLElement | null; outer && ed.contains(outer); outer = run.parentElement?.closest(style.selector) as HTMLElement | null) splitAround(run, outer);
				run.querySelectorAll(style.selector).forEach(unwrap);
				if (off) continue;
				const made = style.make(value ?? "");
				made.append(...run.childNodes);
				run.append(made);
			}
			// Runs side by side in the same style are one.
			for (const el of [...ed.querySelectorAll(style.selector)] as HTMLElement[]) {
				let next = el.nextSibling;
				while (next instanceof HTMLElement && next.matches(style.selector) && next.tagName === el.tagName && next.dataset.c === el.dataset.c && next.dataset.fg === el.dataset.fg && next.dataset.size === el.dataset.size && next.dataset.font === el.dataset.font && next.dataset.href === el.dataset.href) {
					el.append(...next.childNodes);
					next.remove();
					next = el.nextSibling;
				}
			}
		}
		runs.forEach(unwrap);
		ed.normalize();
		// The words stay selected, for the next style.
		const first = texts.find((t) => t.isConnected);
		const last = [...texts].reverse().find((t) => t.isConnected);
		if (first && last) {
			const r = document.createRange();
			r.setStart(first, 0);
			r.setEnd(last, last.length);
			sel().removeAllRanges();
			sel().addRange(r);
		}
	}
	function style(event: MouseEvent) {
		const b = (event.target as Element).closest("button");
		if (!b) return;
		const d = b.dataset;
		if (d.menu) return toggleMenu(d.menu, b);
		closeMenus();
		const commands: Record<string, Style> = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strike", code: "code" };
		if (d.block) setBlock(d.block);
		else if (d.blockButton) setBlock(d.blockButton === "codeblock" ? "code" : blockKind() === d.blockButton ? "p" : d.blockButton);
		else if (d.hl) restyle(["hl"], d.hl === "none" ? null : d.hl);
		else if (d.fg) restyle(["fg"], d.fg === "none" ? null : d.fg);
		else if (d.size) restyle(["size"], d.size === "normal" ? null : d.size);
		else if (d.font) restyle(["font"], d.font === "default" ? null : d.font);
		else if (d.insert) insertBlock(d.insert as "table" | "rule");
		else if (d.cmd === "undo" || d.cmd === "redo") return travel(d.cmd === "undo");
		else if (d.cmd === "link") {
			const here = (sel().anchorNode?.parentElement?.closest("a[data-href]") as HTMLElement | null)?.dataset.href ?? "";
			const href = window.prompt("Link to (empty takes the link off)", here || "https://");
			if (href === null) return;
			restyle(["link"], href.trim() && href.trim() !== "https://" ? href.trim() : null);
		} else if (d.cmd === "clear") restyle(["bold", "italic", "underline", "strike", "code", "hl", "fg", "size", "font"], null);
		else if (d.cmd && commands[d.cmd]) restyle([commands[d.cmd]!], "on");
		changed();
	}

	/* ---------- what a block is: text, a heading, a quote, code, a list ---------- */

	const BLOCK_NAMES: Record<string, string> = { p: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", quote: "Quote", code: "Code", ul: "Bullets", ol: "Numbers", check: "Checklist" };
	/** What the block the caret is in is, by the names the block menu uses. */
	function blockKind(): string {
		const node = sel().anchorNode;
		const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
		const top = topOf(el);
		if (!top) return "p";
		if (/^H[1-3]$/.test(top.tagName)) return top.tagName.toLowerCase();
		if (top.tagName === "BLOCKQUOTE") return "quote";
		if (top.tagName === "PRE") return "code";
		if (top.tagName === "OL") return "ol";
		if (top.tagName === "UL") return el?.closest("li")?.querySelector(":scope > .pce-check") ? "check" : "ul";
		return "p";
	}
	/** Every block the selection touches becomes `kind`: its lines kept, its words' styles with them. */
	function setBlock(kind: string) {
		if (!sel().rangeCount) return;
		const range = sel().getRangeAt(0);
		const touched = ([...ed.children] as HTMLElement[]).filter((block) => range.intersectsNode(block) && !block.classList.contains("pce-piece") && !block.classList.contains("pce-atom"));
		if (!touched.length) return;
		// Each block as lines of inline words.
		const lines: Node[][] = [];
		const inlineOf = (el: Element) => [...el.childNodes].filter((n) => !(n instanceof HTMLElement && (n.classList.contains("pce-check") || n.tagName === "UL" || n.tagName === "OL")));
		for (const block of touched) {
			if (block.tagName === "UL" || block.tagName === "OL") {
				for (const li of block.querySelectorAll("li")) lines.push(inlineOf(li).flatMap((n) => (n instanceof HTMLElement && n.tagName === "P" ? [...n.childNodes] : [n])));
			} else if (block.tagName === "BLOCKQUOTE") {
				for (const p of block.querySelectorAll(":scope > p")) lines.push([...p.childNodes]);
			} else if (block.tagName === "PRE") {
				for (const text of (block.textContent ?? "").split("\n")) lines.push([document.createTextNode(text)]);
			} else if (block.tagName === "TABLE") continue;
			else lines.push([...block.childNodes]);
		}
		const made: HTMLElement[] = [];
		const filled = (el: HTMLElement, nodes: Node[]) => {
			el.append(...(nodes.length ? nodes : [document.createTextNode(ZW)]));
			return el;
		};
		if (kind === "quote") {
			const quote = h("blockquote");
			for (const nodes of lines) quote.append(filled(h("p"), nodes));
			made.push(quote);
		} else if (kind === "code") made.push(h("pre", { class: "pce-code", "data-lang": "" }, lines.map((nodes) => nodes.map((n) => n.textContent).join("")).join("\n")));
		else if (kind === "ul" || kind === "ol" || kind === "check") {
			const list = h(kind === "ol" ? "ol" : "ul");
			for (const nodes of lines) {
				const li = filled(h("li"), nodes);
				if (kind === "check") li.prepend(h("span", { class: "pce-check", contenteditable: "false" }));
				list.append(li);
			}
			made.push(list);
		} else for (const nodes of lines) made.push(filled(h(kind as "p"), nodes));
		touched[0]!.before(...made);
		touched.forEach((block) => block.remove());
		const last = made.at(-1)!;
		const r = document.createRange();
		r.selectNodeContents(last.querySelector("li:last-child, p:last-child") ?? last);
		r.collapse(false);
		sel().removeAllRanges();
		sel().addRange(r);
	}

	/* ---------- presses inside: checks, suggestions, raw boxes ---------- */

	function onClick(event: MouseEvent) {
		const t = event.target as HTMLElement;
		if (t.classList.contains("pce-check")) {
			t.toggleAttribute("data-on");
			return changed();
		}
		const sug = t.closest(".pce-sug") as HTMLElement | null;
		if (sug && (t.closest("[data-accept]") || t.closest("[data-reject]"))) {
			const keep = t.closest("[data-accept]") ? sug.querySelector("ins")?.textContent : sug.querySelector("del")?.textContent;
			sug.replaceWith(document.createTextNode(keep ?? ""));
			return changed();
		}
	}
	function onDblClick(event: MouseEvent) {
		const raw = (event.target as HTMLElement).closest(".pce-raw") as HTMLElement | null;
		if (!raw || raw.tagName !== "DIV" || raw.parentElement !== ed) return;
		const box = h("pre", { class: "pce-rawedit", contenteditable: "true", "data-sep": raw.dataset.sep ?? "\n\n" }, raw.dataset.raw ?? "");
		raw.replaceWith(box);
		box.focus({ preventScroll: true });
		changed();
	}

	/* ---------- pieces that drag ---------- */

	let dragging: HTMLElement | undefined;
	let ghost: HTMLElement | undefined;
	let press: { it: HTMLElement; x: number; y: number; id: number } | undefined;
	let target: { kind: "line"; before: Element | null } | { kind: "text"; range: Range } | undefined;
	const local = (x: number, y: number) => {
		const w = wrap.getBoundingClientRect();
		return { x: (x - w.left) / props.zoom, y: (y - w.top) / props.zoom };
	};
	function hideMarks() {
		caret.style.display = line.style.display = "none";
	}
	function lineSlot(y: number) {
		const kids = [...ed.children].filter((k) => k !== dragging);
		let i = kids.findIndex((k) => {
			const r = k.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		if (i < 0) i = kids.length;
		const er = ed.getBoundingClientRect();
		const at = !kids.length
			? er.top + 8
			: i === 0
				? kids[0]!.getBoundingClientRect().top - 3
				: i === kids.length
					? kids[i - 1]!.getBoundingClientRect().bottom + 3
					: (kids[i - 1]!.getBoundingClientRect().bottom + kids[i]!.getBoundingClientRect().top) / 2;
		const p = local(er.left, at);
		line.style.display = "block";
		line.style.left = `${p.x}px`;
		line.style.top = `${p.y - 1.5 / props.zoom}px`;
		line.style.width = `${er.width / props.zoom}px`;
		line.style.height = `${3 / props.zoom}px`;
		target = { kind: "line", before: kids[i] ?? null };
	}
	function textSlot(x: number, y: number) {
		const r = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
		const n = r && (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement);
		if (!r || !n || !ed.contains(n) || n === ed || n.closest(".pce-piece, .pce-sug, .pce-atom, pre") || dragging!.contains(n)) return;
		const rect = r.getClientRects()[0] ?? n.getBoundingClientRect();
		const p = local(rect.left, rect.top);
		caret.style.display = "block";
		caret.style.left = `${p.x - 1 / props.zoom}px`;
		caret.style.top = `${p.y}px`;
		caret.style.width = `${2 / props.zoom}px`;
		caret.style.height = `${Math.max(16, rect.height) / props.zoom}px`;
		target = { kind: "text", range: r };
	}
	function onPointerDown(event: PointerEvent) {
		// A press on a suggestion's buttons or a check keeps the caret where it is, a finger's too: a
		// finger's press would otherwise take the focus away, and that saves the card and closes it.
		if ((event.target as Element).closest(".pce-sug button, .pce-check")) {
			event.preventDefault();
			return;
		}
		const it = (event.target as Element).closest(".pce-piece") as HTMLElement | null;
		if (!it || event.button !== 0 || !ed.contains(it)) return;
		event.preventDefault();
		event.stopPropagation();
		press = { it, x: event.clientX, y: event.clientY, id: event.pointerId };
	}
	function onPointerMove(event: PointerEvent) {
		if (!press || event.pointerId !== press.id) return;
		if (!dragging) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) return;
			dragging = press.it;
			ghost = dragging.cloneNode(true) as HTMLElement;
			ghost.className += " pce-ghost";
			wrap.append(ghost);
			dragging.classList.add("pce-dragging");
			closeMenus();
			sel().removeAllRanges();
		}
		const p = local(event.clientX, event.clientY);
		// Below and right of the pointer, so the mark where it lands stays in view.
		ghost!.style.left = `${p.x + 12 / props.zoom}px`;
		ghost!.style.top = `${p.y + 12 / props.zoom}px`;
		hideMarks();
		target = undefined;
		const over = document.elementFromPoint(event.clientX, event.clientY);
		if (over && ed.contains(over)) {
			if (dragging.classList.contains("pce-block")) lineSlot(event.clientY);
			else textSlot(event.clientX, event.clientY);
		}
	}
	function endDrag(cancel: boolean) {
		const el = dragging;
		press = undefined;
		if (!el) return;
		dragging = undefined;
		hideMarks();
		ghost?.remove();
		ghost = undefined;
		el.classList.remove("pce-dragging");
		if (cancel || !target) return;
		const from = el.parentElement;
		// Taking a piece out of a sentence leaves one space, not two.
		const prev = el.previousSibling;
		const next = el.nextSibling;
		if (prev?.nodeType === 3 && next?.nodeType === 3 && /\s$/.test(prev.textContent ?? "") && /^\s/.test(next.textContent ?? "")) next.textContent = (next.textContent ?? "").replace(/^\s+/, "");
		if (target.kind === "line") ed.insertBefore(el, target.before);
		else {
			const r = target.range;
			let n = r.startContainer;
			let o = r.startOffset;
			// Never inside a word: to its nearer edge, with a space either side.
			if (n.nodeType === 3) {
				const text = n.textContent ?? "";
				const back = text.slice(0, o).search(/\S+$/);
				const fwd = text.slice(o).search(/\s|$/);
				if (back >= 0 && fwd > 0) o = o - back <= fwd ? back : o + fwd;
				r.setStart(n, o);
				r.collapse(true);
			}
			r.insertNode(el);
			if (!/\s$/.test(el.previousSibling?.textContent ?? " ")) el.before(" ");
			if (!/^\s/.test(el.nextSibling?.textContent ?? "")) el.after(" ");
		}
		if (from && from !== ed && from.parentElement === ed && !from.textContent?.replace(/​/g, "").trim() && !from.querySelector(".pce-piece, .pce-check")) from.remove();
		target = undefined;
		changed();
	}

	/** The caret in an element: at its start, or with all of its words selected. */
	function caretInto(el: Element, all: boolean) {
		const r = document.createRange();
		r.selectNodeContents(el);
		if (!all) r.collapse(true);
		sel().removeAllRanges();
		sel().addRange(r);
	}

	/* ---------- in and out ---------- */

	function commit() {
		if (done) return;
		done = true;
		props.onCommit(serialise());
	}
	function onKeyDown(event: KeyboardEvent) {
		/*
		 * Home and End move the caret to the line's start and end, Shift extending the selection. On a Mac
		 * they scroll the nearest scroll area instead, which is now the stage (`camera/scroll-area.ts`):
		 * Home in a card sent the canvas some 110,000 units up. The note editor does the same itself.
		 */
		if ((event.key === "Home" || event.key === "End") && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			const selection = sel() as Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
			selection.modify?.(event.shiftKey ? "extend" : "move", event.key === "Home" ? "backward" : "forward", "lineboundary");
			return;
		}
		const at = sel().anchorNode;
		const here = at ? (at.nodeType === 1 ? (at as Element) : at.parentElement) : null;
		// In a callout's title, Enter goes on to its first line.
		const chead = here?.closest(".pce-chead");
		if (event.key === "Enter" && chead && ed.contains(chead)) {
			event.preventDefault();
			const next = chead.nextElementSibling ?? chead.parentElement!.appendChild(h("p"));
			caretInto(next, false);
			return;
		}
		// In a table, Enter goes down a column (adding a row past the last), Tab across the cells.
		const cell = here?.closest("td, th") as HTMLTableCellElement | null;
		if (cell && ed.contains(cell) && ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab")) {
			event.preventDefault();
			const table = cell.closest("table")!;
			const rows = [...table.querySelectorAll("tr")];
			const row = cell.parentElement as HTMLTableRowElement;
			const r = rows.indexOf(row);
			const c = [...row.children].indexOf(cell);
			let target: Element | undefined;
			if (event.key === "Tab") {
				const flat = rows.flatMap((one) => [...one.children]);
				target = flat[flat.indexOf(cell) + (event.shiftKey ? -1 : 1)];
			} else {
				if (r === rows.length - 1) {
					const fresh = h("tr");
					for (let i = 0; i < row.children.length; i++) fresh.append(h("td"));
					table.querySelector("tbody")!.append(fresh);
					rows.push(fresh);
				}
				target = rows[r + 1]!.children[c];
			}
			if (target) caretInto(target, true);
			return changed();
		}
		const mod = event.metaKey || event.ctrlKey;
		// The card keeps its own history, since the browser's cannot follow what the toolbar does.
		if (mod && event.key.toLowerCase() === "z") {
			event.preventDefault();
			return travel(!event.shiftKey);
		}
		if (mod && event.key.toLowerCase() === "y") {
			event.preventDefault();
			return travel(false);
		}
		// ⌘B, ⌘I, ⌘U, ⌘E and ⌘⇧X go through the card's own styles, as the toolbar's buttons do.
		const keyed: Record<string, Style> = { b: "bold", i: "italic", u: "underline", x: "strike", e: "code" };
		const want = mod && keyed[event.key.toLowerCase()];
		if (want && (want !== "strike" || event.shiftKey) && !sel().isCollapsed) {
			event.preventDefault();
			restyle([want], "on");
			return changed();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			if (dragging) return endDrag(true);
			done = true;
			props.onCancel(serialise());
		} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			commit();
		}
	}
	function onFocusOut(event: FocusEvent) {
		if (event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)) return;
		// The pencil writing over the canvas (`ScribbleCatch`): the card stays open until it is done.
		if (isScribbleCatch(event.relatedTarget)) return;
		// A press on the style bar or a piece keeps the focus where it was.
		setTimeout(() => {
			if (!done && !wrap.contains(document.activeElement) && !isScribbleCatch(document.activeElement)) commit();
		}, 0);
	}
	/** Handwritten words, at the end of the card's last line, as typing them there would put them. */
	function appendWords(text: string) {
		// The last line with words: the editor keeps an empty paragraph at the foot, which is not where writing goes on.
		const blocks = [...ed.children].filter((one) => (one as HTMLElement).getAttribute("contenteditable") !== "false");
		let end: Node = [...blocks].reverse().find((one) => (one.textContent ?? "").trim() !== "") ?? blocks[0] ?? ed;
		while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
		(end as Element).append(document.createTextNode(text));
		changed();
	}

	onMount(() => {
		document.execCommand("defaultParagraphSeparator", false, "p");
		build(props.value);
		// A block that changes is written from what it now holds; one that does not keeps its source.
		const watch = new MutationObserver((records) => {
			for (const record of records) {
				const top = topOf(record.target === ed ? null : record.target);
				if (top) top.dataset.dirty = "1";
			}
		});
		watch.observe(ed, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-on"] });
		past.push(serialise());
		// A wheel over the toolbar or its menus scrolls them; the canvas, which takes every other wheel
		// for its camera, never hears of it.
		const ownWheel = (event: WheelEvent) => {
			if ((event.target as Element).closest(".pce-menu, .pce-tools")) event.stopPropagation();
		};
		bar.addEventListener("wheel", ownWheel, { passive: true });
		onCleanup(() => bar.removeEventListener("wheel", ownWheel));
		// Watched once a frame: while the card moves on screen, a pan or a zoom, the bar is gone; once it
		// has rested a moment the bar is put back over the words and fades in.
		let placing = 0;
		let seen = "";
		let movedAt = 0;
		const keep = () => {
			const w = wrap.getBoundingClientRect();
			const now = `${Math.round(w.left)},${Math.round(w.top)},${Math.round(w.width)}`;
			if (now !== seen) {
				const first = !seen;
				seen = now;
				if (!first) {
					movedAt = performance.now();
					if (!bar.hasAttribute("data-hidden")) {
						bar.setAttribute("data-hidden", "");
						closeMenus();
					}
				}
			} else if (bar.hasAttribute("data-hidden") && performance.now() - movedAt > 140) {
				placeBar();
				bar.removeAttribute("data-hidden");
			}
			placing = requestAnimationFrame(keep);
		};
		placing = requestAnimationFrame(keep);
		onCleanup(() => cancelAnimationFrame(placing));
		const move = (event: PointerEvent) => onPointerMove(event);
		const up = () => {
			endDrag(false);
			if (selecting) {
				selecting = false;
				showBar();
			}
		};
		const cancel = () => {
			endDrag(true);
			selecting = false;
		};
		// A press in the words starts a selection; the bar waits for the lift (`up`).
		const press = (event: PointerEvent) => {
			if (event.button !== 0 || !ed.contains(event.target as Node)) return;
			selecting = true;
			clearTimeout(settleBar);
			showBar();
		};
		const selection = () => {
			clearTimeout(settleBar);
			if (selecting) return;
			// Up already: it follows the selection. Not up yet: it waits until the selection rests.
			if (!bar.hasAttribute("data-off")) showBar();
			else settleBar = setTimeout(showBar, SELECTION_PAUSE_MS);
		};
		document.addEventListener("pointerdown", press, true);
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
		document.addEventListener("pointercancel", cancel);
		document.addEventListener("selectionchange", selection);
		onCleanup(() => {
			watch.disconnect();
			clearTimeout(settleBar);
			document.removeEventListener("pointerdown", press, true);
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			document.removeEventListener("pointercancel", cancel);
			document.removeEventListener("selectionchange", selection);
			if (frame !== undefined) cancelAnimationFrame(frame);
		});
		requestAnimationFrame(() => {
			ed.focus({ preventScroll: true });
			// A double-click in a gap: a new line there, empty until something is typed in it.
			if (props.insertAt !== undefined) {
				const line = h("p");
				line.append(document.createTextNode(ZW));
				const before = ed.children[Math.max(0, Math.min(props.insertAt, ed.children.length))] ?? null;
				const lone = ed.children.length === 1 && !ed.firstElementChild!.textContent!.replace(/\u200b/g, "").trim() ? (ed.firstElementChild as HTMLElement) : undefined;
				if (lone) caretInto(lone, false);
				else {
					ed.insertBefore(line, before);
					caretInto(line, false);
					const r = sel().getRangeAt(0);
					r.setStart(line.firstChild!, 1);
					r.collapse(true);
				}
				return;
			}
			// A double-click on the words: the caret where it landed.
			const point = props.caretAt;
			const there = point ? (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(point.x, point.y) : null;
			if (there && ed.contains(there.startContainer) && !(there.startContainer.parentElement?.closest("[contenteditable=false]"))) {
				sel().removeAllRanges();
				sel().addRange(there);
				return;
			}
			// The caret at the end of the last block's words, inside it, so typing continues that block.
			let end: Node = ed;
			while (end.lastChild && end.lastChild.nodeType === 1 && (end.lastChild as HTMLElement).getAttribute("contenteditable") !== "false") end = end.lastChild;
			const r = document.createRange();
			r.selectNodeContents(end);
			r.collapse(false);
			sel().removeAllRanges();
			sel().addRange(r);
		});
	});

	return (
		<div
			ref={wrap}
			class={`pen-card-editor ${props.class ?? ""}`}
			style={props.style}
			onKeyDown={onKeyDown}
			onFocusOut={onFocusOut}
			// A press in the card is the card's: not the start of a pan or a tap on the canvas behind it.
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ScribbleCatch target={() => ed} append={appendWords} context={() => (ed?.innerText ?? "").replace(/\s+$/, "")} onEnd={commit} />
			<div
				ref={ed}
				class="pce-body"
				contenteditable="true"
				spellcheck={false}
				onInput={(event) => onInput(event as InputEvent)}
				onPaste={onPaste}
				onClick={onClick}
				onDblClick={onDblClick}
				onPointerDown={onPointerDown}
				onMouseDown={(event) => {
					// A press on a suggestion's buttons or a check must not move the caret into it.
					if ((event.target as Element).closest(".pce-sug button, .pce-check")) event.preventDefault();
				}}
			/>
			<div ref={bar} class="pce-bar" data-off onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={style}>
				<div ref={tools} class="pce-tools" onScroll={closeMenus}>
					{/* Two rows: what the words are set in, and what is done to them. */}
					<div class="pce-row">
						<button type="button" class="pce-pick pce-pick-block" data-menu="block" title="What the block is">
							<span data-label="block">Body text</span>
							<ChevronDown size={16} />
						</button>
						<button type="button" class="pce-pick pce-pick-font" data-menu="font" title="Font">
							<span data-label="font">Inter</span>
							<ChevronDown size={16} />
						</button>
						<button type="button" class="pce-pick pce-pick-size" data-menu="size" title="Size">
							<span data-label="size">Normal</span>
							<ChevronDown size={16} />
						</button>
						<span class="pce-sep" />
						<button type="button" class="pce-icon" data-cmd="undo" title="Undo (⌘Z)"><Undo2 size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="redo" title="Redo (⌘⇧Z)"><Redo2 size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="clear" title="Clear styling"><RemoveFormatting size={18} /></button>
					</div>
					<div class="pce-row">
						<button type="button" class="pce-icon" data-cmd="bold" title="Bold (⌘B)"><Bold size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="italic" title="Italic (⌘I)"><Italic size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="underline" title="Underline (⌘U)"><Underline size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="strikeThrough" title="Strike (⌘⇧X)"><Strikethrough size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="code" title="Code (⌘E)"><Code size={18} /></button>
						<button type="button" class="pce-icon" data-menu="hl" title="Highlight"><Highlighter size={18} /></button>
						<button type="button" class="pce-icon" data-menu="fg" title="Text colour"><Baseline size={18} /></button>
						<button type="button" class="pce-icon" data-cmd="link" title="Link"><Link size={18} /></button>
						<span class="pce-sep" />
						<button type="button" class="pce-icon" data-block-button="ul" title="Bulleted list"><List size={18} /></button>
						<button type="button" class="pce-icon" data-block-button="ol" title="Numbered list"><ListOrdered size={18} /></button>
						<button type="button" class="pce-icon" data-block-button="check" title="Checklist"><ListChecks size={18} /></button>
						<button type="button" class="pce-icon" data-block-button="quote" title="Quote"><TextQuote size={18} /></button>
						<button type="button" class="pce-icon" data-block-button="codeblock" title="Code block"><SquareCode size={18} /></button>
						<span class="pce-sep" />
						<button type="button" class="pce-icon" data-insert="table" title="Table"><Table size={18} /></button>
						<button type="button" class="pce-icon" data-insert="rule" title="Rule"><Minus size={18} /></button>
					</div>
				</div>
				<div class="pce-menu" data-for="block">
					<For each={BLOCK_MENU}>{([kind, name]) => <button type="button" class={`pce-opt pce-opt-${kind}`} data-block={kind}>{name}</button>}</For>
				</div>
				<div class="pce-menu pce-fonts" data-for="font">
					<button type="button" class="pce-opt" data-font="default">Inter <small>the card's own</small></button>
					<For each={FONT_GROUPS}>
						{(group) => (
							<>
								<span class="pce-group">{group.group}</span>
								<For each={group.fonts.filter((font) => font !== "Inter")}>{(font) => <button type="button" class="pce-opt" data-font={font}>{font}</button>}</For>
							</>
						)}
					</For>
				</div>
				<div class="pce-menu" data-for="size">
					<For each={SIZE_MENU}>{([size, name]) => <button type="button" class={`pce-opt pce-size-${size}`} data-size={size}>{name}</button>}</For>
				</div>
				<div class="pce-menu pce-swatches" data-for="hl">
					<For each={SIX}>{(c) => <button type="button" class="pce-sw" data-hl={c} title={`${c} highlight`} />}</For>
					<button type="button" class="pce-opt" data-hl="none">No highlight</button>
				</div>
				<div class="pce-menu pce-swatches" data-for="fg">
					<For each={SIX}>{(c) => <button type="button" class="pce-swatch-fg" data-fg={c} title={`${c} text`}>A</button>}</For>
					<button type="button" class="pce-opt" data-fg="none">No colour</button>
				</div>
			</div>
			<div ref={caret} class="pce-caret" />
			<div ref={line} class="pce-line" />
		</div>
	);
}
