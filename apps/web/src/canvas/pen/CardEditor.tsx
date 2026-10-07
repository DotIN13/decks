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
					// One span per kind, nested, so a style can be taken off one kind without the others.
					const c = t as ColourToken;
					const kinds: Array<[string, string]> = [];
					if (c.colour) kinds.push(["data-fg", c.colour]);
					if (c.size) kinds.push(["data-size", c.size]);
					if (c.face) kinds.push(["data-font", c.face]);
					let into: Node = parent;
					for (const [attr, value] of kinds) into = into.appendChild(h("span", { [attr]: value }));
					inline(into, c.tokens as Token[]);
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
				case "html": {
					// <u>…</u>: underlined words, typed into like any other.
					const close = /^<u>$/i.test(t.raw) ? list.findIndex((x, j) => j > i && /^<\/u>$/i.test(x.raw)) : -1;
					if (close > i) {
						const u = h("u");
						inline(u, list.slice(i + 1, close));
						parent.appendChild(u);
						i = close;
					} else parent.appendChild(atom(t.raw, t.raw));
					break;
				}
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
				// A callout's first line is its type, how it folds, and a title typed into in place.
				const head = /^\[!([a-z-]+)\]([+-]?)[ \t]*([^\n]*)/i.exec(paras[0]?.raw ?? "");
				if (head) {
					const type = head[1]!.toLowerCase();
					el.setAttribute("data-callout", type);
					el.setAttribute("data-mark", `[!${head[1]}]${head[2]}`);
					el.setAttribute("data-tone", CALLOUTS[type] ?? "blue");
					if (head[3]!.trim()) el.setAttribute("data-titled", "");
					const title = head[3]!.trim() || type.charAt(0).toUpperCase() + type.slice(1);
					el.append(h("div", { class: "pce-chead" }, title));
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
			case "table": {
				// Typed into cell by cell; Enter goes down a column, and past the last row adds one.
				const tb = t as Tokens.Table;
				const el = h("table", { class: "pce-table", "data-align": tb.align.map((a) => a ?? "").join(",") });
				const head = el.appendChild(h("thead")).appendChild(h("tr"));
				for (const cell of tb.header) inline(head.appendChild(h("th")), cell.tokens);
				const body = el.appendChild(h("tbody"));
				for (const row of tb.rows) {
					const tr = body.appendChild(h("tr"));
					for (const cell of row) inline(tr.appendChild(h("td")), cell.tokens);
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
			// Spaces at either end go outside the marks: `** bold**` is not bold, in Obsidian or anywhere.
			const wrapIn = (open: string, close = open) => {
				const text = inner();
				if (!text.trim()) return text;
				const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
				return lead + open + core + close + trail;
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
					case "SPAN": {
						// A chain of styled spans, one inside the next, is one span with all their classes.
						const classes = new Map<string, string>();
						let at: HTMLElement = n;
						for (;;) {
							if (at.dataset.fg) classes.set("fg", at.dataset.fg);
							if (at.dataset.size) classes.set("size", at.dataset.size);
							if (at.dataset.font) classes.set("font", at.dataset.font);
							const only = at.childNodes.length === 1 ? at.firstChild : null;
							if (only instanceof HTMLElement && only.tagName === "SPAN" && (only.dataset.fg || only.dataset.size || only.dataset.font)) at = only;
							else break;
						}
						if (!classes.size) {
							s += inner();
							break;
						}
						const text = out(at);
						if (!text.trim()) {
							s += text;
							break;
						}
						const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
						s += `${lead}[${core}]{${[...classes.values()].map((c) => `.${c}`).join(" ")}}${trail}`;
						break;
					}
					case "U":
						s += wrapIn("<u>", "</u>");
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
				// The title is written only when it says something the type does not: Obsidian shows the type's name.
				const chead = el.querySelector(":scope > .pce-chead");
				const type = el.dataset.callout ?? "";
				const title = chead ? out(chead).replace(/\s+/g, " ").trim() : "";
				const named = title && (el.hasAttribute("data-titled") || title !== type.charAt(0).toUpperCase() + type.slice(1));
				const head = el.dataset.mark ? [`> ${el.dataset.mark}${named ? ` ${title}` : ""}`] : [];
				return [...head, ...lines].join("\n") || ">";
			}
			case "TABLE": {
				const rows = [...el.querySelectorAll("tr")];
				const cells = (row: Element) => [...row.children].map((cell) => out(cell).replace(/\n/g, " ").replace(/\|/g, "\\|").trim());
				const header = cells(rows[0] ?? el);
				const align = (el.dataset.align ?? "").split(",");
				const rule = header.map((_, i) => ({ left: ":--", right: "--:", center: ":-:" })[align[i] as "left"] ?? "---");
				return [header, rule, ...rows.slice(1).map(cells)].map((row) => `| ${row.join(" | ")} |`).join("\n");
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
			bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));
			return;
		}
		// The menus say what the words under the caret are now.
		const at = s.anchorNode?.nodeType === 1 ? (s.anchorNode as Element) : s.anchorNode?.parentElement;
		const label = (name: string, text: string) => {
			const el = bar.querySelector(`[data-label="${name}"]`);
			if (el) el.textContent = text;
		};
		label("block", BLOCK_NAMES[blockKind()] ?? "Text");
		label("font", { serif: "Serif", mono: "Mono" }[(at?.closest("span[data-font]") as HTMLElement | null)?.dataset.font ?? ""] ?? "Sans");
		label("size", { small: "Small", large: "Large", huge: "Huge" }[(at?.closest("span[data-size]") as HTMLElement | null)?.dataset.size ?? ""] ?? "Normal");
		const r = s.getRangeAt(0).getBoundingClientRect();
		const w = wrap.getBoundingClientRect();
		const z = props.zoom;
		bar.style.display = "flex";
		bar.style.transform = `scale(${1 / z})`;
		// On the screen whatever the zoom: above the words, or under them when there is no room above.
		const bw = bar.offsetWidth;
		const bh = bar.offsetHeight;
		const left = Math.max(8, Math.min(innerWidth - bw - 8, r.left));
		// Never under the app's own bars along the top of the screen, which sit over the canvas.
		const ceiling = Math.max(8, ...[...document.querySelectorAll('[data-inset="top"]')].map((el) => el.getBoundingClientRect().bottom + 6));
		const top = r.top - bh - 8 >= ceiling ? r.top - bh - 8 : r.bottom + 8;
		bar.style.left = `${(left - w.left) / z}px`;
		bar.style.top = `${(top - w.top) / z}px`;
	}
	const unwrap = (n: Element) => n.replaceWith(...n.childNodes);
	/*
	 * A style over a selection, or taken off it: bold, italic, struck, code, a highlight, a colour.
	 *
	 * The browser cuts the selection into runs (`cut`): its highlight command splits a selection that
	 * runs over several blocks, a heading and the paragraph under it, into one run per block, where
	 * wrapping the range in one element put a heading inside a highlight. Each run is marked with a
	 * colour no one would pick and then given the card's own element, so the browser's own bold, which
	 * takes a heading for bold already and unbolds it, is never asked.
	 */
	const STYLES = {
		bold: { selector: "strong, b", make: () => h("strong"), toggles: true },
		italic: { selector: "em, i", make: () => h("em"), toggles: true },
		strike: { selector: "s, strike, del", make: () => h("s"), toggles: true },
		code: { selector: "code", make: () => h("code"), toggles: true },
		hl: { selector: "mark", make: (v: string) => h("mark", v === "default" ? {} : { "data-c": v }), toggles: false },
		fg: { selector: "span[data-fg]", make: (v: string) => h("span", { "data-fg": v }), toggles: false },
		underline: { selector: "u", make: () => h("u"), toggles: true },
		size: { selector: "span[data-size]", make: (v: string) => h("span", { "data-size": v }), toggles: false },
		font: { selector: "span[data-font]", make: (v: string) => h("span", { "data-font": v }), toggles: false },
		link: { selector: "a[data-href]", make: (v: string) => h("a", { "data-href": v }), toggles: false },
	};
	type Style = keyof typeof STYLES;
	const CUT = "rgb(1, 2, 3)";
	const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|TD|TH|PRE|UL|OL)$/;
	/** Take `inner` out of `outer`, splitting `outer` round it: what was before and after it keeps `outer`. */
	function splitAround(inner: Node, outer: HTMLElement) {
		const before = document.createRange();
		before.setStart(outer, 0);
		before.setEndBefore(inner);
		const after = document.createRange();
		after.setStartAfter(inner);
		after.setEnd(outer, outer.childNodes.length);
		const head = before.extractContents();
		const tail = after.extractContents();
		if (head.textContent) {
			const piece = outer.cloneNode(false) as HTMLElement;
			piece.append(head);
			outer.before(piece);
		}
		if (tail.textContent) {
			const piece = outer.cloneNode(false) as HTMLElement;
			piece.append(tail);
			outer.after(piece);
		}
		unwrap(outer);
	}
	/** The selection as runs: plain spans, none of them across a block's edge. */
	function cut(): HTMLElement[] {
		document.execCommand("styleWithCSS", false, "true");
		document.execCommand("hiliteColor", false, CUT);
		document.execCommand("styleWithCSS", false, "false");
		return ([...ed.querySelectorAll("*")] as HTMLElement[])
			.filter((el) => el.style.backgroundColor === CUT)
			.map((el) => {
				el.style.removeProperty("background-color");
				if (!el.getAttribute("style")) el.removeAttribute("style");
				// The colour landed on a block, or on one of the card's own elements: the run is inside it.
				if (el.tagName === "SPAN" && !el.attributes.length) return el;
				const run = document.createElement("span");
				run.append(...el.childNodes);
				el.append(run);
				return run;
			})
			.filter((run) => run.textContent);
	}
	function restyle(styles: Style[], value: string | null) {
		const runs = cut();
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
		// A menu's own button opens it, or closes it again; one menu at a time.
		if (d.menu) {
			const open = bar.querySelector(`.pce-menu[data-for="${d.menu}"]`);
			const was = open?.hasAttribute("data-open");
			bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));
			if (!was) open?.setAttribute("data-open", "");
			return;
		}
		bar.querySelectorAll(".pce-menu").forEach((m) => m.removeAttribute("data-open"));
		const commands: Record<string, Style> = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strike", code: "code" };
		if (d.block) setBlock(d.block);
		else if (d.hl) restyle(["hl"], d.hl === "none" ? null : d.hl);
		else if (d.fg) restyle(["fg"], d.fg === "none" ? null : d.fg);
		else if (d.size) restyle(["size"], d.size === "normal" ? null : d.size);
		else if (d.font) restyle(["font"], d.font === "sans" ? null : d.font);
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
		// ⌘B, ⌘I and ⌘⇧X go through the card's own styles, as the style bar's buttons do.
		const mod = event.metaKey || event.ctrlKey;
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
		<div
			ref={wrap}
			class={`pen-card-editor ${props.class ?? ""}`}
			style={props.style}
			onKeyDown={onKeyDown}
			onFocusOut={onFocusOut}
			// A press in the card is the card's: not the start of a pan or a tap on the canvas behind it.
			onPointerDown={(event) => event.stopPropagation()}
		>
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
			<div ref={bar} class="pce-bar" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={style}>
				<span class="pce-drop">
					<button type="button" class="pce-pick" data-menu="block" title="What the block is" data-label="block">Text</button>
					<span class="pce-menu" data-for="block">
						{Object.entries({ p: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", quote: "Quote", code: "Code", ul: "Bullets", ol: "Numbers", check: "Checklist" }).map(([kind, name]) => (
							<button type="button" data-block={kind} class={`pce-opt pce-opt-${kind}`}>{name}</button>
						))}
					</span>
				</span>
				<span class="pce-drop">
					<button type="button" class="pce-pick" data-menu="font" title="Font" data-label="font">Sans</button>
					<span class="pce-menu" data-for="font">
						<button type="button" data-font="sans" class="pce-opt" style={{ "font-family": "var(--font-sans, system-ui)" }}>Sans</button>
						<button type="button" data-font="serif" class="pce-opt" style={{ "font-family": "var(--card-serif, Georgia, serif)" }}>Serif</button>
						<button type="button" data-font="mono" class="pce-opt" style={{ "font-family": "var(--font-mono)" }}>Mono</button>
					</span>
				</span>
				<span class="pce-drop">
					<button type="button" class="pce-pick" data-menu="size" title="Size" data-label="size">Normal</button>
					<span class="pce-menu" data-for="size">
						<button type="button" data-size="small" class="pce-opt" style={{ "font-size": "12px" }}>Small</button>
						<button type="button" data-size="normal" class="pce-opt">Normal</button>
						<button type="button" data-size="large" class="pce-opt" style={{ "font-size": "17px" }}>Large</button>
						<button type="button" data-size="huge" class="pce-opt" style={{ "font-size": "21px" }}>Huge</button>
					</span>
				</span>
				<span class="pce-sep" />
				<button type="button" data-cmd="bold" title="Bold (⌘B)"><b>B</b></button>
				<button type="button" data-cmd="italic" title="Italic (⌘I)"><i>I</i></button>
				<button type="button" data-cmd="underline" title="Underline (⌘U)"><u>U</u></button>
				<button type="button" data-cmd="strikeThrough" title="Strike (⌘⇧X)"><s>S</s></button>
				<button type="button" data-cmd="code" title="Code (⌘E)" class="pce-mono">{"</>"}</button>
				<button type="button" data-cmd="link" title="Link">🔗</button>
				<span class="pce-sep" />
				<span class="pce-drop">
					<button type="button" class="pce-pick pce-hl" data-menu="hl" title="Highlight">
						<span class="pce-hl-mark">ab</span>
					</button>
					<span class="pce-menu pce-swatches" data-for="hl">
						{(["yellow", "orange", "red", "green", "blue", "purple"] as const).map((c) => <button type="button" class="pce-sw" data-hl={c} title={`${c} highlight`} />)}
						<button type="button" class="pce-opt" data-hl="none">No highlight</button>
					</span>
				</span>
				<span class="pce-drop">
					<button type="button" class="pce-pick pce-fgpick" data-menu="fg" title="Text colour">A</button>
					<span class="pce-menu pce-swatches" data-for="fg">
						{(["red", "orange", "yellow", "green", "blue", "purple"] as const).map((c) => <button type="button" class="pce-fg" data-fg={c} title={`${c} text`}>A</button>)}
						<button type="button" class="pce-opt" data-fg="none">No colour</button>
					</span>
				</span>
				<button type="button" data-cmd="clear" title="Clear styling">⌫</button>
			</div>
			<div ref={caret} class="pce-caret" />
			<div ref={line} class="pce-line" />
		</div>
	);
}
