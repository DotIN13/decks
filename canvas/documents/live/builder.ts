import { blocks } from "../blocks.ts";
import { readTabular, TEXT_ENVS, THEOREMS, withMacros, type TexMeta } from "../tex.ts";

/** How a document's source is drawn as blocks: the Builder, and the small elements it makes. */

/** Text drawn into its element up to an index; a reader calls it before drawing what it found. */
type Flush = (to: number) => void;

/** One line of a block: its text, where it starts in the file, and whether a newline ends it. */
type Line = { text: string; s: number; nl: boolean };

/** What a reader found at an index: drawn up to end, a run to skip, or nothing (plain text). */
type Step = { end: number } | { skip: number } | undefined;

/** Builds one block's elements from its source. */
export class Builder {
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
		while (i < text.length) {
			const step = this.mdStep(text, at, i, into, flush);
			if (step === undefined) i++;
			else if ("skip" in step) i += step.skip;
			else i = plain = step.end;
		}
		flush(text.length);
	}

	/** What the markdown at i is: drawn up to end, a run to skip, or plain text (undefined). */
	private mdStep(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		const c = text[i]!;
		if (c === "\\" && i + 1 < text.length && PUNCT.test(text[i + 1]!)) {
			flush(i);
			into.append(mk("\\"), text[i + 1]!);
			return { end: i + 2 };
		}
		if (c === "`") return this.mdCode(text, at, i, into, flush);
		const found =
			(c === "!" && text[i + 1] === "[" ? this.mdImage(text, at, i, into, flush) : undefined) ??
			(c === "[" && text[i + 1] === "^" ? this.mdNote(text, i, into, flush) : undefined) ??
			(c === "[" ? this.mdLink(text, at, i, into, flush) : undefined) ??
			(c === "$" ? this.mdMath(text, at, i, into, flush) : undefined) ??
			(c === "<" ? this.mdAngle(text, at, i, into, flush) : undefined) ??
			((c === "h" || c === "w") && (i === 0 || !isWord(text[i - 1])) ? this.mdBare(text, i, into, flush) : undefined);
		if (found) return found;
		if (c === "*" || c === "_" || c === "~" || c === "=") {
			let n = 1;
			while (text[i + n] === c) n++;
			const used = this.emphasis(text, at, i, c, n, into, flush);
			return used ? { end: used } : { skip: n };
		}
		return undefined;
	}

	/** Code between runs of backticks; an unmatched run is skipped whole. */
	private mdCode(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		let n = 1;
		while (text[i + n] === "`") n++;
		const ticks = "`".repeat(n);
		let close = text.indexOf(ticks, i + n);
		while (close !== -1 && text[close + n] === "`") close = text.indexOf(ticks, close + n + 1);
		if (!(close > i + n - 1 && close !== -1)) return { skip: n };
		flush(i);
		const node = inl("code", "lv-code", at + i, at + close + n, n, n);
		node.append(mk(ticks), text.slice(i + n, close), mk(ticks));
		into.append(node);
		return { end: close + n };
	}

	private mdImage(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		const link = linkAt(text, i + 1);
		if (!link) return undefined;
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
		return { end: link.end };
	}

	private mdNote(text: string, i: number, into: HTMLElement, flush: Flush): Step {
		const close = text.indexOf("]", i);
		if (close === -1) return undefined;
		flush(i);
		into.append(h("sup", "lv-fn", text.slice(i, close + 1)));
		return { end: close + 1 };
	}

	private mdLink(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		const link = linkAt(text, i);
		if (!link) return undefined;
		flush(i);
		const node = inl("a", "lv-a", at + i, at + link.end, 1, link.end - link.label[1]);
		node.dataset.href = text.slice(link.url[0], link.url[1]).trim().split(/\s+/)[0]!.replace(/^<|>$/g, "");
		node.append(mk("["));
		this.inlineMd(text.slice(link.label[0], link.label[1]), at + link.label[0], node);
		node.append(mk(text.slice(link.label[1], link.end)));
		into.append(node);
		return { end: link.end };
	}

	/** $maths$ (not before a digit, not around a space) or $$maths$$. */
	private mdMath(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		if (text[i + 1] !== "$" && !isSpace(text[i + 1])) {
			let close = text.indexOf("$", i + 1);
			while (close !== -1 && (text[close - 1] === "\\" || isSpace(text[close - 1]))) close = text.indexOf("$", close + 1);
			if (close === -1 || /\d/.test(text[close + 1] ?? "")) return undefined;
			flush(i);
			this.math(text.slice(i, close + 1), at + i, at + close + 1, 1, into);
			return { end: close + 1 };
		}
		if (text[i + 1] !== "$") return undefined;
		const close = text.indexOf("$$", i + 2);
		if (!(close > i + 2)) return undefined;
		flush(i);
		this.math(text.slice(i, close + 2), at + i, at + close + 2, 2, into);
		return { end: close + 2 };
	}

	/** An autolink, an HTML pair (u, sub, sup, kbd, mark), or any other tag or comment. */
	private mdAngle(text: string, at: number, i: number, into: HTMLElement, flush: Flush): Step {
		const rest = text.slice(i);
		const auto = /^<((?:https?|mailto):[^\s<>]+)>/.exec(rest);
		if (auto) {
			flush(i);
			const node = inl("a", "lv-a", at + i, at + i + auto[0].length, 1, 1);
			node.dataset.href = auto[1]!;
			node.append(mk("<"), auto[1]!, mk(">"));
			into.append(node);
			return { end: i + auto[0].length };
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
			return { end };
		}
		const tag = /^<\/?[a-zA-Z][^<>]*>|^<!--[\s\S]*?-->/.exec(rest);
		if (!tag) return undefined;
		flush(i);
		into.append(h("span", "lv-tag", tag[0]));
		return { end: i + tag[0].length };
	}

	/** A bare http(s):// or www. address. */
	private mdBare(text: string, i: number, into: HTMLElement, flush: Flush): Step {
		const url = /^(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]]/.exec(text.slice(i));
		if (!url) return undefined;
		flush(i);
		const node = h("a", "lv-a lv-bare", url[0]);
		node.dataset.href = url[0].startsWith("www.") ? `https://${url[0]}` : url[0];
		into.append(node);
		return { end: i + url[0].length };
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
		while (i < text.length) {
			const end = this.texStep(text, at, i, into, flush);
			if (end === undefined) i++;
			else i = plain = end;
		}
		flush(text.length);
	}

	/** What the LaTeX at i is: drawn up to the index answered, or plain text (undefined). */
	private texStep(text: string, at: number, i: number, into: HTMLElement, flush: Flush): number | undefined {
		const c = text[i]!;
		if (c === "%") {
			flush(i);
			into.append(h("span", "lv-comment", text.slice(i)));
			return text.length;
		}
		if (c === "\\") {
			const drawn = this.texBackslash(text, at, i, into, flush);
			if (drawn !== undefined) return drawn;
		}
		if (c === "$") {
			const two = text[i + 1] === "$";
			const close = two ? text.indexOf("$$", i + 2) : text.indexOf("$", i + 1);
			if (close !== -1 && close > i + (two ? 2 : 1)) {
				flush(i);
				const end = close + (two ? 2 : 1);
				this.math(text.slice(i, end), at + i, at + end, two ? 2 : 1, into);
				return end;
			}
		}
		if (c === "{" || c === "}") {
			flush(i);
			into.append(h("span", "lv-brace", c));
			return i + 1;
		}
		if (c === "~") {
			// A tie is a space that does not break: drawn as a space, the tilde itself shown only on the open line.
			flush(i);
			into.append(h("span", "lv-tilde", "~"));
			return i + 1;
		}
		return undefined;
	}

	/** A backslash: a named command, \( maths \), a line break, or an escaped character. */
	private texBackslash(text: string, at: number, i: number, into: HTMLElement, flush: Flush): number | undefined {
		const name = /^\\([a-zA-Z]+)\*?/.exec(text.slice(i));
		if (name) return this.texCommand(text, at, i, name, into, flush);
		if (text[i + 1] === "(") {
			const close = text.indexOf("\\)", i + 2);
			if (close !== -1) {
				flush(i);
				this.math(text.slice(i, close + 2), at + i, at + close + 2, 2, into);
				return close + 2;
			}
		}
		if (text[i + 1] === "\\") {
			flush(i);
			into.append(h("span", "lv-cmd", "\\\\"));
			return i + 2;
		}
		if (i + 1 < text.length) {
			flush(i);
			into.append(mk("\\"), text[i + 1]!);
			return i + 2;
		}
		return undefined;
	}

	/** A named command: styled text, a link, a reference or label, or any other command as itself. */
	private texCommand(text: string, at: number, i: number, name: RegExpExecArray, into: HTMLElement, flush: Flush): number {
		const cmd = name[1]!;
		const after = i + name[0].length;
		const drawn = this.texStyled(text, at, i, cmd, after, into, flush) ?? this.texLink(text, at, i, cmd, after, into, flush) ?? this.texRef(text, at, i, cmd, after, into, flush);
		if (drawn !== undefined) return drawn;
		flush(i);
		into.append(h("span", "lv-cmd", name[0]));
		return after;
	}

	private texStyled(text: string, at: number, i: number, cmd: string, after: number, into: HTMLElement, flush: Flush): number | undefined {
		const style = TEX_STYLE[cmd];
		if (!style || text[after] !== "{") return undefined;
		const close = closeBrace(text, after);
		if (close === -1) return undefined;
		flush(i);
		const node = inl(style[0], style[1], at + i, at + close + 1, after + 1 - i, 1);
		node.append(mk(text.slice(i, after + 1)));
		this.inlineTex(text.slice(after + 1, close), at + after + 1, node);
		node.append(mk("}"));
		into.append(node);
		return close + 1;
	}

	private texLink(text: string, at: number, i: number, cmd: string, after: number, into: HTMLElement, flush: Flush): number | undefined {
		if ((cmd !== "href" && cmd !== "url") || text[after] !== "{") return undefined;
		const close = closeBrace(text, after);
		const second = cmd === "href" && text[close + 1] === "{" ? closeBrace(text, close + 1) : -1;
		if (!(close !== -1 && (cmd === "url" || second !== -1))) return undefined;
		flush(i);
		const end = cmd === "url" ? close + 1 : second + 1;
		const open = cmd === "url" ? after + 1 - i : close + 2 - i;
		const node = inl("a", "lv-a", at + i, at + end, open, 1);
		node.dataset.href = text.slice(after + 1, close);
		node.append(mk(text.slice(i, i + open)));
		this.inlineTex(text.slice(i + open, end - 1), at + i + open, node);
		node.append(mk("}"));
		into.append(node);
		return end;
	}

	private texRef(text: string, at: number, i: number, cmd: string, after: number, into: HTMLElement, flush: Flush): number | undefined {
		if (!TEX_REF.test(cmd) || !/^(\[[^\]]*\])*\{/.test(text.slice(after))) return undefined;
		const brace = text.indexOf("{", after);
		const close = closeBrace(text, brace);
		if (close === -1) return undefined;
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
		return close + 1;
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
		if (this.texHeading(text, s, node) || this.texItem(text, s, node, prefix, body)) return;
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
		if (this.texTextEnv(text, s, node)) return;
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

	/** A sectioning command's line: a heading of its level. */
	private texHeading(text: string, s: number, node: HTMLElement): boolean {
		const m = /^(\s*)\\([a-zA-Z]+)\*?(\[[^\]]*\])?\{/.exec(text);
		if (m && TEX_HEADING[m[2]!] !== undefined) {
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
				return true;
			}
		}
		return false;
	}

	/** An \\item: a bullet, or a number LaTeX gives. */
	private texItem(text: string, s: number, node: HTMLElement, prefix: (len: number) => void, body: (len: number) => void): boolean {
		const m = /^(\s*)\\item(\[[^\]]*\])?[ \t]*/.exec(text);
		if (m) {
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
			return true;
		}
		return false;
	}

	/** A text environment's \\begin or \\end line (a theorem, a proof): its heading, or the proof's end. */
	private texTextEnv(text: string, s: number, node: HTMLElement): boolean {
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
			return true;
		}
		return false;
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
		const fence = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)/.exec(head);
		if (kind === "preamble" || (!this.tex && first && /^---\s*$/.test(head) && body.length > 1)) {
			node.dataset.kind = "front";
			node.append(this.raw("lv-src lv-frontbox", body));
			const chip = widget("div", "lv-chip", "open");
			chip.textContent = kind === "preamble" ? `Preamble, ${body.length} lines` : "Front matter";
			node.append(chip);
		} else if (!this.tex && fence) {
			node.dataset.kind = "code";
			node.append(this.codeBox(body, fence));
		} else if (MATH_ENV.test(head) && (this.tex || head.trim() === "$$")) {
			node.dataset.kind = "math";
			node.append(this.mathBox(body, head));
		} else if (this.tex && /^\s*\\begin\{(figure|table|tabular)\*?\}/.test(head)) {
			// A figure or a table is drawn beside its source, which shows while the caret is in it.
			node.dataset.kind = "float";
			const box = h("div", "lv-floatbox");
			box.append(this.raw("lv-src", body), this.float(body.map((l) => l.text).join("\n"), this.base + (body[0]?.s ?? 0) + (/^\s*/.exec(head)![0].length)));
			node.append(box);
		} else if (!this.tex && body.length >= 2 && head.includes("|") && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(body[1]!.text)) {
			node.dataset.kind = "table";
			const box = h("div", "lv-tablebox");
			box.append(this.raw("lv-src", body));
			box.append(this.table(body.map((l) => l.text)));
			node.append(box);
		} else if (!this.tex && /^ {0,3}<([a-zA-Z][\w-]*|!--)/.test(head)) {
			node.dataset.kind = "html";
			node.append(this.raw("lv-htmlbox", body));
		} else if (this.tex && /^\s*\\begin\{(verbatim|lstlisting|minted|tikzpicture|algorithm)/.test(head)) {
			node.dataset.kind = "env";
			node.append(this.raw("lv-envbox", body));
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

	/** Lines shown as they are written, each a row of its own. */
	private raw(cls: string, list: Line[]): HTMLElement {
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
	}

	/** A fenced code block: its fences shown as syntax, its language beside it. */
	private codeBox(body: Line[], fence: RegExpExecArray): HTMLElement {
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
		return box;
	}

	/** Display maths: its source, and KaTeX's drawing with the number it has in the whole file. */
	private mathBox(body: Line[], head: string): HTMLElement {
		const box = h("div", "lv-mathbox");
		box.append(this.raw("lv-src", body));
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
		return box;
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

// --- LaTeX the Builder knows ---

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

// --- the small elements it makes ---

export const PUNCT = /[!-/:-@[-`{-~]/;

export const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

export const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
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
