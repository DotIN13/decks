// Writes a drawing back so every item that did not change keeps its bytes.
// An item is found in the old text by its id; if it equals what is there now,
// its old text is copied, else it is written fresh in the file's indent.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Span = { start: number; end: number; value: Json };

/** The old text, its items' spans by id, and the indent it uses. */
export type Source = { text: string; items: Map<string, Span>; indent: string };

// Reading the old text
export function sourceOf(text: string): Source {
	const items = new Map<string, Span>();
	const scan = new Scanner(text, items);
	scan.value();
	return { text, items, indent: indentOf(text) };
}

/** A JSON reader that notes where each object with an id starts and ends. */
class Scanner {
	private at = 0;
	constructor(private text: string, private items: Map<string, Span>) {}

	value(): Json {
		this.space();
		const c = this.text[this.at];
		if (c === "{") return this.object();
		if (c === "[") return this.array();
		if (c === '"') return this.string();
		const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(this.text.slice(this.at, this.at + 64));
		if (!m) throw new Error(`Not JSON at character ${this.at}.`);
		this.at += m[0].length;
		return JSON.parse(m[0]) as Json;
	}

	private object(): Json {
		const start = this.at++;
		const out: Record<string, Json> = {};
		this.space();
		if (this.text[this.at] === "}") this.at++;
		else for (;;) {
			this.space();
			const key = this.string();
			this.space();
			this.expect(":");
			out[key] = this.value();
			this.space();
			if (this.text[this.at++] === "}") break;
		}
		if (typeof out.id === "string" && typeof out.type === "string") this.items.set(out.id, { start, end: this.at, value: out });
		return out;
	}

	private array(): Json[] {
		this.at++;
		const out: Json[] = [];
		this.space();
		if (this.text[this.at] === "]") { this.at++; return out; }
		for (;;) {
			out.push(this.value());
			this.space();
			if (this.text[this.at++] === "]") return out;
		}
	}

	private string(): string {
		const start = this.at;
		this.expect('"');
		while (this.text[this.at] !== '"') this.at += this.text[this.at] === "\\" ? 2 : 1;
		this.at++;
		return JSON.parse(this.text.slice(start, this.at)) as string;
	}

	private expect(c: string): void {
		if (this.text[this.at] !== c) throw new Error(`Not JSON: expected ${c} at character ${this.at}.`);
		this.at++;
	}

	private space(): void {
		while (/\s/.test(this.text[this.at] ?? "")) this.at++;
	}
}

function indentOf(text: string): string {
	const m = /\n([ \t]+)"/.exec(text);
	return m ? m[1]! : "  ";
}

// Writing it back
/** The file for `doc`, reusing the old text of every unchanged item. */
export function writeLike(source: Source | undefined, doc: Record<string, unknown>): string {
	if (!source) return `${JSON.stringify(doc, null, 2)}\n`;
	const out = new Writer(source);
	return `${out.node(doc as Json, 0, true)}\n`;
}

class Writer {
	constructor(private source: Source) {}

	node(value: Json, depth: number, root = false): string {
		if (!root && value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string") {
			const old = this.source.items.get(value.id);
			if (old && same(old.value, value)) return this.source.text.slice(old.start, old.end);
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) return this.plain(value, depth);
		const pad = this.source.indent.repeat(depth + 1);
		const fields = Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => {
			const body = k === "children" && Array.isArray(v) ? this.list(v, depth + 1) : this.plain(v, depth + 1);
			return `${pad}${JSON.stringify(k)}: ${body}`;
		});
		if (!fields.length) return "{}";
		return `{\n${fields.join(",\n")}\n${this.source.indent.repeat(depth)}}`;
	}

	private list(items: Json[], depth: number): string {
		if (!items.length) return "[]";
		const pad = this.source.indent.repeat(depth + 1);
		return `[\n${items.map((one) => pad + this.node(one, depth + 1)).join(",\n")}\n${this.source.indent.repeat(depth)}]`;
	}

	private plain(value: Json, depth: number): string {
		const text = JSON.stringify(value, null, this.source.indent);
		return text.split("\n").join(`\n${this.source.indent.repeat(depth)}`);
	}
}

function same(a: Json, b: Json): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) return a.length === (b as Json[]).length && a.every((v, i) => same(v, (b as Json[])[i]!));
	const ka = Object.keys(a), kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	return ka.every((k, i) => k === kb[i] && same(a[k]!, (b as Record<string, Json>)[k]!));
}
