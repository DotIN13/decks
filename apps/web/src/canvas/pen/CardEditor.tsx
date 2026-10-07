import { onCleanup, onMount, type JSX } from "solid-js";
import type { Token, Tokens } from "marked";
import { CALLOUTS, cardMarked, EMOJI_OF, sizedAlt, type Colour, type ColourToken, type CriticToken, type HighlightToken, type WikiToken } from "./card-syntax.ts";

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

export interface CardEditorProps {
	value: string;
	/** Where the deck's files are, for the card's pictures. */
	base: string;
	/** Items in the card the editor keeps but cannot type into, by id: what to call each (`card-frame.ts`). */
	held?: Record<string, string>;
	/** The camera's zoom: the editor is drawn in the stage's units, its style bar in the screen's. */
	zoom: number;
	class?: string;
	style: JSX.CSSProperties;
	onInput(markdown: string): void;
	onCommit(markdown: string): void;
	onCancel(): void;
}

const ZW = "​";
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (text !== undefined) el.textContent = text;
	return el;
};
/** Something kept as its markdown: shown, never typed into, written back as it came. */
const atom = (raw: string, shown: string, cls = "pce-atom", tag: "span" | "div" = "span") => {
	const el = h(tag, { class: cls, contenteditable: "false", "data-raw": raw }, shown);
	return el;
};

export function CardEditor(props: CardEditorProps) {
	let wrap!: HTMLDivElement;
	let ed!: HTMLDivElement;
	let bar!: HTMLDivElement;
	let caret!: HTMLDivElement;
	let line!: HTMLDivElement;
	/** Whitespace before the first block, kept as it was. */
	let lead = "";
	let trail = "";
	let done = false;
	const url = (src: string) => {
		try {
			return new URL(src, new URL(props.base || "/", location.origin)).href;
		} catch {
			return src;
		}
	};

	/* ---------- markdown in ---------- */

	function piece(kind: "img" | "file" | "wiki", raw: string, label: string, src?: string, width?: number, block = false): HTMLElement {
		const el = h(block ? "div" : "span", { class: `pce-piece${block ? " pce-block" : ""}`, "data-kind": kind, contenteditable: "false", "data-raw": raw });
		if (kind === "img") {
			const img = h("img", { src: url(src ?? ""), alt: label, draggable: "false" });
			img.onerror = () => img.remove();
			el.append(img, h("span", {}, label));
			if (width) el.style.width = `${width}px`;
		} else el.append(h("span", { class: "pce-ic" }, kind === "file" ? "📄" : "🔗"), document.createTextNode(label));
		return el;
	}

	function inline(parent: Node, tokens: readonly Token[] | undefined) {
		const list = tokens ?? [];
		for (let i = 0; i < list.length; i++) {
			const t = list[i]!;
			switch (t.type) {
				case "text": {
					const tt = t as Tokens.Text;
					if (tt.tokens?.length) inline(parent, tt.tokens);
					else parent.appendChild(document.createTextNode(tt.raw));
					break;
				}
				case "strong":
				case "em":
				case "del": {
					const el = h(t.type === "strong" ? "strong" : t.type === "em" ? "em" : "s");
					inline(el, (t as Tokens.Strong).tokens);
					parent.appendChild(el);
					break;
				}
				case "codespan": {
					const c = t as Tokens.Codespan;
					if (c.raw === "`" + c.text + "`") parent.appendChild(h("code", {}, c.text));
					else parent.appendChild(atom(c.raw, c.text, "pce-atom pce-codeatom"));
					break;
				}
				case "link": {
					const l = t as Tokens.Link;
					if (!l.raw.startsWith("[") || l.title) {
						parent.appendChild(atom(l.raw, l.text, "pce-atom pce-linkatom"));
						break;
					}
					const a = h("a", { "data-href": l.href });
					inline(a, l.tokens);
					parent.appendChild(a);
					break;
				}
				case "image": {
					const im = t as Tokens.Image;
					const { alt } = sizedAlt(im.text);
					parent.appendChild(piece("img", im.raw, alt || "image", im.href));
					break;
				}
				case "br":
					parent.appendChild(h("br"));
					break;
				case "highlight": {
					const m = t as HighlightToken;
					const el = h("mark", m.colour ? { "data-c": m.colour } : {});
					inline(el, m.tokens as Token[]);
					parent.appendChild(el);
					break;
				}
				case "colour": {
					const c = t as ColourToken;
					const el = h("span", { "data-fg": c.colour });
					inline(el, c.tokens as Token[]);
					parent.appendChild(el);
					break;
				}
				case "wiki": {
					const w = t as WikiToken;
					parent.appendChild(piece(w.embed ? "file" : "wiki", w.raw, w.alias ?? w.target));
					break;
				}
				case "critic": {
					const c = t as CriticToken;
					if (c.op === "comment") parent.appendChild(atom(c.raw, `💬 ${c.new}`, "pce-atom pce-faint"));
					else if (c.op === "highlight") parent.appendChild(atom(c.raw, c.old, "pce-atom pce-markatom"));
					else {
						// A suggestion, with the reason that follows it, if one does.
						const next = list[i + 1] as CriticToken | undefined;
						const reason = next?.type === "critic" && next.op === "comment" ? next : undefined;
						if (reason) i++;
						parent.appendChild(suggestion(c.raw + (reason?.raw ?? ""), c.old, c.new, reason?.new));
					}
					break;
				}
				case "hidden":
					parent.appendChild(atom(t.raw, t.raw, "pce-atom pce-faint"));
					break;
				default:
					parent.appendChild(atom(t.raw, "text" in t && typeof t.text === "string" ? t.text : t.raw));
			}
		}
	}

	function suggestion(raw: string, old: string, now: string, reason?: string): HTMLElement {
		const el = h("span", { class: "pce-sug", contenteditable: "false", "data-raw": raw, ...(reason ? { title: reason } : {}) });
		if (old) el.append(h("del", {}, old));
		if (now) el.append(h("ins", {}, now));
		if (reason) el.append(h("span", { class: "pce-why" }, "💬"));
		el.append(h("button", { type: "button", "data-accept": "", title: "Accept" }, "✓"), h("button", { type: "button", "data-reject": "", title: "Reject" }, "✕"));
		return el;
	}

	function list(t: Tokens.List): HTMLElement {
		const el = h(t.ordered ? "ol" : "ul", { ...(t.ordered && t.start !== 1 && t.start !== "" ? { start: String(t.start) } : {}), ...(t.loose ? { "data-loose": "" } : {}) });
		for (const item of t.items) {
			const li = h("li");
			if (item.task) li.append(h("span", { class: "pce-check", contenteditable: "false", ...(item.checked ? { "data-on": "" } : {}) }));
			for (const sub of item.tokens) {
				if (sub.type === "checkbox") continue;
				if (sub.type === "text") inline(li, (sub as Tokens.Text).tokens ?? [{ type: "text", raw: sub.raw, text: sub.raw } as Tokens.Text]);
				else if (sub.type === "paragraph") {
					const p = h("p");
					inline(p, (sub as Tokens.Paragraph).tokens);
					li.append(p);
				} else if (sub.type === "list") li.append(list(sub as Tokens.List));
				else if (sub.type !== "space") li.append(atom(sub.raw.replace(/\n+$/, ""), sub.raw.replace(/\n+$/, ""), "pce-atom pce-raw", "div"));
			}
			el.append(li);
		}
		return el;
	}

	function block(t: Token): HTMLElement {
		const raw = t.raw.replace(/\n+$/, "");
		switch (t.type) {
			case "heading": {
				const el = h(`h${Math.min(6, (t as Tokens.Heading).depth)}` as "h1");
				inline(el, (t as Tokens.Heading).tokens);
				return el;
			}
			case "paragraph": {
				const p = t as Tokens.Paragraph;
				const real = (p.tokens ?? []).filter((x) => !(x.type === "text" && !x.raw.trim()));
				if (real.length === 1 && real[0]!.type === "image") {
					const im = real[0] as Tokens.Image;
					const { alt, width } = sizedAlt(im.text);
					return piece("img", raw, alt || "image", im.href, width, true);
				}
				if (real.length === 1 && real[0]!.type === "wiki" && (real[0] as WikiToken).embed) {
					const w = real[0] as WikiToken;
					const pic = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(w.target);
					return pic ? piece("img", raw, w.alias ?? w.target, w.target, w.width, true) : piece("file", raw, w.target, undefined, undefined, true);
				}
				const el = h("p");
				inline(el, p.tokens);
				return el;
			}
			case "list":
				return list(t as Tokens.List);
			case "blockquote": {
				const q = t as Tokens.Blockquote;
				if (!q.tokens.every((x) => x.type === "paragraph" || x.type === "space")) break;
				const el = h("blockquote");
				const paras = q.tokens.filter((x) => x.type === "paragraph") as Tokens.Paragraph[];
				// A callout's first line, [!type] and its title, is its header: kept as written.
				const head = /^\[![a-z-]+\][+-]?[^\n]*/i.exec(paras[0]?.raw ?? "");
				if (head) {
					el.setAttribute("data-head", head[0]);
					const type = /^\[!([a-z-]+)\]/i.exec(head[0])![1]!.toLowerCase();
					el.setAttribute("data-callout", type);
					el.setAttribute("data-tone", CALLOUTS[type] ?? "blue");
					const title = head[0].replace(/^\[![a-z-]+\][+-]?\s*/i, "") || type.charAt(0).toUpperCase() + type.slice(1);
					el.append(h("div", { class: "pce-chead", contenteditable: "false" }, title));
					const rest = paras[0]!.raw.slice(head[0].length).replace(/^\n/, "");
					paras[0] = rest.trim() ? (cardMarked().lexer(rest)[0] as Tokens.Paragraph) : (undefined as unknown as Tokens.Paragraph);
				}
				for (const p of paras) {
					if (!p) continue;
					const el2 = h("p");
					inline(el2, p.tokens);
					el.append(el2);
				}
				return el;
			}
			case "code": {
				const c = t as Tokens.Code;
				if (!/^```/.test(c.raw)) break;
				return h("pre", { class: "pce-code", "data-lang": c.lang ?? "" }, c.text);
			}
			case "hr":
				return atom(raw, "", "pce-atom pce-rule", "div");
			case "html": {
				// An item of the card that is not words (a sticky note, a shape): kept in its place.
				const held = /^<!--decks:item (\S+)-->$/.exec(raw);
				if (held) return atom(raw, `▢ ${props.held?.[held[1]!] ?? "item"}`, "pce-atom pce-held", "div");
				break;
			}
		}
		return atom(raw, raw, "pce-atom pce-raw", "div");
	}

	function build(md: string) {
		ed.textContent = "";
		const tokens = cardMarked().lexer(md);
		lead = /^\s*/.exec(md)![0];
		trail = /\n*$/.exec(md)![0];
		let last: HTMLElement | undefined;
		for (const t of tokens) {
			if (t.type === "space") {
				if (last) last.dataset.sep = (last.dataset.sep ?? "") + t.raw;
				continue;
			}
			const el = block(t);
			el.dataset.raw ??= t.raw.replace(/\n+$/, "");
			el.dataset.sep = /\n*$/.exec(t.raw)![0];
			ed.append(el);
			last = el;
		}
		if (!ed.firstChild) ed.append(h("p"));
	}

	/* ---------- markdown out ---------- */

	function out(node: Node): string {
		let s = "";
		for (const n of node.childNodes) {
			if (n.nodeType === 3) {
				s += (n.textContent ?? "").replace(/​/g, "");
				continue;
			}
			if (!(n instanceof HTMLElement)) continue;
			const inner = () => out(n);
			const wrapIn = (open: string, close = open) => {
				const text = inner();
				return text.trim() ? open + text + close : text;
			};
			if (n.dataset.raw !== undefined && n.getAttribute("contenteditable") === "false") s += n.dataset.raw;
			else
				switch (n.tagName) {
					case "STRONG":
					case "B":
						s += wrapIn("**");
						break;
					case "EM":
					case "I":
						s += wrapIn("*");
						break;
					case "S":
					case "DEL":
					case "STRIKE":
						s += wrapIn("~~");
						break;
					case "CODE":
						s += wrapIn("`");
						break;
					case "MARK":
						s += wrapIn(`==${n.dataset.c ? EMOJI_OF[n.dataset.c as Colour] : ""}`, "==");
						break;
					case "A":
						s += `[${inner()}](${n.dataset.href ?? ""})`;
						break;
					case "BR":
						s += "  \n";
						break;
					case "SPAN":
						s += n.dataset.fg ? wrapIn("[", `]{.${n.dataset.fg}}`) : inner();
						break;
					default:
						s += inner();
				}
		}
		return s;
	}

	function outList(el: HTMLElement, indent: string): string {
		const ordered = el.tagName === "OL";
		const start = Number(el.getAttribute("start") ?? 1);
		const items = [...el.children].filter((c) => c.tagName === "LI") as HTMLElement[];
		return items
			.map((li, i) => {
				const check = li.querySelector(":scope > .pce-check");
				const marker = ordered ? `${start + i}. ` : "- ";
				const pad = indent + " ".repeat(marker.length);
				const parts: string[] = [];
				let run = "";
				for (const n of li.childNodes) {
					if (n instanceof HTMLElement && (n.tagName === "UL" || n.tagName === "OL")) {
						if (run) parts.push(run), (run = "");
						parts.push(outList(n, pad).replace(/^ +/, ""));
					} else if (n instanceof HTMLElement && (n.tagName === "P" || n.tagName === "DIV") && !n.classList.contains("pce-atom")) {
						if (run) parts.push(run), (run = "");
						parts.push(out(n));
					} else if (n instanceof HTMLElement && n.classList.contains("pce-check")) continue;
					else if (n instanceof HTMLElement && n.classList.contains("pce-raw")) {
						if (run) parts.push(run), (run = "");
						parts.push(n.dataset.raw ?? "");
					} else run += out(wrapNode(n));
				}
				if (run || !parts.length) parts.push(run);
				const body = parts.map((part, k) => (k === 0 ? part.trim() : part)).join(el.hasAttribute("data-loose") ? "\n\n" : "\n").replace(/\n/g, `\n${pad}`).replace(/\n +\n/g, "\n\n");
				return indent + marker + (check ? (check.hasAttribute("data-on") ? "[x] " : "[ ] ") : "") + body;
			})
			.join(el.hasAttribute("data-loose") ? "\n\n" : "\n");
	}
	/** One node, as the child of something, so `out` can be asked about it alone. */
	const wrapNode = (n: Node) => {
		const holder = document.createElement("span");
		holder.append(n.cloneNode(true));
		return holder;
	};

	function outBlock(el: HTMLElement): string {
		switch (el.tagName) {
			case "H1":
			case "H2":
			case "H3":
			case "H4":
			case "H5":
			case "H6":
				return `${"#".repeat(Number(el.tagName[1]))} ${out(el).trim()}`;
			case "UL":
			case "OL":
				return outList(el, "");
			case "BLOCKQUOTE": {
				const body = [...el.children].filter((c) => !c.classList.contains("pce-chead")).map((c) => outBlock(c as HTMLElement)).join("\n\n");
				const lines = body ? body.split("\n").map((l) => (l ? `> ${l}` : ">")) : [];
				return [...(el.dataset.head ? [`> ${el.dataset.head}`] : []), ...lines].join("\n") || ">";
			}
			case "PRE":
				return "```" + (el.dataset.lang ?? "") + "\n" + (el.textContent ?? "").replace(/\n$/, "") + "\n```";
			default:
				if (el.classList.contains("pce-rawedit")) return el.textContent ?? "";
				if (el.dataset.raw !== undefined && el.getAttribute("contenteditable") === "false") return el.dataset.raw;
				return out(el);
		}
	}

	function serialise(): string {
		let s = lead;
		const kids = [...ed.childNodes];
		kids.forEach((n, i) => {
			let el: HTMLElement;
			if (n instanceof HTMLElement) el = n;
			else if (n.nodeType === 3 && n.textContent?.replace(/​/g, "").trim()) el = Object.assign(h("p"), { textContent: n.textContent });
			else return;
			const text = el.dataset.raw !== undefined && !el.dataset.dirty ? el.dataset.raw : outBlock(el);
			if (!text.trim() && el.tagName === "P") return;
			s += text + (i < kids.length - 1 ? el.dataset.sep || "\n\n" : "");
		});
		return s.replace(/\s+$/, "") + trail;
	}

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
	function changed() {
		frame ??= requestAnimationFrame(() => {
			frame = undefined;
			if (!done) props.onInput(serialise());
		});
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
			inline(holder, first?.tokens ?? [{ type: "text", raw: text, text } as Tokens.Text]);
			const nodes = [...holder.childNodes];
			for (const n of nodes.reverse()) r.insertNode(n);
		}
		changed();
	}

	/* ---------- the style bar ---------- */

	function showBar() {
		const s = sel();
		if (dragging || !s.rangeCount || s.isCollapsed || !ed.contains(s.anchorNode)) {
			bar.style.display = "none";
			return;
		}
		const r = s.getRangeAt(0).getBoundingClientRect();
		const w = wrap.getBoundingClientRect();
		const z = props.zoom;
		bar.style.display = "flex";
		bar.style.transform = `scale(${1 / z})`;
		bar.style.left = `${(r.left - w.left) / z}px`;
		bar.style.top = `${(r.top - w.top) / z - (bar.offsetHeight + 8) / z}px`;
	}
	const unwrap = (n: Element) => n.replaceWith(...n.childNodes);
	function wrapSelection(el: HTMLElement, strip: string) {
		const r = sel().getRangeAt(0);
		el.append(r.extractContents());
		el.querySelectorAll(strip).forEach(unwrap);
		r.insertNode(el);
		const nr = document.createRange();
		nr.selectNodeContents(el);
		sel().removeAllRanges();
		sel().addRange(nr);
	}
	function style(event: MouseEvent) {
		const b = (event.target as Element).closest("button");
		if (!b) return;
		document.execCommand("styleWithCSS", false, "false");
		const d = b.dataset;
		if (d.hl) wrapSelection(h("mark", d.hl === "default" ? {} : { "data-c": d.hl }), "mark");
		else if (d.fg) wrapSelection(h("span", { "data-fg": d.fg }), "span[data-fg]");
		else if (d.cmd === "code") wrapSelection(h("code"), "code");
		else if (d.cmd === "clear") {
			const r = sel().getRangeAt(0);
			document.execCommand("removeFormat");
			[...ed.querySelectorAll("mark, span[data-fg], code")].filter((n) => r.intersectsNode(n)).forEach(unwrap);
		} else if (d.cmd) document.execCommand(d.cmd);
		changed();
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
		box.focus();
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
			bar.style.display = "none";
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

	/* ---------- in and out ---------- */

	function commit() {
		if (done) return;
		done = true;
		props.onCommit(serialise());
	}
	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			if (dragging) return endDrag(true);
			done = true;
			props.onCancel();
		} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			commit();
		}
	}
	function onFocusOut(event: FocusEvent) {
		if (event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)) return;
		// A press on the style bar or a piece keeps the focus where it was.
		setTimeout(() => {
			if (!done && !wrap.contains(document.activeElement)) commit();
		}, 0);
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
		const move = (event: PointerEvent) => onPointerMove(event);
		const up = () => endDrag(false);
		const cancel = () => endDrag(true);
		const selection = () => showBar();
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
		document.addEventListener("pointercancel", cancel);
		document.addEventListener("selectionchange", selection);
		onCleanup(() => {
			watch.disconnect();
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			document.removeEventListener("pointercancel", cancel);
			document.removeEventListener("selectionchange", selection);
			if (frame !== undefined) cancelAnimationFrame(frame);
		});
		requestAnimationFrame(() => {
			ed.focus();
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
		<div ref={wrap} class={`pen-card-editor ${props.class ?? ""}`} style={props.style} onKeyDown={onKeyDown} onFocusOut={onFocusOut}>
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
			<div ref={bar} class="pce-bar" onMouseDown={(event) => event.preventDefault()} onClick={style}>
				<button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
				<button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
				<button type="button" data-cmd="strikeThrough" title="Strike"><s>S</s></button>
				<button type="button" data-cmd="code" title="Code" class="pce-mono">{"</>"}</button>
				<span class="pce-sep" />
				{(["yellow", "green", "blue"] as const).map((c) => <button type="button" class="pce-sw" data-hl={c} title={`${c} highlight`} />)}
				<span class="pce-sep" />
				{(["red", "blue"] as const).map((c) => <button type="button" class="pce-fg" data-fg={c} title={`${c} text`}>A</button>)}
				<button type="button" data-cmd="clear" title="Clear styling">⌫</button>
			</div>
			<div ref={caret} class="pce-caret" />
			<div ref={line} class="pce-line" />
		</div>
	);
}
