// What the card editor's page is made of: the pieces a card's markdown becomes, and the
// markdown read in as them, block by block.
import { pageFont } from "../../look/look.ts";
import { type Token, type Tokens } from "marked";
import { CALLOUTS, cardMarked, sizedAlt, type WikiToken } from "../card-syntax.ts";
import type { EditorCtx } from "./ctx.ts";

export const ZW = "​";

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (text !== undefined) el.textContent = text;
	return el;
};

/** An element taken out, its children left where it was. */
export const unwrap = (n: Element) => n.replaceWith(...n.childNodes);

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

// A card's markdown read in, block by block
export function build(cx: EditorCtx, md: string) {
	cx.ed.textContent = "";
	const tokens = cardMarked().lexer(md);
	cx.lead = /^\s*/.exec(md)![0];
	cx.trail = /\n*$/.exec(md)![0];
	let last: HTMLElement | undefined;
	for (const t of tokens) {
		if (t.type === "space") {
			if (last) last.dataset.sep = (last.dataset.sep ?? "") + t.raw;
			continue;
		}
		const el = cx.block(t);
		el.dataset.raw ??= t.raw.replace(/\n+$/, "");
		el.dataset.sep = /\n*$/.exec(t.raw)![0];
		cx.ed.append(el);
		last = el;
	}
	if (!cx.ed.firstChild) cx.ed.append(h("p"));
}

export function block(cx: EditorCtx, t: Token): HTMLElement {
	const raw = t.raw.replace(/\n+$/, "");
	switch (t.type) {
		case "heading": {
			const el = h(`h${Math.min(6, (t as Tokens.Heading).depth)}` as "h1");
			cx.inline(el, (t as Tokens.Heading).tokens);
			return el;
		}
		case "paragraph": {
			const p = t as Tokens.Paragraph;
			const real = (p.tokens ?? []).filter((x) => !(x.type === "text" && !x.raw.trim()));
			if (real.length === 1 && real[0]!.type === "image") {
				const im = real[0] as Tokens.Image;
				const { alt, width } = sizedAlt(im.text);
				return cx.piece("img", raw, alt || "image", im.href, width, true);
			}
			if (real.length === 1 && real[0]!.type === "wiki" && (real[0] as WikiToken).embed) {
				const w = real[0] as WikiToken;
				const pic = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(w.target);
				return pic ? cx.piece("img", raw, w.alias ?? w.target, w.target, w.width, true) : cx.piece("file", raw, w.target, undefined, undefined, true);
			}
			const el = h("p");
			cx.inline(el, p.tokens);
			return el;
		}
		case "list":
			return cx.list(t as Tokens.List);
		case "blockquote": {
			const quote = quoteBlock(cx, t as Tokens.Blockquote);
			if (quote) return quote;
			break;
		}
		case "table":
			return tableBlock(cx, t as Tokens.Table);
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
			if (held) return atom(raw, `▢ ${cx.props.held?.[held[1]!] ?? "item"}`, "pce-atom pce-held", "div");
			break;
		}
	}
	return atom(raw, raw, "pce-atom pce-raw", "div");
}

/** A quote, or a callout with its type, fold and title; none for a quote holding more than words. */
function quoteBlock(cx: EditorCtx, q: Tokens.Blockquote): HTMLElement | undefined {
	if (!q.tokens.every((x) => x.type === "paragraph" || x.type === "space")) return undefined;
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
		cx.inline(el2, p.tokens);
		el.append(el2);
	}
	return el;
}

/** A table, typed into cell by cell: Enter goes down a column, and past the last row adds one. */
function tableBlock(cx: EditorCtx, tb: Tokens.Table): HTMLElement {
	const el = h("table", { class: "pce-table", "data-align": tb.align.map((a) => a ?? "").join(",") });
	const head = el.appendChild(h("thead")).appendChild(h("tr"));
	for (const cell of tb.header) cx.inline(head.appendChild(h("th")), cell.tokens);
	const body = el.appendChild(h("tbody"));
	for (const row of tb.rows) {
		const tr = body.appendChild(h("tr"));
		for (const cell of row) cx.inline(tr.appendChild(h("td")), cell.tokens);
	}
	return el;
}
