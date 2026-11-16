import type { Token, Tokens } from "marked";
import { pageFont } from "../look/look.ts";
import { CALLOUTS, cardMarked, EMOJI_OF, FACE_ALIAS, sizedAlt, type Colour, type ColourToken, type CriticToken, type HighlightToken, type WikiToken } from "../model/card-syntax.ts";

/**
 * The card editor's two translations (`CardEditor.tsx`): a card's markdown read into the elements a
 * person types into, and those elements written back as markdown (`card-syntax.ts` is the syntax).
 *
 * A card can hold more than the editor can show as it reads: raw HTML, a link definition. Those stay
 * as their markdown in a grey box (an atom), written back as they came. And each top-level block
 * keeps its source until something in it changes, so an edit to one line never rewrites the rest.
 */

/** What reading a card needs of the editor: where its pictures are, and what to call an item it holds but cannot type into. */
export interface WordsHost {
	url(src: string): string;
	held(id: string): string | undefined;
}

/** A zero-width space: what an empty line holds so the caret has somewhere to be. */
export const ZW = "​";
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (text !== undefined) el.textContent = text;
	return el;
};
/** Something kept as its markdown: shown, never typed into, written back as it came. */
export const atom = (raw: string, shown: string, cls = "pce-atom", tag: "span" | "div" = "span") => {
	const el = h(tag, { class: cls, contenteditable: "false", "data-raw": raw }, shown);
	return el;
};

/** Words in a font of their own: the family in the file, and the page's copy of it on screen. */
export const fontSpan = (family: string) => {
	const el = h("span", { "data-font": family });
	el.style.fontFamily = pageFont(family, 400, false);
	pageFont(family, 700, false);
	return el;
};

/* ---------- markdown in ---------- */

function piece(host: WordsHost, kind: "img" | "file" | "wiki", raw: string, label: string, src?: string, width?: number, block = false): HTMLElement {
	const el = h(block ? "div" : "span", { class: `pce-piece${block ? " pce-block" : ""}`, "data-kind": kind, contenteditable: "false", "data-raw": raw });
	if (kind === "img") {
		const img = h("img", { src: host.url(src ?? ""), alt: label, draggable: "false" });
		img.onerror = () => img.remove();
		el.append(img, h("span", {}, label));
		if (width) el.style.width = `${width}px`;
	} else el.append(h("span", { class: "pce-ic" }, kind === "file" ? "📄" : "🔗"), document.createTextNode(label));
	return el;
}

/** A line's tokens, as the elements typed into: styled words, links, pieces, and what is kept as its markdown. */
export function inline(host: WordsHost, parent: Node, tokens: readonly Token[] | undefined) {
	const list = tokens ?? [];
	for (let i = 0; i < list.length; i++) {
		const t = list[i]!;
		switch (t.type) {
			case "text": {
				const tt = t as Tokens.Text;
				if (tt.tokens?.length) inline(host, parent, tt.tokens);
				else parent.appendChild(document.createTextNode(tt.raw));
				break;
			}
			case "strong":
			case "em":
			case "del": {
				const el = h(t.type === "strong" ? "strong" : t.type === "em" ? "em" : "s");
				inline(host, el, (t as Tokens.Strong).tokens);
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
				inline(host, a, l.tokens);
				parent.appendChild(a);
				break;
			}
			case "image": {
				const im = t as Tokens.Image;
				const { alt } = sizedAlt(im.text);
				parent.appendChild(piece(host, "img", im.raw, alt || "image", im.href));
				break;
			}
			case "br":
				parent.appendChild(h("br"));
				break;
			case "highlight": {
				const m = t as HighlightToken;
				const el = h("mark", m.colour ? { "data-c": m.colour } : {});
				inline(host, el, m.tokens as Token[]);
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
				for (const [attr, value] of kinds) into = into.appendChild(attr === "data-font" ? fontSpan(value) : h("span", { [attr]: value }));
				inline(host, into, c.tokens as Token[]);
				break;
			}
			case "wiki": {
				const w = t as WikiToken;
				parent.appendChild(piece(host, w.embed ? "file" : "wiki", w.raw, w.alias ?? w.target));
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
					inline(host, u, list.slice(i + 1, close));
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

function list(host: WordsHost, t: Tokens.List): HTMLElement {
	const el = h(t.ordered ? "ol" : "ul", { ...(t.ordered && t.start !== 1 && t.start !== "" ? { start: String(t.start) } : {}), ...(t.loose ? { "data-loose": "" } : {}) });
	for (const item of t.items) {
		const li = h("li");
		if (item.task) li.append(h("span", { class: "pce-check", contenteditable: "false", ...(item.checked ? { "data-on": "" } : {}) }));
		for (const sub of item.tokens) {
			if (sub.type === "checkbox") continue;
			if (sub.type === "text") inline(host, li, (sub as Tokens.Text).tokens ?? [{ type: "text", raw: sub.raw, text: sub.raw } as Tokens.Text]);
			else if (sub.type === "paragraph") {
				const p = h("p");
				inline(host, p, (sub as Tokens.Paragraph).tokens);
				li.append(p);
			} else if (sub.type === "list") li.append(list(host, sub as Tokens.List));
			else if (sub.type !== "space") li.append(atom(sub.raw.replace(/\n+$/, ""), sub.raw.replace(/\n+$/, ""), "pce-atom pce-raw", "div"));
		}
		el.append(li);
	}
	return el;
}

/** One top-level block of the card, as its element. */
function block(host: WordsHost, t: Token): HTMLElement {
	const raw = t.raw.replace(/\n+$/, "");
	switch (t.type) {
		case "heading": {
			const el = h(`h${Math.min(6, (t as Tokens.Heading).depth)}` as "h1");
			inline(host, el, (t as Tokens.Heading).tokens);
			return el;
		}
		case "paragraph": {
			const p = t as Tokens.Paragraph;
			const real = (p.tokens ?? []).filter((x) => !(x.type === "text" && !x.raw.trim()));
			if (real.length === 1 && real[0]!.type === "image") {
				const im = real[0] as Tokens.Image;
				const { alt, width } = sizedAlt(im.text);
				return piece(host, "img", raw, alt || "image", im.href, width, true);
			}
			if (real.length === 1 && real[0]!.type === "wiki" && (real[0] as WikiToken).embed) {
				const w = real[0] as WikiToken;
				const pic = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(w.target);
				return pic ? piece(host, "img", raw, w.alias ?? w.target, w.target, w.width, true) : piece(host, "file", raw, w.target, undefined, undefined, true);
			}
			const el = h("p");
			inline(host, el, p.tokens);
			return el;
		}
		case "list":
			return list(host, t as Tokens.List);
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
				inline(host, el2, p.tokens);
				el.append(el2);
			}
			return el;
		}
		case "table": {
			// Typed into cell by cell; Enter goes down a column, and past the last row adds one.
			const tb = t as Tokens.Table;
			const el = h("table", { class: "pce-table", "data-align": tb.align.map((a) => a ?? "").join(",") });
			const head = el.appendChild(h("thead")).appendChild(h("tr"));
			for (const cell of tb.header) inline(host, head.appendChild(h("th")), cell.tokens);
			const body = el.appendChild(h("tbody"));
			for (const row of tb.rows) {
				const tr = body.appendChild(h("tr"));
				for (const cell of row) inline(host, tr.appendChild(h("td")), cell.tokens);
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
			if (held) return atom(raw, `▢ ${host.held(held[1]!) ?? "item"}`, "pce-atom pce-held", "div");
			break;
		}
	}
	return atom(raw, raw, "pce-atom pce-raw", "div");
}

/**
 * A card's markdown read into the editor: one element per top-level block, each keeping its source
 * (`data-raw`) and the blank lines after it (`data-sep`). Answers the whitespace before the first
 * block and after the last, which is written back as it was.
 */
export function readCard(host: WordsHost, ed: HTMLElement, md: string): { lead: string; trail: string } {
	ed.textContent = "";
	const tokens = cardMarked().lexer(md);
	const lead = /^\s*/.exec(md)![0];
	const trail = /\n*$/.exec(md)![0];
	let last: HTMLElement | undefined;
	for (const t of tokens) {
		if (t.type === "space") {
			if (last) last.dataset.sep = (last.dataset.sep ?? "") + t.raw;
			continue;
		}
		const el = block(host, t);
		el.dataset.raw ??= t.raw.replace(/\n+$/, "");
		el.dataset.sep = /\n*$/.exec(t.raw)![0];
		ed.append(el);
		last = el;
	}
	if (!ed.firstChild) ed.append(h("p"));
	return { lead, trail };
}

/* ---------- markdown out ---------- */

/** The words inside a node, as markdown. */
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
					// A font is an attribute, `font="Lora"`; a colour and a size are classes.
					const attributes = [...classes].map(([kind, value]) => (kind === "font" ? (Object.entries(FACE_ALIAS).find(([, family]) => family === value)?.[0] ? `.${Object.entries(FACE_ALIAS).find(([, family]) => family === value)![0]}` : `font="${value}"`) : `.${value}`));
					s += `${lead}[${core}]{${attributes.join(" ")}}${trail}`;
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

/** One block of the editor, as markdown. */
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

/**
 * The editor's blocks written back as the card's markdown: a block nobody touched as it was read
 * (`data-raw`), a changed one from its elements.
 */
export function writeCard(ed: HTMLElement, lead: string, trail: string): string {
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
