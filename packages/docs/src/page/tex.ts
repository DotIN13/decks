/**
 * What a LaTeX page needs to know about the whole file to draw one block of it: the title block
 * that `\maketitle` sets, the number each `\label` stands for, the number each citation gets, and
 * the number of each equation, figure, table and theorem.
 *
 * Read from the source alone, the way a first LaTeX run would number things, without the .aux
 * file a real run writes: sections, equations, figures and tables are counted in order, and
 * citations are numbered in the order they are first cited (or by the order of `\bibitem`s, when
 * the file has its own bibliography).
 */

export type LabelKind = "section" | "equation" | "figure" | "table" | "theorem" | "item" | "other";

export interface TexMeta {
	title?: string;
	author?: string;
	date?: string;
	/** `\label` key -> what `\ref` prints, and what kind of thing it names. */
	labels: Map<string, { num: string; kind: LabelKind }>;
	/** Citation key -> its number. */
	cites: Map<string, number>;
	/** Offset of a `\begin{…}` -> the number its environment gets (equations, figures, tables, theorems). */
	numbers: Map<number, string>;
	/** The file's own macro definitions, written so KaTeX can read them at the head of each formula. */
	macros: string;
	/** One string that changes whenever anything above does, for keeping drawn blocks. */
	sig: string;
}

/** Environments that read as text with a heading of their own. */
export const THEOREMS: Record<string, string> = {
	theorem: "Theorem",
	lemma: "Lemma",
	proposition: "Proposition",
	corollary: "Corollary",
	definition: "Definition",
	remark: "Remark",
	example: "Example",
	conjecture: "Conjecture",
	assumption: "Assumption",
	claim: "Claim",
	hypothesis: "Hypothesis",
};

/** Text environments drawn as styled text, their `\begin` and `\end` lines hidden. */
export const TEXT_ENVS = new Set(["abstract", "quote", "quotation", "center", "flushleft", "flushright", "proof", "verse", ...Object.keys(THEOREMS)]);

/** The index of the brace closing the one at `open`, or -1. */
export function closeBraceAt(text: string, open: number): number {
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

/** The text with every comment blanked out, same length, so offsets still hold. */
export function blankComments(text: string): string {
	return text.replace(/(^|[^\\])(%[^\n]*)/g, (_m, lead: string, comment: string) => lead + " ".repeat(comment.length));
}

/** The argument of the first `\name{…}`, or undefined. */
function arg(text: string, name: string): string | undefined {
	const m = new RegExp(`\\\\${name}\\*?(\\[[^\\]]*\\])?\\{`).exec(text);
	if (!m) return undefined;
	const open = m.index + m[0].length - 1;
	const close = closeBraceAt(text, open);
	return close === -1 ? undefined : text.slice(open + 1, close);
}

export function texMeta(source: string): TexMeta {
	const text = blankComments(source);
	const labels: TexMeta["labels"] = new Map();
	const cites: TexMeta["cites"] = new Map();
	const numbers: TexMeta["numbers"] = new Map();
	const author = arg(text, "author");
	const meta: TexMeta = { labels, cites, numbers, macros: readMacros(text), sig: "" };
	const title = arg(text, "title");
	if (title !== undefined) meta.title = title;
	if (author !== undefined) meta.author = author;
	const date = arg(text, "date");
	if (date !== undefined) meta.date = date;

	const sec = [0, 0, 0, 0];
	const counts: Record<string, number> = {};
	let eq = 0;
	/** What a `\label` met now would name. */
	let current: { num: string; kind: LabelKind } = { num: "", kind: "other" };
	const stack: Array<{ env: string; restore: typeof current; multi: boolean }> = [];
	const levels: Record<string, number> = { chapter: 0, section: 1, subsection: 2, subsubsection: 3 };
	const token = /\\(chapter|section|subsection|subsubsection)(\*?)\s*(\[[^\]]*\])?\{|\\begin\{([a-zA-Z*]+)\}|\\end\{([a-zA-Z*]+)\}|\\label\{([^}]*)\}|\\\\(?!\\)|\\item\b|\\(?:no)?(?:cite[a-z]*|nocite)\*?(?:\[[^\]]*\])*\{([^}]*)\}|\\bibitem(?:\[[^\]]*\])?\{([^}]*)\}|\\nonumber|\\notag/g;
	let bibitems = 0;
	const bib = new Map<string, number>();
	for (let m = token.exec(text); m; m = token.exec(text)) {
		const [whole, heading, star, , begin, end, label, citeKeys, bibKey] = m;
		if (heading) {
			if (star) continue;
			const level = levels[heading]!;
			sec[level]!++;
			for (let k = level + 1; k < sec.length; k++) sec[k] = 0;
			const first = sec[0] ? 0 : 1;
			current = { num: sec.slice(first, level + 1).join("."), kind: "section" };
		} else if (begin) {
			const restore = current;
			const name = begin.replace(/\*$/, "");
			const starred = begin.endsWith("*");
			let multi = false;
			if (["equation", "align", "gather", "multline", "eqnarray", "flalign", "alignat"].includes(name) && !starred) {
				eq++;
				current = { num: String(eq), kind: "equation" };
				numbers.set(m.index, String(eq));
				multi = name !== "equation" && name !== "multline";
			} else if (name === "figure" || name === "table") {
				counts[name] = (counts[name] ?? 0) + 1;
				current = { num: String(counts[name]), kind: name };
				numbers.set(m.index, String(counts[name]));
			} else if (THEOREMS[name]) {
				counts[name] = (counts[name] ?? 0) + 1;
				current = { num: String(counts[name]), kind: "theorem" };
				if (!starred) numbers.set(m.index, String(counts[name]));
			} else if (name === "enumerate") {
				counts.enumi = 0;
			}
			stack.push({ env: begin, restore, multi });
		} else if (end) {
			const top = stack.pop();
			if (top && !["figure", "table", "equation", "align", "gather", "multline", "eqnarray", "flalign", "alignat"].includes(top.env.replace(/\*$/, "")) && !THEOREMS[top.env.replace(/\*$/, "")]) continue;
			if (top) current = top.restore;
		} else if (label !== undefined) {
			labels.set(label.trim(), { ...current });
		} else if (whole === "\\\\") {
			// A new row of a numbered alignment is a new equation.
			const top = stack.at(-1);
			if (top?.multi) {
				eq++;
				current = { num: String(eq), kind: "equation" };
			}
		} else if (whole.startsWith("\\nonumber") || whole.startsWith("\\notag")) {
			if (stack.at(-1)?.multi) eq--;
		} else if (whole === "\\item") {
			if (stack.at(-1)?.env === "enumerate") {
				counts.enumi = (counts.enumi ?? 0) + 1;
				current = { num: String(counts.enumi), kind: "item" };
			}
		} else if (citeKeys !== undefined) {
			for (const key of citeKeys.split(",").map((k) => k.trim()).filter(Boolean)) if (!cites.has(key)) cites.set(key, cites.size + 1);
		} else if (bibKey !== undefined) {
			bib.set(bibKey.trim(), ++bibitems);
		}
	}
	// A bibliography written in the file numbers citations by its own order.
	if (bib.size) {
		const ordered = new Map<string, number>();
		for (const key of cites.keys()) ordered.set(key, bib.get(key) ?? 0);
		meta.cites = ordered;
	}
	meta.sig = JSON.stringify([meta.title, meta.author, meta.date, [...labels], [...meta.cites], [...numbers.values()], meta.macros]);
	return meta;
}

export interface TabularCell {
	text: string;
	span: number;
	align: string;
}

/** A tabular's rows of cells, with where the rules go, read from its body and column spec. */
export function readTabular(spec: string, body: string): { rows: TabularCell[][]; rules: number[] } {
	const aligns = [...spec.replace(/\{[^}]*\}/g, "").replace(/[|@!>< ]/g, "")].map((c) => (c === "c" ? "center" : c === "r" ? "right" : "left"));
	const rows: TabularCell[][] = [];
	const rules: number[] = [];
	const lines = body.split(/\\\\(?:\[[^\]]*\])?/);
	for (const raw of lines) {
		let line = raw;
		if (/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\})/.test(line)) rules.push(rows.length);
		line = line.replace(/\\(hline|toprule|midrule|bottomrule)/g, "").replace(/\\(cline|cmidrule)(\([^)]*\))?\{[^}]*\}/g, "").trim();
		if (!line) continue;
		const cells = line.split(/(?<!\\)&/);
		let column = 0;
		rows.push(
			cells.map((cell) => {
				const multi = /^\s*\\multicolumn\{(\d+)\}\{([^}]*)\}\{([\s\S]*)\}\s*$/.exec(cell);
				const span = multi ? Number(multi[1]) : 1;
				const align = multi ? (/c/.test(multi[2]!) ? "center" : /r/.test(multi[2]!) ? "right" : "left") : (aligns[column] ?? "left");
				column += span;
				return { text: (multi ? multi[3]! : cell).trim(), span, align };
			}),
		);
	}
	return { rows, rules };
}

/**
 * Every `\newcommand`, `\renewcommand`, `\providecommand`, `\def` and `\DeclareMathOperator` in
 * the file, as `\def`s KaTeX reads at the head of a formula. A `\def` always takes, so the file's
 * meaning wins over a command KaTeX already has (`\vec`, `\R`), as it does in LaTeX. An operator
 * becomes `\operatorname`, which is what it means. A default for an optional argument, which
 * KaTeX cannot read, drops that one definition rather than every formula.
 */
export function readMacros(text: string): string {
	const out: string[] = [];
	const named = /\\(newcommand|renewcommand|providecommand)\*?\s*(\{\\[a-zA-Z@]+\}|\\[a-zA-Z@]+)\s*(\[\d\])?\s*(\[[^\]]*\])?\s*\{/g;
	for (let m = named.exec(text); m; m = named.exec(text)) {
		const open = m.index + m[0].length - 1;
		const close = closeBraceAt(text, open);
		if (close === -1) continue;
		named.lastIndex = close + 1;
		if (m[4]) continue;
		const name = m[2]!.replace(/^\{|\}$/g, "");
		const args = Number(m[3]?.slice(1, -1) ?? 0);
		out.push(`\\def${name}${Array.from({ length: args }, (_, i) => `#${i + 1}`).join("")}{${text.slice(open + 1, close)}}`);
	}
	const def = /\\def\s*(\\[a-zA-Z@]+)((?:#\d)*)\s*\{/g;
	for (let m = def.exec(text); m; m = def.exec(text)) {
		const open = m.index + m[0].length - 1;
		const close = closeBraceAt(text, open);
		if (close === -1) continue;
		def.lastIndex = close + 1;
		out.push(`\\def${m[1]}${m[2]}{${text.slice(open + 1, close)}}`);
	}
	const op = /\\DeclareMathOperator(\*?)\s*\{?(\\[a-zA-Z@]+)\}?\s*\{/g;
	for (let m = op.exec(text); m; m = op.exec(text)) {
		const open = m.index + m[0].length - 1;
		const close = closeBraceAt(text, open);
		if (close === -1) continue;
		op.lastIndex = close + 1;
		out.push(`\\def${m[2]}{\\operatorname${m[1]}{${text.slice(open + 1, close)}}}`);
	}
	return out.join("");
}

/** A formula with the file's macros defined at its head, inside its own delimiters. */
export function withMacros(formula: string, macros: string): string {
	if (!macros) return formula;
	for (const [open, close] of [["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"]] as const) {
		const t = formula.trim();
		if (t.startsWith(open) && t.endsWith(close) && t.length >= open.length + close.length) return `${open}${macros}${t.slice(open.length, t.length - close.length)}${close}`;
	}
	return formula;
}
