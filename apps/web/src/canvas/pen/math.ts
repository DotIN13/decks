/**
 * Formulas in a drawing's words: TeX between `$…$` (in a line) and `$$…$$` (set as a display formula:
 * on a line of its own in a card, in place in a plain text), as Obsidian and GitHub read them, typeset by
 * MathJax into outlines the C++ engine fills like any shape.
 *
 * A formula travels in text as one character from Unicode's private-use plane, U+F0000 plus its number
 * (`formulaText`), so the words of a text or a card carry it wherever they go: the engine measures that
 * character as the formula's box and draws its paths there (`packages/engine/cpp/math.cpp`). An engine is
 * handed each formula once (`handFormulas`) before it measures words that carry it. Only the engine draws
 * formulas; CanvasKit shows their TeX as it is written.
 *
 * Nothing here touches a page: MathJax runs on its own small DOM, so this works in the worker and on the
 * server alike, and both measure a formula the same.
 */
/** A formula typeset: its box from the baseline, and its outlines with their placement and colour. */
export interface Formula {
	number: number;
	width: number;
	ascent: number;
	descent: number;
	paths: ReadonlyArray<{ m: readonly number[]; rgba: readonly number[]; d: string }>;
}
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor, type LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

export const MATH_FIRST = 0xf0000;
const MATH_LAST = 0xffffd;

type Node = unknown;
let adaptor: LiteAdaptor | undefined;
let mathDocument: { convert(tex: string, options: Record<string, unknown>): Node } | undefined;
function typesetter() {
	if (!mathDocument) {
		adaptor = liteAdaptor();
		RegisterHTMLHandler(adaptor);
		mathDocument = mathjax.document("", { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: "none" }) }) as never;
	}
	return { doc: mathDocument!, dom: adaptor! };
}

/** Each formula's number, by how it is shown and its TeX; and each number's formula, typeset once. */
const numbers = new Map<string, number>();
const formulas = new Map<number, Formula>();

/** The character a formula travels as, typesetting it the first time it is asked for. */
export function formulaChar(tex: string, display: boolean): string {
	const key = `${display ? "D" : "I"}${tex}`;
	let number = numbers.get(key);
	if (number === undefined) {
		number = numbers.size;
		if (MATH_FIRST + number > MATH_LAST) return tex;
		numbers.set(key, number);
		formulas.set(number, typeset(number, tex, display));
	}
	return String.fromCodePoint(MATH_FIRST + number);
}

/** The formula a character stands for, if it is one. */
export function formulaOf(cp: number): Formula | undefined {
	return cp >= MATH_FIRST && cp <= MATH_LAST ? formulas.get(cp - MATH_FIRST) : undefined;
}

/** Hand every formula `text` carries to an engine that has not had it yet. */
const handed = new WeakMap<object, Set<number>>();
export function handFormulas(text: string, engine: { math(formula: Formula): void }): void {
	let seen = handed.get(engine);
	for (const ch of text) {
		const cp = ch.codePointAt(0)!;
		if (cp < MATH_FIRST || cp > MATH_LAST) continue;
		const formula = formulas.get(cp - MATH_FIRST);
		if (!formula) continue;
		if (!seen) handed.set(engine, (seen = new Set()));
		if (seen.has(formula.number)) continue;
		seen.add(formula.number);
		engine.math(formula);
	}
}

/**
 * A text's words with each formula in them turned into its character: `$$…$$` set as a display formula
 * and `$…$` in the line, read as Obsidian reads them, so "$5 and $10" stays money: the opening `$` is
 * followed by something other than a space, the closing one follows something other than a space and
 * is not followed by a digit, and `\$` is a dollar sign.
 */
export function formulaText(text: string): string {
	if (!text.includes("$")) return text;
	let out = "";
	for (let i = 0; i < text.length; ) {
		const ch = text[i]!;
		if (ch === "\\" && text[i + 1] === "$") {
			out += "$";
			i += 2;
			continue;
		}
		if (ch !== "$") {
			out += ch;
			i++;
			continue;
		}
		if (text[i + 1] === "$") {
			const end = text.indexOf("$$", i + 2);
			const tex = end > i + 2 ? text.slice(i + 2, end).trim() : "";
			if (tex) {
				out += formulaChar(tex, true);
				i = end + 2;
				continue;
			}
		} else {
			const end = closing(text, i + 1);
			if (end > 0) {
				out += formulaChar(text.slice(i + 1, end), false);
				i = end + 1;
				continue;
			}
		}
		out += ch;
		i++;
	}
	return out;
}

/** Where the `$` that closes an inline formula opened just before `from` is, or -1. */
function closing(text: string, from: number): number {
	if (from >= text.length || /\s/.test(text[from]!)) return -1;
	for (let k = from + 1; k < text.length; k++) {
		const c = text[k]!;
		if (c === "\n") return -1;
		if (c === "\\") {
			k++;
			continue;
		}
		if (c === "$" && !/\s/.test(text[k - 1]!) && !/\d/.test(text[k + 1] ?? "")) return k;
	}
	return -1;
}

/* ---------- MathJax's outlines, read from its own DOM ---------- */

type Matrix = [number, number, number, number, number, number];
const times = (p: Matrix, t: Matrix): Matrix => [p[0] * t[0] + p[2] * t[1], p[1] * t[0] + p[3] * t[1], p[0] * t[2] + p[2] * t[3], p[1] * t[2] + p[3] * t[3], p[0] * t[4] + p[2] * t[5] + p[4], p[1] * t[4] + p[3] * t[5] + p[5]];

/** An SVG `transform` attribute's translate, scale and matrix steps, in order. */
function transformOf(value: string | undefined): Matrix {
	let m: Matrix = [1, 0, 0, 1, 0, 0];
	if (!value) return m;
	for (const [, kind, args] of value.matchAll(/(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g)) {
		const n = args!.split(/[\s,]+/).filter(Boolean).map(Number);
		if (kind === "translate") m = times(m, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
		else if (kind === "scale") m = times(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
		else if (kind === "matrix" && n.length === 6) m = times(m, n as Matrix);
		else if (kind === "rotate") {
			const r = ((n[0] ?? 0) * Math.PI) / 180;
			m = times(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
		}
	}
	return m;
}

const NAMED: Record<string, number[]> = {
	black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], orange: [1, 0.65, 0], purple: [0.5, 0, 0.5], brown: [0.65, 0.16, 0.16], pink: [1, 0.75, 0.8],
};
/** A colour MathJax wrote (`\color`), as r g b a from 0 to 1; the words' colour is alpha -1. */
function colourOf(value: string | undefined): number[] {
	if (!value || value === "currentColor" || value === "inherit") return [0, 0, 0, -1];
	const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (hex) {
		const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
		return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1];
	}
	const rgb = value.match(/^rgba?\(([^)]*)\)$/);
	if (rgb) {
		const n = rgb[1]!.split(/[\s,]+/).map(Number);
		return [(n[0] ?? 0) / 255, (n[1] ?? 0) / 255, (n[2] ?? 0) / 255, n[3] ?? 1];
	}
	const named = NAMED[value.toLowerCase()];
	return named ? [...named, 1] : [0, 0, 0, -1];
}

function typeset(number: number, tex: string, display: boolean): Formula {
	const { doc, dom } = typesetter();
	const empty: Formula = { number, width: 0, ascent: 0, descent: 0, paths: [] };
	let node: Node;
	try {
		node = doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
	} catch {
		return empty;
	}
	const kids = (n: Node) => dom.childNodes(n as never) as Node[];
	const tag = (n: Node) => dom.kind(n as never);
	const attr = (n: Node, name: string) => (dom.getAttribute(n as never, name) as string | undefined) ?? undefined;
	const svg = kids(node).find((n) => tag(n) === "svg");
	const box = attr(svg, "viewBox")?.split(/\s+/).map(Number);
	if (!svg || !box || box.length !== 4) return empty;
	const [minX, minY, w, h] = box as [number, number, number, number];
	const paths: Array<{ m: number[]; rgba: number[]; d: string }> = [];
	// From MathJax's units (a thousandth of an em, y down in the SVG) to ems from the formula's left end.
	const walk = (n: Node, m: Matrix, fill: number[]) => {
		const kind = tag(n);
		if (kind === "#text" || kind === "#comment") return;
		const here = times(m, transformOf(attr(n, "transform")));
		const ownFill = attr(n, "fill");
		const colour = ownFill ? colourOf(ownFill) : fill;
		if (kind === "path") {
			const d = attr(n, "d");
			if (d) paths.push({ m: here, rgba: colour, d });
			return;
		}
		if (kind === "rect") {
			const x = Number(attr(n, "x") ?? 0), y = Number(attr(n, "y") ?? 0), rw = Number(attr(n, "width") ?? 0), rh = Number(attr(n, "height") ?? 0);
			if (rw > 0 && rh > 0) paths.push({ m: here, rgba: colour, d: `M${x} ${y}H${x + rw}V${y + rh}H${x}Z` });
			return;
		}
		for (const child of kids(n)) walk(child, here, colour);
	};
	for (const child of kids(svg)) walk(child, [1 / 1000, 0, 0, 1 / 1000, -minX / 1000, 0], [0, 0, 0, -1]);
	return { number, width: w / 1000, ascent: -minY / 1000, descent: (h + minY) / 1000, paths };
}
