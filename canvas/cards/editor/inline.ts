// A block's inline runs, from the markdown's tokens to the editor's nodes: words,
// styles, pictures, files, links and an agent's suggestions.
import { type Token, type Tokens } from "marked";
import { sizedAlt, type ColourToken, type CriticToken, type HighlightToken, type WikiToken } from "../card-syntax.ts";
import { pictureAddress } from "../../host/host.ts";
import { atom, fontSpan, h } from "./model.ts";
import type { EditorCtx } from "./ctx.ts";

export function inline(cx: EditorCtx, parent: Node, tokens: readonly Token[] | undefined) {
	const list = tokens ?? [];
	for (let i = 0; i < list.length; i++) i = inlineToken(cx, parent, list, i);
}

/** One token of a run put into `parent`; answers the index of the last token it used. */
function inlineToken(cx: EditorCtx, parent: Node, list: readonly Token[], i: number): number {
	const t = list[i]!;
	switch (t.type) {
		case "text": {
			const tt = t as Tokens.Text;
			if (tt.tokens?.length) cx.inline(parent, tt.tokens);
			else parent.appendChild(document.createTextNode(tt.raw));
			break;
		}
		case "strong":
		case "em":
		case "del": {
			const el = h(t.type === "strong" ? "strong" : t.type === "em" ? "em" : "s");
			cx.inline(el, (t as Tokens.Strong).tokens);
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
			cx.inline(a, l.tokens);
			parent.appendChild(a);
			break;
		}
		case "image": {
			const im = t as Tokens.Image;
			const { alt } = sizedAlt(im.text);
			parent.appendChild(cx.piece("img", im.raw, alt || "image", im.href));
			break;
		}
		case "br":
			parent.appendChild(h("br"));
			break;
		case "highlight": {
			const m = t as HighlightToken;
			const el = h("mark", m.colour ? { "data-c": m.colour } : {});
			cx.inline(el, m.tokens as Token[]);
			parent.appendChild(el);
			break;
		}
		case "colour":
			inlineColour(cx, parent, t as ColourToken);
			break;
		case "wiki": {
			const w = t as WikiToken;
			parent.appendChild(cx.piece(w.embed ? "file" : "wiki", w.raw, w.alias ?? w.target));
			break;
		}
		case "critic":
			return inlineCritic(parent, list, i);
		case "hidden":
			parent.appendChild(atom(t.raw, t.raw, "pce-atom pce-faint"));
			break;
		case "html":
			return inlineHtml(cx, parent, list, i);
		default:
			parent.appendChild(atom(t.raw, "text" in t && typeof t.text === "string" ? t.text : t.raw));
	}
	return i;
}

/** Words in a colour, a size or a face: one span per kind, nested. */
function inlineColour(cx: EditorCtx, parent: Node, c: ColourToken): void {
	// One span per kind, nested, so a style can be taken off one kind without the others.
	const kinds: Array<[string, string]> = [];
	if (c.colour) kinds.push(["data-fg", c.colour]);
	if (c.size) kinds.push(["data-size", c.size]);
	if (c.face) kinds.push(["data-font", c.face]);
	let into: Node = parent;
	for (const [attr, value] of kinds) into = into.appendChild(attr === "data-font" ? fontSpan(value) : h("span", { [attr]: value }));
	cx.inline(into, c.tokens as Token[]);
}

/** A critic mark: a comment, a highlight, or a suggestion with the reason that follows it. */
function inlineCritic(parent: Node, list: readonly Token[], i: number): number {
	const c = list[i] as CriticToken;
	let at = i;
	if (c.op === "comment") parent.appendChild(atom(c.raw, `💬 ${c.new}`, "pce-atom pce-faint"));
	else if (c.op === "highlight") parent.appendChild(atom(c.raw, c.old, "pce-atom pce-markatom"));
	else {
		// A suggestion, with the reason that follows it, if one does.
		const next = list[i + 1] as CriticToken | undefined;
		const reason = next?.type === "critic" && next.op === "comment" ? next : undefined;
		if (reason) at++;
		parent.appendChild(suggestion(c.raw + (reason?.raw ?? ""), c.old, c.new, reason?.new));
	}
	return at;
}

/** Raw HTML: <u>…</u> as underlined words typed into like any other, else kept as its markdown. */
function inlineHtml(cx: EditorCtx, parent: Node, list: readonly Token[], i: number): number {
	const t = list[i]!;
	// <u>…</u>: underlined words, typed into like any other.
	const close = /^<u>$/i.test(t.raw) ? list.findIndex((x, j) => j > i && /^<\/u>$/i.test(x.raw)) : -1;
	if (close > i) {
		const u = h("u");
		cx.inline(u, list.slice(i + 1, close));
		parent.appendChild(u);
		return close;
	} else parent.appendChild(atom(t.raw, t.raw));
	return i;
}

export function suggestion(raw: string, old: string, now: string, reason?: string): HTMLElement {
	const el = h("span", { class: "pce-sug", contenteditable: "false", "data-raw": raw, ...(reason ? { title: reason } : {}) });
	if (old) el.append(h("del", {}, old));
	if (now) el.append(h("ins", {}, now));
	if (reason) el.append(h("span", { class: "pce-why" }, "💬"));
	el.append(h("button", { type: "button", "data-accept": "", title: "Accept" }, "✓"), h("button", { type: "button", "data-reject": "", title: "Reject" }, "✕"));
	return el;
}

export function piece(cx: EditorCtx, kind: "img" | "file" | "wiki", raw: string, label: string, src?: string, width?: number, block = false): HTMLElement {
	const el = h(block ? "div" : "span", { class: `pce-piece${block ? " pce-block" : ""}`, "data-kind": kind, contenteditable: "false", "data-raw": raw });
	if (kind === "img") {
		const img = h("img", { src: cx.url(src ?? ""), alt: label, draggable: "false" });
		img.onerror = () => img.remove();
		el.append(img, h("span", {}, label));
		if (width) el.style.width = `${width}px`;
	} else el.append(h("span", { class: "pce-ic" }, kind === "file" ? "📄" : "🔗"), document.createTextNode(label));
	return el;
}

export const url = (cx: EditorCtx, src: string) => {
	try {
		return pictureAddress(src, new URL(cx.props.base || "/", location.origin).href);
	} catch {
		return src;
	}
};

export function list(cx: EditorCtx, t: Tokens.List): HTMLElement {
	const el = h(t.ordered ? "ol" : "ul", { ...(t.ordered && t.start !== 1 && t.start !== "" ? { start: String(t.start) } : {}), ...(t.loose ? { "data-loose": "" } : {}) });
	for (const item of t.items) {
		const li = h("li");
		if (item.task) li.append(h("span", { class: "pce-check", contenteditable: "false", ...(item.checked ? { "data-on": "" } : {}) }));
		for (const sub of item.tokens) {
			if (sub.type === "checkbox") continue;
			if (sub.type === "text") cx.inline(li, (sub as Tokens.Text).tokens ?? [{ type: "text", raw: sub.raw, text: sub.raw } as Tokens.Text]);
			else if (sub.type === "paragraph") {
				const p = h("p");
				cx.inline(p, (sub as Tokens.Paragraph).tokens);
				li.append(p);
			} else if (sub.type === "list") li.append(cx.list(sub as Tokens.List));
			else if (sub.type !== "space") li.append(atom(sub.raw.replace(/\n+$/, ""), sub.raw.replace(/\n+$/, ""), "pce-atom pce-raw", "div"));
		}
		el.append(li);
	}
	return el;
}
