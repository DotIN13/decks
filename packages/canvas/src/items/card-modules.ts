/**
 * A card's scripts, run without leaving a module behind at every version.
 *
 * A page keeps every module it has imported, for as long as it lives: there is no way to unload one.
 * A card's script is served at an address stamped with the card's revision (`card-surface.tsx`), so
 * an agent writing a card fifty times left fifty modules in the canvas frame, each with its source,
 * its compiled code and whatever its top level held.
 *
 * So a card's own script is not imported. Its source is fetched and rewritten into the body of an
 * async function: each `import` becomes an `await` of `__import`, each `export` an assignment to
 * `__exports`, `import.meta` an object of its own, and nothing else moves (each rewrite stays on its
 * line, so an error's line number is the file's). The function runs once per address, as a module
 * would, and only the newest version of each card is kept: when a card comes at a new revision, the
 * old one's functions are dropped, and the garbage collector frees them with everything they held.
 *
 * What a card imports by name (`d3`, `three`, the deck's own) is imported as before, once for the
 * page. What it imports beside itself (`./chart.js`) is loaded the same way as the card, kept with it.
 * A page that may not run code made from text (a strict content policy) imports as before.
 */
import type { Program } from "acorn";
import { passless } from "../base/host.ts";

type Exports = Record<string, unknown> & { default?: unknown };
type Loaded = { address: string; modules: Map<string, Promise<Exports>> };

/** The newest version of each card's scripts, by the card's path: an older one is let go. */
const cards = new Map<string, Loaded>();

/** Set once a page refuses to run code made from text: every card imports as a page does. */
let refused = false;

/**
 * The exports of a card's module at `address` (its `index.html.m0.js`, or a file beside it). `path`
 * is the card, whose older versions are let go when this one is new.
 */
export async function loadCardModule(path: string, address: string, version: string): Promise<Exports> {
	if (refused) return import(/* @vite-ignore */ address) as Promise<Exports>;
	let card = cards.get(path);
	if (!card || card.address !== version) {
		card = { address: version, modules: new Map() };
		cards.set(path, card);
	}
	try {
		return await moduleOf(card, passless(address), address);
	} catch (error) {
		if (!(error instanceof EvalError) && !(error instanceof Error && error.name === "SecurityError")) throw error;
		refused = true;
		return import(/* @vite-ignore */ address) as Promise<Exports>;
	}
}

/** Let a card's scripts go: its card is gone from the page for good (deleted, not asleep). */
export function forgetCardModules(path: string): void {
	cards.delete(path);
}

/** A module of this card's version, by its address without a pass (a renewed pass is the same file, `host.ts`), run once. */
function moduleOf(card: Loaded, key: string, address: string): Promise<Exports> {
	let got = card.modules.get(key);
	if (!got) {
		got = run(card, address);
		card.modules.set(key, got);
		got.catch(() => card.modules.get(key) === got && card.modules.delete(key));
	}
	return got;
}

async function run(card: Loaded, address: string): Promise<Exports> {
	const response = await fetch(address, { cache: "no-cache" });
	if (!response.ok) throw new Error(`${address}: ${response.status}`);
	const source = await response.text();
	const body = await rewrite(source);
	const exports: Exports = Object.create(null);
	// Bare names through the page's import map; a file beside the card the same way as the card; an address as it is.
	const load = (spec: string) => {
		if (!/^(?:\.{1,2}\/|\/)/.test(spec)) return import(/* @vite-ignore */ spec);
		const url = new URL(spec, address).href;
		return /\.m?js$/.test(new URL(url).pathname) ? moduleOf(card, passless(url), url) : import(/* @vite-ignore */ url);
	};
	const meta = { url: address, resolve: (spec: string) => new URL(spec, address).href };
	// An indirect eval of one function, its head on the code's first line: an error's line is the file's line.
	const make = (0, eval)(`(async function (__import, __exports, __meta) { "use strict";${body}\n})\n//# sourceURL=${address.replace(/\s/g, "%20")}`) as (...given: unknown[]) => Promise<void>;
	await make(load, exports, meta);
	return exports;
}

/** The module's source as an async function's body: imports awaited, exports assigned, on the same lines. */
async function rewrite(source: string): Promise<string> {
	const { parse } = await import("acorn");
	const program = parse(source, { ecmaVersion: "latest", sourceType: "module" }) as Program;
	const edits: Array<{ from: number; to: number; text: string }> = [];
	const tail: string[] = [];
	let n = 0;
	const text = (node: { start: number; end: number }) => source.slice(node.start, node.end);
	const nameOf = (node: { type: string; name?: string; value?: unknown }) => (node.type === "Identifier" ? node.name! : String(node.value));
	for (const node of program.body) {
		if (node.type === "ImportDeclaration") {
			const from = JSON.stringify(node.source.value);
			const m = `__m${n++}`;
			const parts = [`const ${m} = await __import(${from});`];
			for (const one of node.specifiers) {
				if (one.type === "ImportDefaultSpecifier") parts.push(`const ${one.local.name} = ${m}.default;`);
				else if (one.type === "ImportNamespaceSpecifier") parts.push(`const ${one.local.name} = ${m};`);
				else parts.push(`const ${one.local.name} = ${m}[${JSON.stringify(nameOf(one.imported))}];`);
			}
			edits.push({ from: node.start, to: node.end, text: parts.join(" ") });
		} else if (node.type === "ExportDefaultDeclaration") {
			const d = node.declaration;
			const named = (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id;
			if (named) {
				edits.push({ from: node.start, to: d.start, text: "" });
				tail.push(`__exports.default = ${d.id!.name};`);
			} else edits.push({ from: node.start, to: d.start, text: "__exports.default = " });
		} else if (node.type === "ExportNamedDeclaration") {
			if (node.declaration) {
				edits.push({ from: node.start, to: node.declaration.start, text: "" });
				const d = node.declaration;
				const names = d.type === "VariableDeclaration" ? d.declarations.flatMap((one) => bound(one.id as never)) : d.id ? [d.id.name] : [];
				for (const name of names) tail.push(`__exports[${JSON.stringify(name)}] = ${name};`);
			} else if (node.source) {
				const m = `__m${n++}`;
				const sets = node.specifiers.map((one) => `__exports[${JSON.stringify(nameOf(one.exported))}] = ${m}[${JSON.stringify(nameOf(one.local))}];`);
				edits.push({ from: node.start, to: node.end, text: `const ${m} = await __import(${JSON.stringify(node.source.value)}); ${sets.join(" ")}` });
			} else {
				edits.push({ from: node.start, to: node.end, text: "" });
				for (const one of node.specifiers) tail.push(`__exports[${JSON.stringify(nameOf(one.exported))}] = ${nameOf(one.local)};`);
			}
		} else if (node.type === "ExportAllDeclaration") {
			const from = `await __import(${JSON.stringify(node.source.value)})`;
			edits.push({ from: node.start, to: node.end, text: node.exported ? `__exports[${JSON.stringify(nameOf(node.exported))}] = ${from};` : `Object.assign(__exports, ${from});` });
		}
	}
	// `import(…)` and `import.meta` anywhere in the code: the card's own, not the page's.
	walk(program, (node) => {
		if (node.type === "ImportExpression") edits.push({ from: node.start, to: node.start + 6, text: "__import" });
		else if (node.type === "MetaProperty" && text(node) === "import.meta") edits.push({ from: node.start, to: node.end, text: "__meta" });
	});
	edits.sort((a, b) => b.from - a.from);
	let out = source;
	for (const edit of edits) out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
	return tail.length ? `${out}\n${tail.join(" ")}` : out;
}

/** The names a declaration's pattern binds: `const { a, b: [c] } = …` binds a and c. */
function bound(pattern: { type: string; [key: string]: unknown }): string[] {
	switch (pattern.type) {
		case "Identifier":
			return [pattern.name as string];
		case "ObjectPattern":
			return (pattern.properties as Array<{ type: string; value?: never; argument?: never }>).flatMap((one) => bound(one.type === "RestElement" ? one.argument! : one.value!));
		case "ArrayPattern":
			return (pattern.elements as Array<{ type: string } | null>).flatMap((one) => (one ? bound(one as never) : []));
		case "AssignmentPattern":
			return bound(pattern.left as never);
		case "RestElement":
			return bound(pattern.argument as never);
		default:
			return [];
	}
}

/** Every node under `node`, depth first. */
function walk(node: unknown, visit: (node: { type: string; start: number; end: number }) => void): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const one of node) walk(one, visit);
		return;
	}
	const one = node as { type?: unknown; start: number; end: number };
	if (typeof one.type === "string") visit(one as { type: string; start: number; end: number });
	for (const [key, value] of Object.entries(one)) if (key !== "type" && value && typeof value === "object") walk(value, visit);
}
