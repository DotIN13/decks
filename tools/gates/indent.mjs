// Indent: a line of code inside a block sits deeper than the line that opened the block, and in JSX a
// child (an element, an expression, words) sits deeper than the line its parent element opened on.
// A cut function or a reordered view left at its parent's indent reads as two stories; the repo has no formatter.

const FOLDERS = ["server", "harness", "protocol", "clients", "tools", "engine", "canvas", "pen", "ui"];
const CODE = /\.(ts|tsx|mts|mjs|js)$/;
const SKIP = /(^|\/)(node_modules|dist|dist-gen|lib|pkg|target|fixtures)\/|\.d\.ts$|\.bundle\.|\.min\./;

export default {
	name: "indent",
	rule: "1. A file reads as one story: a line inside a block, or a JSX child, sits deeper than what opened it.",
	scan(ctx) {
		const counts = new Map();
		for (const file of ctx.files.filter((f) => FOLDERS.some((d) => f.startsWith(`${d}/`)) && CODE.test(f) && !SKIP.test(f))) {
			const { blocks, jsx } = shallow(ctx.read(file), file.endsWith(".tsx"));
			if (blocks.length) counts.set(`${file}: line shallower than its block`, blocks.length);
			if (jsx.length) counts.set(`${file}: JSX child level with its parent`, jsx.length);
		}
		return { counts, notes: ["Tabs count as four spaces. A line that starts by closing a bracket or a tag, or inside a comment, string or template, is not measured."] };
	},
};

/** The line numbers (1-based) whose code sits at or above the indent of the line that opened their block. */
export function shallowLines(text) {
	return shallow(text, false).blocks;
}

/** The line numbers (1-based) of JSX children at or above the indent of the line their parent element opened on. */
export function shallowJsx(text) {
	return shallow(text, true).jsx;
}

/** Both readings of one file: lines shallower than their block, and (in JSX) children level with their parent. */
function shallow(text, jsx) {
	const lines = text.split("\n");
	const out = { blocks: [], jsx: [] };
	const st = { mode: "code", blocks: [], elements: [], tag: undefined, jsx };
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const t = line.trim();
		const width = widthOf(line);
		if (st.mode === "code" && t) {
			if (st.blocks.length && !/^[}\])]/.test(t) && width <= st.blocks.at(-1).width) out.blocks.push(i + 1);
			// Inside an element opened on an earlier line, and not inside a block opened after it or a tag's attributes.
			const parent = st.elements.at(-1);
			if (!st.tag && parent && parent.depth === st.blocks.length && !t.startsWith("</") && width <= parent.width) out.jsx.push(i + 1);
		}
		walk(line, st, width);
	}
	return out;
}

/** How far a line is indented: a tab is four spaces. */
function widthOf(line) {
	let n = 0;
	for (const c of line) {
		if (c === "\t") n += 4;
		else if (c === " ") n++;
		else break;
	}
	return n;
}

/**
 * One line read through. Braces push and pop the open blocks; in JSX, an opening tag that is not closed
 * by /> pushes an element and a closing tag pops it, each remembering the indent of the line it opened on
 * and the block depth it stands in. Comments, strings, templates and regular expressions are passed over.
 */
function walk(line, st, width) {
	for (let k = 0; k < line.length; k++) {
		const c = line[k];
		const d = line[k + 1];
		if (c === "\\") {
			k++;
			continue;
		}
		if (st.mode === "comment") {
			if (c === "*" && d === "/") (st.mode = "code"), k++;
			continue;
		}
		if (st.mode === "template") {
			if (c === "`") st.mode = "code";
			else if (c === "$" && d === "{") st.blocks.push({ template: true, width }), (st.mode = "code"), k++;
			continue;
		}
		if (c === "/" && d === "/" && !st.tag) break;
		if (c === "/" && d === "*") {
			st.mode = "comment";
			k++;
			continue;
		}
		if (c === '"' || c === "'") {
			const end = closing(line, k, c);
			if (end > k) k = end;
			continue;
		}
		// The end of an opening tag: at the brace depth it began in, so an arrow in an attribute is passed over.
		if (st.tag && c === ">" && st.blocks.length === st.tag.depth) {
			if (line[k - 1] !== "/") st.elements.push({ width: st.tag.width, depth: st.blocks.length });
			st.tag = undefined;
			continue;
		}
		if (st.jsx && !st.tag && c === "<" && jsxCanStart(line, k, inElement(st))) {
			if (d === "/") {
				st.elements.pop();
				k = line.indexOf(">", k);
				if (k < 0) k = line.length;
			} else st.tag = { width, depth: st.blocks.length };
			continue;
		}
		if (c === "/" && !st.tag && regexCanStart(line, k)) {
			k = regexEnd(line, k);
			continue;
		}
		if (c === "`") st.mode = "template";
		else if (c === "{") st.blocks.push({ width });
		else if (c === "}") {
			const open = st.blocks.pop();
			if (open?.template) st.mode = "template";
		}
	}
}

/** Where a quote closes on its line, or -1 when it does not (an apostrophe in words). */
function closing(line, at, quote) {
	for (let k = at + 1; k < line.length; k++) {
		if (line[k] === "\\") k++;
		else if (line[k] === quote) return k;
	}
	return -1;
}

/**
 * Whether a < here begins a JSX tag: followed by a name, a fragment's > or a closing slash, and among an
 * element's children or where an expression may start (a line's start, after an operator, an opening bracket
 * or return): not a generic type (Array<string>) or a comparison (a < b).
 */
function jsxCanStart(line, at, amongChildren) {
	if (!/^<(\/?[A-Za-z>]|>)/.test(line.slice(at))) return false;
	// Among an element's children a tag may follow anything: words, or another tag.
	if (amongChildren) return true;
	const before = line.slice(0, at).trimEnd();
	return before === "" || /[(,=:?{}&|>]$/.test(before) || /\breturn$/.test(before);
}

/** Whether the walk stands among an element's children: inside one, and not inside a block opened within it. */
function inElement(st) {
	const parent = st.elements.at(-1);
	return !!parent && parent.depth === st.blocks.length;
}

/** Whether a / here starts a regular expression: after an operator, an opening bracket, a keyword, or nothing. */
function regexCanStart(line, at) {
	const before = line.slice(0, at).trimEnd();
	// Not after < or } : in JSX that slash closes a tag (</a>, {x}/>).
	return before === "" || /[(,=:[!&|?{;+\-*%~^]$/.test(before) || /\b(return|typeof|case|in|of|delete|void|throw)$/.test(before);
}

/** Where a regular expression that starts at `at` ends: its closing /, past escapes and character classes. */
function regexEnd(line, at) {
	let inClass = false;
	for (let k = at + 1; k < line.length; k++) {
		const c = line[k];
		if (c === "\\") k++;
		else if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) return k;
	}
	return line.length;
}
