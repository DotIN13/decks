// Indent: a line of code inside a block sits deeper than the line that opened the block. A cut function
// whose body was left at column 0 reads as two stories; the repo has no formatter to catch it.
// TypeScript and JavaScript in the new folders; strings, templates, comments and regular expressions are skipped.

const FOLDERS = ["server", "harness", "protocol", "clients", "tools", "engine", "canvas", "pen", "ui"];
const CODE = /\.(ts|tsx|mts|mjs|js)$/;
const SKIP = /(^|\/)(node_modules|dist|dist-gen|lib|pkg|target|fixtures)\/|\.d\.ts$|\.bundle\.|\.min\./;

export default {
	name: "indent",
	rule: "1. A file reads as one story: a line inside a block sits deeper than the line that opened it.",
	scan(ctx) {
		const counts = new Map();
		for (const file of ctx.files.filter((f) => FOLDERS.some((d) => f.startsWith(`${d}/`)) && CODE.test(f) && !SKIP.test(f))) {
			const n = shallowLines(ctx.read(file)).length;
			if (n) counts.set(`${file}: line shallower than its block`, n);
		}
		return { counts, notes: ["Tabs count as four spaces. A line that starts by closing a bracket, or inside a comment, string or template, is not measured."] };
	},
};

/** The line numbers (1-based) whose code sits at or above the indent of the line that opened their block. */
export function shallowLines(text) {
	const lines = text.split("\n");
	const out = [];
	const blocks = [];
	let mode = "code";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const t = line.trim();
		if (mode === "code" && t && blocks.length && !/^[}\])]/.test(t) && widthOf(line) <= blocks.at(-1).width) out.push(i + 1);
		mode = walk(line, mode, blocks, widthOf(line));
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
 * One line read through: its braces push and pop the open blocks (each remembers the indent of the line
 * that opened it). Answers the mode the line ends in: code, a block comment, or a template literal.
 */
function walk(line, mode, blocks, width) {
	for (let k = 0; k < line.length; k++) {
		const c = line[k];
		const d = line[k + 1];
		if (c === "\\") {
			k++;
			continue;
		}
		if (mode === "comment") {
			if (c === "*" && d === "/") (mode = "code"), k++;
			continue;
		}
		if (mode === "template") {
			if (c === "`") mode = "code";
			else if (c === "$" && d === "{") blocks.push({ template: true, width }), (mode = "code"), k++;
			continue;
		}
		if (c === "/" && d === "/") break;
		if (c === "/" && d === "*") {
			mode = "comment";
			k++;
			continue;
		}
		if (c === '"' || c === "'") {
			const end = closing(line, k, c);
			if (end > k) k = end;
			continue;
		}
		if (c === "/" && regexCanStart(line, k)) {
			k = regexEnd(line, k);
			continue;
		}
		if (c === "`") mode = "template";
		else if (c === "{") blocks.push({ width });
		else if (c === "}") {
			const open = blocks.pop();
			if (open?.template) mode = "template";
		}
	}
	return mode;
}

/** Where a quote closes on its line, or -1 when it does not (an apostrophe in words). */
function closing(line, at, quote) {
	for (let k = at + 1; k < line.length; k++) {
		if (line[k] === "\\") k++;
		else if (line[k] === quote) return k;
	}
	return -1;
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
