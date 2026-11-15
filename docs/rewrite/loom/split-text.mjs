// The parts of a Rust or CSS file for split.mjs, found by braces rather than a parser.
// Strings and comments are blanked first, so a brace inside one is not counted.

const blank = (line) => line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)'/g, "''").replace(/\/\/.*$/, "");

/** Each line's brace depth at its start, for Rust and CSS alike. */
function depths(lines, css) {
	const out = [];
	let d = 0;
	let inBlock = false;
	for (const raw of lines) {
		out.push(d);
		let line = css ? raw : blank(raw);
		if (inBlock) { const end = line.indexOf("*/"); if (end < 0) continue; line = line.slice(end + 2); inBlock = false; }
		line = line.replace(/\/\*.*?\*\//g, "");
		const open = line.indexOf("/*");
		if (open >= 0) { line = line.slice(0, open); inBlock = true; }
		for (const ch of line) { if (ch === "{") d++; else if (ch === "}") d--; }
	}
	return out;
}

/** Parts that start at one depth: a part runs from its first line (with the comments and attributes
 * above it) until the next part starts or the depth falls below it. */
function partsAt(lines, ds, level, from, to, isStart, nameOf, inScope, blanks = false) {
	const units = [];
	let i = from;
	while (i < to) {
		if (ds[i] === level && isStart(lines[i])) {
			let start = i;
			const above = blanks ? /^\s*(\/\*|\*|$)/ : /^\s*(\/\/|#\[|\/\*|\*)/;
			while (start > from && ds[start - 1] === level && above.test(lines[start - 1])) start--;
			let end = i + 1;
			while (end < to && ds[end] > level) end++;
			if (end < to && ds[end] === level && /^\s*\}/.test(lines[end])) end++;
			units.push({ name: nameOf(lines[i]), start: start + 1, end, inScope, text: lines.slice(start, end).join("\n") });
			i = end;
		} else i++;
	}
	return units;
}

const RUST_ITEM = /^(pub(\([\w:]+\))? )?(async )?(unsafe )?(fn|struct|enum|impl|mod|trait|const|static|type|macro_rules!)\b/;
const rustName = (line) => {
	const m = /\b(fn|struct|enum|mod|trait|const|static|type)\s+([A-Za-z_]\w*)/.exec(line) || /\bimpl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([\w:]+)/.exec(line);
	if (!m) return line.trim().slice(0, 40);
	return line.trimStart().startsWith("impl") || /^\s*pub\s+impl/.test(line) ? `impl ${m[m.length - 1]}` : m[2];
};

/** Rust: the file's items, or the methods of one `impl X` block and the items around it. */
export function rustUnits(text, scope) {
	const lines = text.split("\n");
	const ds = depths(lines, false);
	const top = partsAt(lines, ds, 0, 0, lines.length, (l) => RUST_ITEM.test(l), rustName, false);
	if (!scope) return { units: top };
	const block = top.find((u) => u.name === scope);
	if (!block) throw new Error(`no ${scope}`);
	const members = partsAt(lines, ds, 1, block.start, block.end - 1, (l) => /^\s+(pub(\([\w:]+\))? )?(const |async )?fn\s/.test(l), rustName, true);
	return { units: [...top.filter((u) => u !== block), ...members], scopeSpan: { start: block.start, end: block.end } };
}

/** CSS: each rule, at the top or inside an at-rule block such as `@layer decks.surface`, named by its selector. */
export function cssUnits(text) {
	const lines = text.split("\n");
	const ds = depths(lines, true);
	const isRule = (l) => /^\s*[^\s/*@}][^{]*\{?\s*$/.test(l) || /^\s*[^\s/*@}].*\{/.test(l);
	const units = [];
	let i = 0;
	while (i < lines.length) {
		if (ds[i] === 0 && /^@(layer|media|supports)/.test(lines[i]) && lines[i].includes("{")) {
			let end = i + 1;
			while (end < lines.length && ds[end] > 0) end++;
			const at = lines[i].trim().replace(/\s*\{$/, "");
			units.push(...partsAt(lines, ds, 1, i + 1, end, isRule, (l) => `${at} ${l.trim().replace(/\s*\{.*$/, "")}`, false, true));
			i = end + 1;
		} else if (ds[i] === 0 && isRule(lines[i])) {
			const [u] = partsAt(lines, ds, 0, i, lines.length, isRule, (l) => l.trim().replace(/\s*\{.*$/, ""), false, true);
			units.push(u);
			i = u.end;
		} else i++;
	}
	return { units };
}
