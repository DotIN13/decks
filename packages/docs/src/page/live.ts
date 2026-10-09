import { transformSplices, type DocChange, type Splice } from "../index.ts";
import type { DocSync } from "../client.ts";
import { invert } from "../merge.ts";
import { blocks } from "./blocks.ts";
import { spliceBetween, type Mark } from "./marks.ts";
import { readTabular, texMeta, TEXT_ENVS, THEOREMS, withMacros, type TexMeta } from "./tex.ts";

/**
 * The page you type into, for markdown and LaTeX: the file's own text, drawn as it reads.
 *
 * Every character on the page is a character of the file, in order, so a caret is an offset into
 * the file and a keystroke is one splice of it, exactly. What makes it read as a document rather
 * than as source is styling: a heading line is drawn large, `**` around a word makes it bold, and
 * the syntax that says so (the `#`, the `**`, a link's address) is hidden until the caret comes
 * into the heading or the word, as Typora does. Maths, pictures and tables are drawn beside their
 * source, which shows only while the caret is in them.
 *
 * The browser never edits the page itself. Every input is turned into a splice of the file here
 * (`beforeinput`), applied, and the touched blocks are drawn again from the file, so the page and
 * the file cannot drift. The one exception is an input method composing a word, which has to be
 * left alone until it is done; its result is read back off the page and turned into a splice.
 *
 * Undo is this page's own: a list of the splices that would take each edit back, moved past
 * whatever others wrote since, so undo never takes back an agent's words.
 */

export interface LiveHost {
	/** Set the maths in an element (KaTeX's auto-render, in Decks). */
	math?(into: HTMLElement): Promise<void> | void;
	/** A URL a picture's address can be drawn from: relative addresses are the file's neighbours. */
	asset?(src: string): Promise<string | undefined>;
	/** Where other writers' words are, to highlight. */
	marks(): readonly Mark[];
	changes(): readonly DocChange[];
	/** After the caret moves or the text changes: what the toolbar shows as pressed. */
	onState?(state: FormatState): void;
}

export interface FormatState {
	bold: boolean;
	italic: boolean;
	strike: boolean;
	underline: boolean;
	code: boolean;
	mark: boolean;
	link: boolean;
	math: boolean;
	/** The line the caret is on: `p`, `h1`…`h6`, `quote`, `ul`, `ol`, `task`, or `code` inside a fenced block. */
	block: string;
}

export type InlineStyle = "bold" | "italic" | "strike" | "underline" | "code" | "mark" | "math";
export type BlockStyle = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "ul" | "ol" | "task" | "code";

interface Range2 {
	start: number;
	end: number;
}

interface UndoEntry {
	/** The splices that take this edit back, in the text as it stands now. */
	undo: Splice[];
	caret: Range2;
	after: Range2;
	at: number;
	kind: string;
}

const PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined && text !== "") node.append(text);
	return node;
}

/** Syntax: hidden until the caret is in what it belongs to. */
const mk = (text: string) => h("span", "lv-mk", text);

/** An element that stands for a span of source: where it is, and how long its opening and closing syntax are. */
function inl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, s: number, e: number, open: number, close: number): HTMLElementTagNameMap[K] {
	const node = h(tag, `lv-i ${cls}`);
	node.dataset.s = String(s);
	node.dataset.e = String(e);
	node.dataset.o = String(open);
	node.dataset.c = String(close);
	return node;
}

/** Drawn, not typed into: no text of it is the file's. */
function widget(tag: keyof HTMLElementTagNameMap, cls: string, kind: string): HTMLElement {
	const node = document.createElement(tag);
	node.className = `lv-w ${cls}`;
	node.contentEditable = "false";
	node.dataset.widget = kind;
	return node;
}

/** The index of the brace closing the one at `open`, or -1. */
function closeBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}" && --depth === 0) return i;
	}
	return -1;
}

/** `[label](url)` starting at `i`: where its parts are, or undefined. */
function linkAt(text: string, i: number): { label: [number, number]; url: [number, number]; end: number } | undefined {
	let depth = 0;
	let k = i;
	for (; k < text.length; k++) {
		const c = text[k];
		if (c === "\\") {
			k++;
			continue;
		}
		if (c === "[") depth++;
		else if (c === "]" && --depth === 0) break;
	}
	if (k >= text.length || text[k + 1] !== "(") return undefined;
	let paren = 0;
	let m = k + 1;
	for (; m < text.length; m++) {
		const c = text[m];
		if (c === "\\") {
			m++;
			continue;
		}
		if (c === "(") paren++;
		else if (c === ")" && --paren === 0) break;
	}
	if (m >= text.length) return undefined;
	return { label: [i + 1, k], url: [k + 2, m], end: m + 1 };
}

const TEX_STYLE: Record<string, [keyof HTMLElementTagNameMap, string]> = {
	textbf: ["strong", "lv-b"],
	textit: ["em", "lv-em"],
	emph: ["em", "lv-em"],
	textsl: ["em", "lv-em"],
	underline: ["u", "lv-u"],
	texttt: ["code", "lv-code"],
	textsc: ["span", "lv-sc"],
	sout: ["s", "lv-s"],
	footnote: ["span", "lv-fnote"],
};
const TEX_REF = /^(cite[a-z]*|ref|eqref|autoref|cref|Cref|label|pageref)$/;
const TEX_HEADING: Record<string, number> = { part: 1, chapter: 1, title: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };
const MATH_ENV = /^\s*(\\begin\{(equation|align|gather|multline|eqnarray|displaymath|math)\*?\}|\\\[|\$\$)/;

/** Builds one block's elements from its source. */
class Builder {
	/** Drawn later: maths for KaTeX (`source`, and `shows`, the formula as written, for when it cannot be drawn), pictures by address. */
	readonly widgets: Array<{ kind: "math" | "img"; el: HTMLElement; source: string; shows?: string }> = [];
	/** The LaTeX lists the current line is inside, innermost last, with how many items each has drawn. */
	private lists: Array<{ ordered: boolean; n: number }> = [];
	/** The LaTeX text environments the current line is inside, innermost last. */
	private envs: string[] = [];
	/**
	 * `meta` is what the whole LaTeX file says (title, label numbers, citation numbers) and `base`
	 * is where this block starts in it, to look an environment's number up by its offset.
	 */
	constructor(
		readonly tex: boolean,
		private readonly meta?: TexMeta,
		private readonly base = 0,
	) {}

	// --- inline -------------------------------------------------------------------------

	inline(text: string, at: number, into: HTMLElement): void {
		return this.tex ? this.inlineTex(text, at, into) : this.inlineMd(text, at, into);
	}

	private math(raw: string, s: number, e: number, open: number, into: HTMLElement): void {
		const node = inl("span", "lv-math", s, e, open, open);
		const src = h("span", "lv-src", raw);
		const shown = widget("span", "lv-mathw", "math");
		node.append(src, shown);
		this.widgets.push({ kind: "math", el: shown, source: withMacros(raw.startsWith("\\(") ? `$${raw.slice(2, -2)}$` : raw, this.meta?.macros ?? ""), shows: raw });
		into.append(node);
	}

	private inlineMd(text: string, at: number, into: HTMLElement): void {
		let i = 0;
		let plain = 0;
		const flush = (to: number) => {
			if (to > plain) into.append(text.slice(plain, to));
		};
		const done = (next: number) => {
			i = next;
			plain = next;
		};
		while (i < text.length) {
			const c = text[i]!;
			const rest = text.slice(i);
			if (c === "\\" && i + 1 < text.length && PUNCT.test(text[i + 1]!)) {
				flush(i);
				into.append(mk("\\"), text[i + 1]!);
				done(i + 2);
				continue;
			}
			if (c === "`") {
				let n = 1;
				while (text[i + n] === "`") n++;
				const ticks = "`".repeat(n);
				let close = text.indexOf(ticks, i + n);
				while (close !== -1 && text[close + n] === "`") close = text.indexOf(ticks, close + n + 1);
				if (close > i + n - 1 && close !== -1) {
					flush(i);
					const node = inl("code", "lv-code", at + i, at + close + n, n, n);
					node.append(mk(ticks), text.slice(i + n, close), mk(ticks));
					into.append(node);
					done(close + n);
					continue;
				}
				i += n;
				continue;
			}
			if (c === "!" && text[i + 1] === "[") {
				const link = linkAt(text, i + 1);
				if (link) {
					flush(i);
					const node = inl("span", "lv-img", at + i, at + link.end, 2, link.end - link.label[1]);
					const src = h("span", "lv-src", text.slice(i, link.end));
					const shown = widget("span", "lv-imgw", "img");
					const img = h("img");
					img.alt = text.slice(link.label[0], link.label[1]);
					shown.append(img);
					node.append(src, shown);
					this.widgets.push({ kind: "img", el: img, source: text.slice(link.url[0], link.url[1]).trim().split(/\s+/)[0]!.replace(/^<|>$/g, "") });
					into.append(node);
					done(link.end);
					continue;
				}
			}
			if (c === "[" && text[i + 1] === "^") {
				const close = text.indexOf("]", i);
				if (close !== -1) {
					flush(i);
					into.append(h("sup", "lv-fn", text.slice(i, close + 1)));
					done(close + 1);
					continue;
				}
			}
			if (c === "[") {
				const link = linkAt(text, i);
				if (link) {
					flush(i);
					const node = inl("a", "lv-a", at + i, at + link.end, 1, link.end - link.label[1]);
					node.dataset.href = text.slice(link.url[0], link.url[1]).trim().split(/\s+/)[0]!.replace(/^<|>$/g, "");
					node.append(mk("["));
					this.inlineMd(text.slice(link.label[0], link.label[1]), at + link.label[0], node);
					node.append(mk(text.slice(link.label[1], link.end)));
					into.append(node);
					done(link.end);
					continue;
				}
			}
			if (c === "$" && text[i + 1] !== "$" && !isSpace(text[i + 1])) {
				let close = text.indexOf("$", i + 1);
				while (close !== -1 && (text[close - 1] === "\\" || isSpace(text[close - 1]))) close = text.indexOf("$", close + 1);
				if (close !== -1 && !/\d/.test(text[close + 1] ?? "")) {
					flush(i);
					this.math(text.slice(i, close + 1), at + i, at + close + 1, 1, into);
					done(close + 1);
					continue;
				}
			}
			if (c === "$" && text[i + 1] === "$") {
				const close = text.indexOf("$$", i + 2);
				if (close > i + 2) {
					flush(i);
					this.math(text.slice(i, close + 2), at + i, at + close + 2, 2, into);
					done(close + 2);
					continue;
				}
			}
			if (c === "<") {
				const auto = /^<((?:https?|mailto):[^\s<>]+)>/.exec(rest);
				if (auto) {
					flush(i);
					const node = inl("a", "lv-a", at + i, at + i + auto[0].length, 1, 1);
					node.dataset.href = auto[1]!;
					node.append(mk("<"), auto[1]!, mk(">"));
					into.append(node);
					done(i + auto[0].length);
					continue;
				}
				const pair = /^<(u|sub|sup|kbd|mark)>/.exec(rest);
				const close = pair ? text.indexOf(`</${pair[1]}>`, i + pair[0].length) : -1;
				if (pair && close !== -1) {
					flush(i);
					const tag = pair[1] === "u" ? "u" : (pair[1] as "sub" | "sup" | "kbd" | "mark");
					const end = close + pair[1]!.length + 3;
					const node = inl(tag, `lv-${pair[1]}`, at + i, at + end, pair[0].length, pair[1]!.length + 3);
					node.append(mk(pair[0]));
					this.inlineMd(text.slice(i + pair[0].length, close), at + i + pair[0].length, node);
					node.append(mk(`</${pair[1]}>`));
					into.append(node);
					done(end);
					continue;
				}
				const tag = /^<\/?[a-zA-Z][^<>]*>|^<!--[\s\S]*?-->/.exec(rest);
				if (tag) {
					flush(i);
					into.append(h("span", "lv-tag", tag[0]));
					done(i + tag[0].length);
					continue;
				}
			}
			if ((c === "h" || c === "w") && (i === 0 || !isWord(text[i - 1]))) {
				const url = /^(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]]/.exec(rest);
				if (url) {
					flush(i);
					const node = h("a", "lv-a lv-bare", url[0]);
					node.dataset.href = url[0].startsWith("www.") ? `https://${url[0]}` : url[0];
					into.append(node);
					done(i + url[0].length);
					continue;
				}
			}
			if (c === "*" || c === "_" || c === "~" || c === "=") {
				let n = 1;
				while (text[i + n] === c) n++;
				const used = this.emphasis(text, at, i, c, n, into, flush);
				if (used) {
					done(used);
					continue;
				}
				i += n;
				continue;
			}
			i++;
		}
		flush(text.length);
	}

	/** `*`, `_`, `~~` or `==` at `i`, a run of `n`: the index after it when it opened and closed something. */
	private emphasis(text: string, at: number, i: number, c: string, n: number, into: HTMLElement, flush: (to: number) => void): number | undefined {
		if ((c === "~" || c === "=") && n !== 2) return undefined;
		if (n > 3) return undefined;
		if (c === "_" && isWord(text[i - 1])) return undefined;
		if (isSpace(text[i + n])) return undefined;
		const delim = c.repeat(n);
		for (let j = text.indexOf(delim, i + n + 1); j !== -1; j = text.indexOf(delim, j + 1)) {
			let run = n;
			while (text[j + run] === c) run++;
			if (text[j - 1] === c) continue;
			if (run !== n || isSpace(text[j - 1]) || text[j - 1] === "\\") {
				j += run - 1;
				continue;
			}
			if (c === "_" && isWord(text[j + n])) continue;
			flush(i);
			const make = (outerS: number, outerE: number, depth: number, into2: HTMLElement) => {
				const kind = c === "~" ? (["s", "lv-s"] as const) : c === "=" ? (["mark", "lv-mark"] as const) : depth === 2 ? (["strong", "lv-b"] as const) : (["em", "lv-em"] as const);
				const node = inl(kind[0], kind[1], at + outerS, at + outerE, depth, depth);
				into2.append(node);
				return node;
			};
			let inner: HTMLElement;
			if (n === 3) {
				const outer = make(i, j + 3, 2, into);
				outer.append(mk(c.repeat(2)));
				const em = make(i + 2, j + 1, 1, outer);
				em.append(mk(c));
				inner = em;
				this.inlineMd(text.slice(i + 3, j), at + i + 3, inner);
				em.append(mk(c));
				outer.append(mk(c.repeat(2)));
			} else {
				const node = make(i, j + n, n, into);
				node.append(mk(delim));
				this.inlineMd(text.slice(i + n, j), at + i + n, node);
				node.append(mk(delim));
			}
			return j + n;
		}
		return undefined;
	}

	private inlineTex(text: string, at: number, into: HTMLElement): void {
		let i = 0;
		let plain = 0;
		const flush = (to: number) => {
			if (to > plain) into.append(text.slice(plain, to));
		};
		const done = (next: number) => {
			i = next;
			plain = next;
		};
		while (i < text.length) {
			const c = text[i]!;
			if (c === "%") {
				flush(i);
				into.append(h("span", "lv-comment", text.slice(i)));
				done(text.length);
				continue;
			}
			if (c === "\\") {
				const name = /^\\([a-zA-Z]+)\*?/.exec(text.slice(i));
				if (name) {
					const cmd = name[1]!;
					const after = i + name[0].length;
					const style = TEX_STYLE[cmd];
					if (style && text[after] === "{") {
						const close = closeBrace(text, after);
						if (close !== -1) {
							flush(i);
							const node = inl(style[0], style[1], at + i, at + close + 1, after + 1 - i, 1);
							node.append(mk(text.slice(i, after + 1)));
							this.inlineTex(text.slice(after + 1, close), at + after + 1, node);
							node.append(mk("}"));
							into.append(node);
							done(close + 1);
							continue;
						}
					}
					if ((cmd === "href" || cmd === "url") && text[after] === "{") {
						const close = closeBrace(text, after);
						const second = cmd === "href" && text[close + 1] === "{" ? closeBrace(text, close + 1) : -1;
						if (close !== -1 && (cmd === "url" || second !== -1)) {
							flush(i);
							const end = cmd === "url" ? close + 1 : second + 1;
							const open = cmd === "url" ? after + 1 - i : close + 2 - i;
							const node = inl("a", "lv-a", at + i, at + end, open, 1);
							node.dataset.href = text.slice(after + 1, close);
							node.append(mk(text.slice(i, i + open)));
							this.inlineTex(text.slice(i + open, end - 1), at + i + open, node);
							node.append(mk("}"));
							into.append(node);
							done(end);
							continue;
						}
					}
					if (TEX_REF.test(cmd) && /^(\[[^\]]*\])*\{/.test(text.slice(after))) {
						const brace = text.indexOf("{", after);
						const close = closeBrace(text, brace);
						if (close !== -1) {
							flush(i);
							const raw = text.slice(i, close + 1);
							if (cmd === "label") {
								// A label prints nothing: it shows only while the caret is on its line.
								into.append(h("span", "lv-mk lv-label", raw));
							} else {
								// Open and close are the command's own syntax, so a press on the number puts the caret at the key.
								const node = inl("span", cmd.startsWith("cite") ? "lv-ref lv-cite" : "lv-ref", at + i, at + close + 1, brace + 1 - i, 1);
								const shown = widget("span", "lv-refw", "open");
								const keys = text.slice(brace + 1, close).split(",").map((k) => k.trim()).filter(Boolean);
								shown.textContent = this.refText(cmd, keys);
								shown.title = keys.join(", ");
								if (shown.textContent.includes("?")) shown.classList.add("lv-unresolved");
								node.append(h("span", "lv-src", raw), shown);
								into.append(node);
							}
							done(close + 1);
							continue;
						}
					}
					flush(i);
					into.append(h("span", "lv-cmd", name[0]));
					done(after);
					continue;
				}
				if (text[i + 1] === "(") {
					const close = text.indexOf("\\)", i + 2);
					if (close !== -1) {
						flush(i);
						this.math(text.slice(i, close + 2), at + i, at + close + 2, 2, into);
						done(close + 2);
						continue;
					}
				}
				if (text[i + 1] === "\\") {
					flush(i);
					into.append(h("span", "lv-cmd", "\\\\"));
					done(i + 2);
					continue;
				}
				if (i + 1 < text.length) {
					flush(i);
					into.append(mk("\\"), text[i + 1]!);
					done(i + 2);
					continue;
				}
			}
			if (c === "$") {
				const two = text[i + 1] === "$";
				const close = two ? text.indexOf("$$", i + 2) : text.indexOf("$", i + 1);
				if (close !== -1 && close > i + (two ? 2 : 1)) {
					flush(i);
					const end = close + (two ? 2 : 1);
					this.math(text.slice(i, end), at + i, at + end, two ? 2 : 1, into);
					done(end);
					continue;
				}
			}
			if (c === "{" || c === "}") {
				flush(i);
				into.append(h("span", "lv-brace", c));
				done(i + 1);
				continue;
			}
			if (c === "~") {
				// A tie is a space that does not break: drawn as a space, the tilde itself shown only on the open line.
				flush(i);
				into.append(h("span", "lv-tilde", "~"));
				done(i + 1);
				continue;
			}
			i++;
		}
		flush(text.length);
	}

	/** What `\ref`, `\eqref`, `\cite` and their kin print, from what the whole file numbers. */
	private refText(cmd: string, keys: string[]): string {
		const labels = this.meta?.labels;
		const cites = this.meta?.cites;
		if (cmd.startsWith("cite")) {
			if (cmd === "citeauthor" || cmd === "citeyear") return keys.join(", ");
			return `[${keys.map((k) => (cites?.get(k) ? String(cites.get(k)) : "?")).join(", ")}]`;
		}
		const one = (k: string) => labels?.get(k);
		const names: Record<string, string> = { section: "Section", equation: "Equation", figure: "Figure", table: "Table", theorem: "Theorem", item: "Item", other: "" };
		return keys
			.map((k) => {
				const target = one(k);
				if (!target) return "??";
				if (cmd === "eqref") return `(${target.num})`;
				if (cmd === "autoref" || cmd === "cref" || cmd === "Cref") return `${names[target.kind]} ${target.kind === "equation" ? `(${target.num})` : target.num}`.trim();
				return target.num;
			})
			.join(", ");
	}

	// --- lines and blocks -------------------------------------------------------------------

	/** One line: its kind, its block syntax, and its words. `s` is where it starts in the block. */
	line(text: string, s: number, newline: boolean, inList: boolean): HTMLElement {
		const node = h("div", "lv-line");
		node.dataset.s = String(s);
		node.dataset.e = String(s + text.length);
		let body = 0;
		const prefix = (len: number) => {
			if (len > 0) node.append(mk(text.slice(0, len)));
			body = len;
		};
		if (text.trim() === "") node.classList.add("lv-blank");
		else if (this.tex) this.texLine(text, s, node, (len) => prefix(len), (len) => (body = len));
		else {
			let m: RegExpExecArray | null;
			if ((m = /^ {0,3}(#{1,6})([ \t]+|$)/.exec(text))) {
				node.classList.add(`lv-h${m[1]!.length}`);
				node.dataset.block = `h${m[1]!.length}`;
				prefix(m[0].length);
			} else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(text)) {
				node.classList.add("lv-hr");
				node.dataset.block = "hr";
				prefix(text.length);
			} else if ((m = /^( {0,3}>[ \t]?)+/.exec(text))) {
				node.classList.add("lv-quote");
				node.dataset.block = "quote";
				node.style.setProperty("--depth", String((m[0].match(/>/g) ?? []).length));
				prefix(m[0].length);
				if (/^([-*+]|\d{1,9}[.)])[ \t]+/.test(text.slice(m[0].length))) {
					// A list inside a quote reads as one: the quote's marker hides, the item's shows.
				}
			} else if ((m = /^([ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(text))) {
				const indent = m[1]!.replace(/\t/g, "    ").length;
				node.classList.add("lv-li");
				node.style.setProperty("--indent", String(Math.floor(indent / 2)));
				if (m[6]) {
					node.classList.add("lv-task");
					node.dataset.block = "task";
					const lead = m[1]!.length + m[2]!.length + m[5]!.length;
					node.append(mk(text.slice(0, lead)));
					const box = widget("span", "lv-check", "task");
					const checked = /x/i.test(m[6]);
					box.dataset.checked = String(checked);
					box.dataset.at = String(s + lead + 1);
					node.classList.toggle("lv-done", checked);
					node.append(box, mk(m[6]));
					body = m[0].length;
				} else if (m[3]) {
					node.classList.add("lv-ol");
					node.dataset.block = "ol";
					node.append(mk(m[1]!), h("span", "lv-num", m[2]!), mk(m[5]!));
					body = m[0].length;
				} else {
					node.classList.add("lv-ul");
					node.dataset.block = "ul";
					prefix(m[0].length);
				}
			} else if (inList && (m = /^([ \t]{2,})\S/.exec(text))) {
				node.classList.add("lv-li", "lv-cont");
				node.style.setProperty("--indent", String(Math.floor(m[1]!.replace(/\t/g, "    ").length / 2) - 1));
				prefix(m[1]!.length);
			} else {
				node.classList.add("lv-p");
				node.dataset.block = "p";
			}
			if (!node.classList.contains("lv-hr")) this.inline(text.slice(body), s + body, node);
		}
		if (node.classList.contains("lv-blank")) node.append(text);
		node.dataset.p = String(body);
		if (newline) node.append("\n");
		return node;
	}

	private texLine(text: string, s: number, node: HTMLElement, prefix: (len: number) => void, body: (len: number) => void): void {
		let m: RegExpExecArray | null;
		if ((m = /^(\s*)\\([a-zA-Z]+)\*?(\[[^\]]*\])?\{/.exec(text)) && TEX_HEADING[m[2]!] !== undefined) {
			const open = m[0].length - 1;
			const close = closeBrace(text, open);
			if (close !== -1) {
				const level = TEX_HEADING[m[2]!]!;
				node.classList.add(`lv-h${level}`);
				node.dataset.block = `h${level}`;
				node.append(mk(text.slice(0, open + 1)));
				this.inline(text.slice(open + 1, close), s + open + 1, node);
				node.append(mk("}"));
				this.inline(text.slice(close + 1), s + close + 1, node);
				return;
			}
		}
		if ((m = /^(\s*)\\item(\[[^\]]*\])?[ \t]*/.exec(text))) {
			const list = this.lists.at(-1);
			node.classList.add("lv-li");
			node.style.setProperty("--indent", String(Math.max(0, this.lists.length - 1)));
			if (list?.ordered) {
				// The number is LaTeX's to give, not the file's: drawn, so it is not a character of the text.
				node.classList.add("lv-ol");
				node.dataset.block = "ol";
				const num = widget("span", "lv-num", "open");
				num.textContent = `${++list.n}.`;
				node.append(num, mk(text.slice(0, m[0].length)));
				body(m[0].length);
			} else {
				node.classList.add("lv-ul");
				node.dataset.block = "ul";
				prefix(m[0].length);
			}
			this.inline(text.slice(m[0].length), s + m[0].length, node);
			return;
		}
		const env = /^\s*\\(begin|end)\{(itemize|enumerate|description)\}/.exec(text);
		if (env?.[1] === "begin") this.lists.push({ ordered: env[2] === "enumerate", n: 0 });
		else if (env) this.lists.pop();
		// A list's own \begin and \end lines say nothing the bullets do not: hidden until the caret is on them.
		if (env && /^\s*\\(begin|end)\{[a-z]+\}\s*(%.*)?$/.test(text)) {
			node.classList.add("lv-tagline");
			node.dataset.block = "env";
			node.append(mk(text));
			return;
		}
		if (/^\s*\\maketitle\s*(%.*)?$/.test(text)) {
			node.classList.add("lv-tagline", "lv-maketitle");
			node.dataset.block = "env";
			node.append(mk(text), this.titleBlock());
			return;
		}
		const textEnv = /^\s*\\(begin|end)\{([a-zA-Z]+)(\*?)\}(\[[^\]]*\])?\s*(\\label\{[^}]*\})?\s*(%.*)?$/.exec(text);
		if (textEnv && TEXT_ENVS.has(textEnv[2]!)) {
			const [, side, name, star, note] = textEnv;
			node.classList.add("lv-tagline");
			node.dataset.block = "env";
			node.append(mk(text));
			if (side === "begin") {
				this.envs.push(name!);
				const heading = this.envHeading(name!, star === "*", s + /^\s*/.exec(text)![0].length, note);
				if (heading) {
					node.classList.add("lv-envhead", `lv-head-${name}`);
					node.append(heading);
				}
			} else {
				this.envs.pop();
				if (name === "proof") {
					const qed = widget("span", "lv-qed", "open");
					qed.textContent = "∎";
					node.classList.add("lv-envhead");
					node.append(qed);
				}
			}
			return;
		}
		if (/^\s*\\(begin|end)\{[^}]*\}(\[[^\]]*\]|\{[^}]*\})*\s*(%.*)?$/.test(text) || /^\s*\\(maketitle|tableofcontents|newpage|clearpage|bibliography|bibliographystyle|centering|noindent)\b/.test(text)) {
			node.classList.add("lv-env");
			node.dataset.block = "env";
			node.append(text);
			return;
		}
		node.classList.add("lv-p");
		node.dataset.block = "p";
		const inside = this.envs.at(-1);
		if (inside) node.classList.add("lv-in", `lv-in-${THEOREMS[inside] ? "theorem" : inside}`);
		this.inline(text, s, node);
	}

	/** The title block `\maketitle` sets, from the preamble's \title, \author and \date. */
	private titleBlock(): HTMLElement {
		const box = widget("div", "lv-titleblock", "open");
		const meta = this.meta;
		if (!meta?.title && !meta?.author) {
			box.classList.add("lv-notitle");
			box.textContent = "No \\title in the preamble";
			return box;
		}
		const part = (cls: string, source: string | undefined) => {
			if (!source) return;
			const el = h("div", cls);
			this.inlineTex(source.replace(/\\thanks\{[^}]*\}/g, "").replace(/\s*\\and\b\s*/g, ", ").replace(/\\\\/g, ", "), 0, el);
			box.append(el);
		};
		part("lv-t-title", meta.title);
		part("lv-t-author", meta.author);
		part("lv-t-date", meta.date === undefined ? new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" }) : meta.date.replace(/\\today/, new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })));
		return box;
	}

	/** The heading a text environment opens with: Abstract, Theorem 2 (Name), Proof. */
	private envHeading(name: string, starred: boolean, s: number, note: string | undefined): HTMLElement | undefined {
		const label = name === "abstract" ? "Abstract" : name === "proof" ? "Proof." : THEOREMS[name];
		if (!label) return undefined;
		const head = widget("span", "lv-envlabel", "open");
		const num = THEOREMS[name] && !starred ? this.meta?.numbers.get(this.base + s) : undefined;
		head.textContent = THEOREMS[name] ? `${label}${num ? ` ${num}` : ""}${note ? ` (${note.slice(1, -1)})` : ""}.` : label;
		return head;
	}

	/** Lines with where each starts in the block, and whether it ends in a newline. */
	static lines(source: string): Array<{ text: string; s: number; nl: boolean }> {
		const out: Array<{ text: string; s: number; nl: boolean }> = [];
		let at = 0;
		while (at < source.length) {
			const next = source.indexOf("\n", at);
			if (next === -1) {
				out.push({ text: source.slice(at), s: at, nl: false });
				break;
			}
			out.push({ text: source.slice(at, next), s: at, nl: true });
			at = next + 1;
		}
		return out;
	}

	/** One block of the file, which the file's blank lines cut it into. */
	block(source: string, kind: string, first: boolean): HTMLElement {
		const node = h("div", "lv-chunk");
		this.lists = [];
		this.envs = [];
		const lines = Builder.lines(source);
		// The blank lines after the block's content belong to it; they are drawn as space.
		let content = lines.length;
		while (content > 0 && lines[content - 1]!.text.trim() === "") content--;
		const body = lines.slice(0, content);
		const tail = lines.slice(content);
		const head = body[0]?.text ?? "";
		const raw = (cls: string, list: typeof lines) => {
			const box = h("div", cls);
			for (const line of list) {
				const row = h("div", "lv-line lv-raw");
				row.dataset.s = String(line.s);
				row.dataset.e = String(line.s + line.text.length);
				row.dataset.p = "0";
				if (this.tex) this.inline(line.text, line.s, row);
				else row.append(line.text);
				if (line.nl) row.append("\n");
				box.append(row);
			}
			return box;
		};
		const fence = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)/.exec(head);
		if (kind === "preamble" || (!this.tex && first && /^---\s*$/.test(head) && body.length > 1)) {
			node.dataset.kind = "front";
			node.append(raw("lv-src lv-frontbox", body));
			const chip = widget("div", "lv-chip", "open");
			chip.textContent = kind === "preamble" ? `Preamble, ${body.length} lines` : "Front matter";
			node.append(chip);
		} else if (!this.tex && fence) {
			node.dataset.kind = "code";
			const box = h("div", "lv-codebox");
			for (const [index, line] of body.entries()) {
				const row = h("div", "lv-line lv-codeline");
				row.dataset.s = String(line.s);
				row.dataset.e = String(line.s + line.text.length);
				row.dataset.p = "0";
				const isFence = index === 0 || (index === body.length - 1 && line.text.trim().startsWith(fence[1]!.slice(0, 3)));
				if (isFence) row.classList.add("lv-fence");
				row.append(isFence ? mk(line.text) : line.text);
				if (line.nl) row.append("\n");
				box.append(row);
			}
			if (fence[2]) {
				const lang = widget("span", "lv-lang", "open");
				lang.textContent = fence[2];
				box.append(lang);
			}
			node.append(box);
		} else if (MATH_ENV.test(head) && (this.tex || head.trim() === "$$")) {
			node.dataset.kind = "math";
			const box = h("div", "lv-mathbox");
			box.append(raw("lv-src", body));
			const shown = widget("div", "lv-mathw lv-display", "open");
			const tex = body.map((l) => l.text).join("\n");
			box.append(shown);
			// KaTeX draws \label and \nonumber as errors; they say nothing about how the maths looks.
			let drawn = tex.replace(/\\label\{[^}]*\}/g, "").replace(/\\(nonumber|notag)\b/g, "");
			// KaTeX numbers each drawing from (1): an equation gets the number it has in the whole file instead.
			const single = /^\s*\\begin\{equation\}([\s\S]*)\\end\{equation\}\s*$/.exec(drawn);
			const num = this.meta?.numbers.get(this.base + (body[0]?.s ?? 0) + (/^\s*/.exec(head)![0].length));
			if (single) drawn = `$$${single[1]}${num ? `\\tag{${num}}` : ""}$$`;
			this.widgets.push({ kind: "math", el: shown, source: withMacros(drawn.trim().startsWith("$$") || drawn.trim().startsWith("\\[") ? drawn : `$$${drawn}$$`, this.meta?.macros ?? ""), shows: tex });
			node.append(box);
		} else if (this.tex && /^\s*\\begin\{(figure|table|tabular)\*?\}/.test(head)) {
			// A figure or a table is drawn beside its source, which shows while the caret is in it.
			node.dataset.kind = "float";
			const box = h("div", "lv-floatbox");
			box.append(raw("lv-src", body), this.float(body.map((l) => l.text).join("\n"), this.base + (body[0]?.s ?? 0) + (/^\s*/.exec(head)![0].length)));
			node.append(box);
		} else if (!this.tex && body.length >= 2 && head.includes("|") && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(body[1]!.text)) {
			node.dataset.kind = "table";
			const box = h("div", "lv-tablebox");
			box.append(raw("lv-src", body));
			box.append(this.table(body.map((l) => l.text)));
			node.append(box);
		} else if (!this.tex && /^ {0,3}<([a-zA-Z][\w-]*|!--)/.test(head)) {
			node.dataset.kind = "html";
			node.append(raw("lv-htmlbox", body));
		} else if (this.tex && /^\s*\\begin\{(verbatim|lstlisting|minted|tikzpicture|algorithm)/.test(head)) {
			node.dataset.kind = "env";
			node.append(raw("lv-envbox", body));
		} else {
			node.dataset.kind = "flow";
			let inList = false;
			for (const line of body) {
				const row = this.line(line.text, line.s, line.nl, inList);
				if (row.classList.contains("lv-li")) inList = true;
				else if (!row.classList.contains("lv-blank")) inList = false;
				node.append(row);
			}
		}
		for (const line of tail) {
			const row = h("div", "lv-line lv-blank");
			row.dataset.s = String(line.s);
			row.dataset.e = String(line.s + line.text.length);
			row.dataset.p = "0";
			row.append(line.text + (line.nl ? "\n" : ""));
			node.append(row);
		}
		return node;
	}

	/** A LaTeX figure or table as it reads: its pictures, its tabulars, and its numbered caption. */
	private float(source: string, at: number): HTMLElement {
		const shown = widget("div", "lv-floatw", "open");
		const kind = /^\s*\\begin\{(figure|table|tabular)/.exec(source)![1]!;
		const caption = (() => {
			const m = /\\caption(\[[^\]]*\])?\{/.exec(source);
			if (!m) return undefined;
			const open = m.index + m[0].length - 1;
			const close = closeBrace(source, open);
			return close === -1 ? undefined : source.slice(open + 1, close);
		})();
		const captionEl = () => {
			if (caption === undefined) return undefined;
			const el = h("div", "lv-caption");
			const num = this.meta?.numbers.get(at);
			el.append(h("b", "", `${kind === "table" ? "Table" : "Figure"}${num ? ` ${num}` : ""}: `));
			this.inlineTex(caption.replace(/\\label\{[^}]*\}/g, ""), 0, el);
			return el;
		};
		if (kind === "table" && caption !== undefined && source.indexOf("\\caption") < source.indexOf("\\begin{tabular")) shown.append(captionEl()!);
		for (const m of source.matchAll(/\\includegraphics(\[[^\]]*\])?\{([^}]*)\}/g)) {
			const path = m[2]!.trim();
			const img = h("img");
			img.alt = path;
			const width = /width\s*=\s*([\d.]+)\s*\\(?:line|text|column)width/.exec(m[1] ?? "");
			if (width) img.style.width = `${Math.min(100, Number(width[1]) * 100)}%`;
			const frame = h("div", "lv-figimg");
			frame.dataset.name = path;
			frame.append(img);
			shown.append(frame);
			this.widgets.push({ kind: "img", el: img, source: /\.[a-z0-9]{2,4}$/i.test(path) ? path : `${path}.png|${path}.jpg|${path}.jpeg|${path}.pdf` });
		}
		const begin = /\\begin\{tabular\*?\}(\{[^}]*\})?\{/g;
		for (let m = begin.exec(source); m; m = begin.exec(source)) {
			const open = m.index + m[0].length - 1;
			const specEnd = closeBrace(source, open);
			const end = source.indexOf("\\end{tabular", specEnd);
			if (specEnd === -1 || end === -1) break;
			const { rows, rules } = readTabular(source.slice(open + 1, specEnd), source.slice(specEnd + 1, end));
			const table = h("table", "lv-tabular");
			rows.forEach((row, r) => {
				const tr = h("tr");
				if (rules.includes(r)) tr.classList.add("lv-rule-above");
				if (r === rows.length - 1 && rules.includes(rows.length)) tr.classList.add("lv-rule-below");
				for (const cell of row) {
					const td = h("td");
					if (cell.span > 1) td.colSpan = cell.span;
					td.style.textAlign = cell.align;
					this.inlineTex(cell.text, 0, td);
					tr.append(td);
				}
				table.append(tr);
			});
			shown.append(table);
		}
		if (!(kind === "table" && caption !== undefined && source.indexOf("\\caption") < source.indexOf("\\begin{tabular"))) {
			const el = captionEl();
			if (el) shown.append(el);
		}
		return shown;
	}

	private table(rows: string[]): HTMLElement {
		const shown = widget("div", "lv-tablew", "open");
		const table = h("table");
		const cells = (row: string) => {
			const t = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
			return t.split(/(?<!\\)\|/).map((c) => c.trim());
		};
		const align = cells(rows[1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
		const make = (row: string, tag: "th" | "td") => {
			const tr = h("tr");
			cells(row).forEach((cell, i) => {
				const td = h(tag);
				td.style.textAlign = align[i] ?? "left";
				this.inlineMd(cell, 0, td);
				tr.append(td);
			});
			return tr;
		};
		const thead = h("thead");
		thead.append(make(rows[0]!, "th"));
		const tbody = h("tbody");
		for (const row of rows.slice(2)) tbody.append(make(row, "td"));
		table.append(thead, tbody);
		shown.append(table);
		return shown;
	}
}

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
	private tex = false;
	/** The text the page was last drawn from. */
	private drawnText = "";
	/** The key each drawn block was drawn for, to keep the ones that did not change. */
	private readonly keys = new Map<HTMLElement, string>();
	private end: HTMLElement;
	private composing = false;
	/** Others' splices that arrived while an input method was composing, to move its result past. */
	private deferred: Splice[] = [];
	private opened: HTMLElement[] = [];
	private undoStack: UndoEntry[] = [];
	private redoStack: UndoEntry[] = [];
	/** Inside `apply`: the editor draws once at the end, not once per splice. */
	private applying = false;
	private readonly mathCache = new Map<string, string>();
	private readonly onSelection = () => this.selectionMoved();

	constructor(
		private readonly sync: DocSync,
		private readonly host: LiveHost,
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

	private drawWidgets(builder: Builder): void {
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
						// A PDF figure cannot be an <img>: it is named instead.
						img.closest(".lv-figimg")?.classList.add("lv-missing");
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
	private highlight(el: HTMLElement, start: number, marks: readonly Mark[], changes: readonly DocChange[]): void {
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

	private chunks(): HTMLElement[] {
		return [...this.root.children].filter((c) => c !== this.end) as HTMLElement[];
	}

	/** A DOM position as an offset into the text the page was drawn from. */
	private offsetAt(node: Node, offset: number): number {
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
	private pointAt(offset: number): [Node, number] {
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
	private reveal(): void {
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

	private selectionMoved(): void {
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

	private scrollToCaret(): void {
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
	private replace(at: Range2, text: string, kind = "edit"): void {
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

	private applicable(splices: readonly Splice[]): boolean {
		let text = this.sync.text;
		for (const s of splices) {
			if (text.slice(s.at, s.at + s.before.length) !== s.before) return false;
			text = text.slice(0, s.at) + s.text + text.slice(s.at + s.before.length);
		}
		return true;
	}

	/** Others wrote: every undo step is moved past their words, so undo takes back only this page's own. */
	private moveHistory(applied: readonly Splice[]): void {
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
	private readBack(): void {
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

	private beforeInput(event: InputEvent): void {
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
	}

	private targetRange(event: InputEvent): Range2 | undefined {
		const range = event.getTargetRanges?.()[0];
		if (!range) return undefined;
		const a = this.offsetAt(range.startContainer, range.startOffset);
		const b = this.offsetAt(range.endContainer, range.endOffset);
		return { start: Math.min(a, b), end: Math.max(a, b) };
	}

	private lineAround(offset: number): { start: number; end: number; text: string } {
		const text = this.sync.text;
		const start = text.lastIndexOf("\n", offset - 1) + 1;
		let end = text.indexOf("\n", offset);
		if (end === -1) end = text.length;
		return { start, end, text: text.slice(start, end) };
	}

	private chunkKind(offset: number): string {
		let kind = "flow";
		for (const c of this.chunks()) {
			if (Number(c.dataset.start) <= offset) kind = c.dataset.kind ?? "flow";
			else break;
		}
		return kind;
	}

	/** The block syntax a line starts with: a heading's `#`, a quote's `>`, a list's marker, `\item`. */
	private prefixOf(line: string): { len: number; kind: string; match: RegExpExecArray } | undefined {
		if (this.tex) {
			const item = /^(\s*)\\item(\[[^\]]*\])?[ \t]*/.exec(line);
			return item ? { len: item[0].length, kind: "ul", match: item } : undefined;
		}
		let m: RegExpExecArray | null;
		if ((m = /^ {0,3}(#{1,6})[ \t]+/.exec(line))) return { len: m[0].length, kind: `h${m[1]!.length}`, match: m };
		if ((m = /^([ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line))) return { len: m[0].length, kind: m[6] ? "task" : m[3] ? "ol" : "ul", match: m };
		if ((m = /^( {0,3}>[ \t]?)+/.exec(line))) return { len: m[0].length, kind: "quote", match: m };
		return undefined;
	}

	private enter(at: Range2): void {
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
	}

	/** Backspace just after a line's block syntax takes the syntax off, as Typora does. True when it did. */
	private backspaceAtLineStart(offset: number): boolean {
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
	}

	private keydown(event: KeyboardEvent): void {
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
	}

	/**
	 * Where the caret goes to step into a closed element whose source is hidden (a reference, inline
	 * maths, a picture) from just before it (`forward`) or just after it; undefined when there is none.
	 */
	private hiddenSourceAt(offset: number, forward: boolean): number | undefined {
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
	}

	private copy(event: ClipboardEvent, cut: boolean): void {
		const at = this.selection();
		if (!at || at.start === at.end) return;
		event.preventDefault();
		// The file's own characters, syntax and all, so pasting it elsewhere keeps its formatting.
		event.clipboardData?.setData("text/plain", this.sync.text.slice(at.start, at.end));
		if (cut && !this.sync.readOnly) this.apply([{ at: at.start, before: this.sync.text.slice(at.start, at.end), text: "" }], { start: at.start, end: at.start });
	}

	private paste(event: ClipboardEvent): void {
		event.preventDefault();
		if (this.sync.readOnly) return;
		const at = this.selection();
		const data = event.clipboardData?.getData("text/plain");
		if (at && data) this.replace(at, data.replace(/\r\n?/g, "\n"));
	}

	private drop(event: DragEvent): void {
		event.preventDefault();
		if (this.sync.readOnly) return;
		const data = event.dataTransfer?.getData("text/plain");
		const pos = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
		if (!data || !pos || !this.root.contains(pos.startContainer)) return;
		const at = this.offsetAt(pos.startContainer, pos.startOffset);
		this.replace({ start: at, end: at }, data);
	}

	private pressed(event: MouseEvent): void {
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
	}

	private clicked(event: MouseEvent): void {
		const link = (event.target as HTMLElement).closest<HTMLElement>("[data-href]");
		if (link && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			window.open(link.dataset.href, "_blank", "noopener");
		}
	}

	// --- the styling tools -------------------------------------------------------------------

	private delimiters(style: InlineStyle): [string, string] | undefined {
		if (this.tex) {
			const map: Partial<Record<InlineStyle, [string, string]>> = { bold: ["\\textbf{", "}"], italic: ["\\emph{", "}"], underline: ["\\underline{", "}"], code: ["\\texttt{", "}"], math: ["$", "$"], strike: ["\\sout{", "}"] };
			return map[style];
		}
		const map: Record<InlineStyle, [string, string]> = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], underline: ["<u>", "</u>"], code: ["`", "`"], mark: ["==", "=="], math: ["$", "$"] };
		return map[style];
	}

	private static readonly CLASS: Record<InlineStyle, string> = { bold: "lv-b", italic: "lv-em", strike: "lv-s", underline: "lv-u", code: "lv-code", mark: "lv-mark", math: "lv-math" };

	/** The drawn element of a style around an offset, with its place in the text. */
	private around(cls: string, at: Range2): { s: number; e: number; o: number; c: number } | undefined {
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
	}

	/** Bold, italic and the rest: taken off when the caret is in it, put round the selection or the word otherwise. */
	toggle(style: InlineStyle): void {
		if (this.sync.readOnly) return;
		const at = this.selection();
		const delims = this.delimiters(style);
		if (!at || !delims) return;
		const text = this.sync.text;
		const inside = this.around(LiveEditor.CLASS[style], at);
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
	}

	/** A link round the selection, with its address selected to type over; in a link, the link taken off. */
	link(): void {
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
	}

	/** Turn the lines of the selection into a heading, a list, a quote or a paragraph; pressed again, back to a paragraph. */
	setBlock(style: BlockStyle): void {
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
	}

	/** Whether an offset of a LaTeX file sits inside an itemize, enumerate or description list. */
	private inTexList(offset: number): boolean {
		const before = this.sync.text.slice(0, offset).replace(/(^|[^\\])%.*$/gm, "$1");
		const opened = (before.match(/\\begin\{(itemize|enumerate|description)\}/g) ?? []).length;
		const closed = (before.match(/\\end\{(itemize|enumerate|description)\}/g) ?? []).length;
		return opened > closed;
	}

	private codeBlock(at: Range2): void {
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
	}

	/** Put something of its own on a new line after the caret's block: a rule, a table, a maths block. */
	insertBlock(kind: "hr" | "table" | "math"): void {
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
	}
}

/** A range moved past splices that landed around it. */
function shiftRange<T extends Range2>(at: T, applied: readonly Splice[]): T {
	const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
	return { ...at, start: move(at.start), end: move(at.end) };
}
