import type { AnyCall, Node } from "../../protocol/index.ts";

// A command line's words as one call's arguments. A plain argument (a
// string, a number, a list of strings) is a word, in declared order; any
// key is a flag, --key or --key.sub; a value that is not plain is JSON; -
// reads stdin; --args '<JSON object>' gives them all at once.

type Obj = Extract<Node, { k: "obj" }>;
export class Usage extends Error {}

/** The arguments object a command line gives a call. */
export function argsOf(call: AnyCall, words: string[], stdin: () => string): Record<string, unknown> {
	const input = call.input as Obj;
	const { flags, rest } = split(words);
	const all = flags.find(([key]) => key === "args");
	if (all) return JSON.parse(all[1] === "-" ? stdin() : all[1]) as Record<string, unknown>;
	const args: Record<string, unknown> = {};
	for (const [key, raw] of flags) {
		const keys = homed(input, key.split("."));
		if (!keys) throw new Usage(`decks ${call.name.replace(".", " ")} has no flag --${key.split(".")[0]}.`);
		let target = args;
		for (const part of keys.slice(0, -1)) target = (target[part] ??= {}) as Record<string, unknown>;
		target[keys[keys.length - 1]!] = valueOf(raw, shapeAt(input, keys), stdin);
	}
	const left = fillWords(input, args, rest, stdin);
	if (left.length) throw new Usage(`"${left.join(" ")}" is left over: decks help ${call.name} says what it takes.`);
	return args;
}

/** Plain words fill the plain arguments flags did not, in declared order; a last list takes the rest. Answers the words left over. */
function fillWords(input: Obj, args: Record<string, unknown>, rest: string[], stdin: () => string): string[] {
	const isOption = (key: string) => (key === "canvas" || key === "frame") && !input.required.includes(key);
	const wordKeys = Object.keys(input.props).filter((key) => !(key in args) && !isOption(key) && plain(input.props[key]!));
	let next = 0;
	for (const key of wordKeys) {
		if (next >= rest.length) break;
		const node = input.props[key]!;
		if (many(node) && key === wordKeys[wordKeys.length - 1]) {
			const left = rest.slice(next);
			args[key] = left.length === 1 ? valueOf(left[0]!, node, stdin) : left;
			next = rest.length;
		} else args[key] = valueOf(rest[next++]!, node, stdin);
	}
	return rest.slice(next);
}

// The words and flags of a command line.
function split(words: string[]): { flags: [string, string][]; rest: string[] } {
	const flags: [string, string][] = [];
	const rest: string[] = [];
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (!word.startsWith("--") || word.length < 3) {
			rest.push(word);
			continue;
		}
		const eq = word.indexOf("=");
		const key = eq > 0 ? word.slice(2, eq) : word.slice(2);
		let value = eq > 0 ? word.slice(eq + 1) : words[i + 1];
		if (eq < 0) {
			if (value === undefined || (value.startsWith("--") && value.length > 2)) value = "true";
			else i++;
		}
		flags.push([key, value ?? "true"]);
	}
	return { flags, rest };
}

// Where a flag goes: its own key, or into the object argument that takes it.
/** A flag's path: its own key, or inside the first object argument that takes it (--type card fills item). */
function homed(input: Obj, keys: string[]): string[] | undefined {
	const top = keys[0]!;
	if (top in input.props) return keys;
	const home = Object.keys(input.props).find((name) => takes(input.props[name], top));
	return home ? [home, ...keys] : undefined;
}

/** Whether an object shape (or a union holding one) takes a key. */
function takes(node: Node | undefined, key: string): boolean {
	const options: Node[] = node?.k === "union" ? [...node.of] : node ? [node] : [];
	return options.some((one) => one.k === "obj" && (key in one.props || one.rest !== undefined));
}

/** The shape at a dotted key, through unions of objects. */
function shapeAt(node: Node | undefined, keys: string[]): Node | undefined {
	let here = node;
	for (const key of keys) {
		const options: Node[] = here?.k === "union" ? [...here.of] : here ? [here] : [];
		here = options.map((one) => (one.k === "obj" ? (one.props[key] ?? (one.rest && one.rest !== true ? one.rest : undefined)) : undefined)).find(Boolean);
	}
	return here;
}

// A word as its shape wants it, and which shapes take words.
/** A word as its shape wants it. */
export function valueOf(word: string, node: Node | undefined, stdin: () => string): unknown {
	const raw = word === "-" ? stdin().trim() : word;
	if (!node) return parseLoose(raw);
	if (node.k === "str" || (node.k === "lit" && node.values.every((v) => typeof v === "string"))) return raw;
	if (node.k === "num") return Number.isFinite(Number(raw)) ? Number(raw) : raw;
	if (node.k === "bool") return raw === "true" ? true : raw === "false" ? false : raw;
	return parseLoose(raw);
}

function parseLoose(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

const plain = (node: Node): boolean =>
	node.k === "str" || node.k === "num" || (node.k === "lit" && node.values.every((v) => typeof v === "string")) || (node.k === "union" && node.of.every((one) => one.k === "str" || (one.k === "arr" && one.items.k === "str")));
const many = (node: Node) => node.k === "arr" || (node.k === "union" && node.of.some((one) => one.k === "arr"));
