import type { Node } from "../../protocol/index.ts";

// Swift types for schema nodes. A named or nested object becomes a struct, a
// named list of strings an enum, a union of objects an enum with one case
// each; an unnamed mixed union and any value become JSONValue.

const RESERVED = new Set(["as", "default", "for", "in", "is", "import", "func", "var", "let", "case", "class", "struct", "enum", "protocol", "return", "self", "Self", "true", "false", "nil", "repeat", "while", "where", "operator", "extension", "init", "internal", "public", "private", "static", "subscript", "switch", "throw", "throws", "try", "catch", "do", "else", "if", "guard", "break", "continue", "fallthrough", "defer", "deinit", "inout", "typealias", "Type", "Any"]);
export const field = (name: string) => (RESERVED.has(name) ? `\`${name}\`` : name);
export const upper = (name: string) => name.replace(/(^|[._-])(\w)/g, (_, __, c: string) => c.toUpperCase());

type Obj = Extract<Node, { k: "obj" }>;
type Union = Extract<Node, { k: "union" }>;

/** Collects the declarations a set of nodes needs, each written once. */
export class SwiftTypes {
	readonly decls = new Map<string, string>();

	/** The Swift type for a node, declaring what it needs under the name hint. */
	typeOf(node: Node, hint: string): string {
		switch (node.k) {
			case "any":
				return "JSONValue";
			case "str":
				return "String";
			case "num":
				return node.int ? "Int" : "Double";
			case "bool":
				return "Bool";
			case "null":
				return "JSONValue";
			case "lit":
				return this.literal(node.values, node.name ?? hint);
			case "arr":
				return `[${this.typeOf(node.items, `${hint}Item`)}]`;
			case "union":
				return this.union(node, node.name ?? hint);
			case "obj":
				if (Object.keys(node.props).length === 0 && node.rest !== undefined) {
					return `[String: ${node.rest === true ? "JSONValue" : this.typeOf(node.rest, `${hint}Value`)}]`;
				}
				return this.struct(node, node.name ?? hint);
		}
	}

	private literal(values: readonly (string | number | boolean)[], name: string): string {
		if (values.every((v) => typeof v === "boolean")) return "Bool";
		if (!values.every((v) => typeof v === "string")) return "Double";
		if (values.length === 1) return "String";
		if (!this.decls.has(name)) {
			const cases = (values as string[]).map((v) => `\tcase ${field(v.replace(/\W/g, "_"))} = ${JSON.stringify(v)}`);
			this.decls.set(name, `public enum ${name}: String, Codable, Sendable, CaseIterable {\n${cases.join("\n")}\n}`);
		}
		return name;
	}

	private union(node: Union, name: string): string {
		const others = node.of.filter((one) => one.k !== "null");
		if (others.length === 1 && others[0]) return this.typeOf(others[0], name);
		if (!others.every((one) => one.k === "obj")) return "JSONValue";
		if (this.decls.has(name)) return name;
		this.decls.set(name, "");
		const members = others.map((one, i) => this.typeOf(one, `${name}${i + 1}`));
		const tag = discriminator(others as Obj[]);
		const values = tag ? (others as Obj[]).map((m) => String((m.props[tag] as unknown as { values: unknown[] }).values[0])) : [];
		this.decls.set(name, unionDecl(name, members, tag, values));
		return name;
	}

	private struct(node: Obj, name: string): string {
		if (this.decls.has(name)) return name;
		this.decls.set(name, "");
		const fields = Object.entries(node.props).map(([key, one]) => {
			const type = this.typeOf(one, `${name}${upper(key)}`);
			return { key, type: node.required.includes(key) ? type : `${type}?` };
		});
		this.decls.set(name, structDecl(name, fields, node.rest !== undefined));
		return name;
	}
}

/** A key every member has as a single string literal, to tell them apart. */
function discriminator(members: Obj[]): string | undefined {
	const first = members[0];
	if (!first) return undefined;
	return Object.keys(first.props).find((key) =>
		members.every((m) => {
			const one = m.props[key];
			return one?.k === "lit" && one.values.length === 1 && typeof one.values[0] === "string";
		}),
	);
}

function structDecl(name: string, fields: { key: string; type: string }[], open: boolean): string {
	const lines = fields.map((f) => `\tpublic var ${field(f.key)}: ${f.type}`);
	if (open) lines.push("\t/** Fields beyond those declared, kept as they came. */", "\tpublic var extra: [String: JSONValue] = [:]");
	const params = fields.map((f) => `${field(f.key)}: ${f.type}${f.type.endsWith("?") ? " = nil" : ""}`).join(", ");
	const sets = fields.map((f) => `\t\tself.${field(f.key)} = ${field(f.key)}`);
	const init = [`\tpublic init(${params}) {`, ...sets, "\t}"];
	const body = [...lines, "", ...init, ...(open ? openCoding(fields) : [])];
	return `public struct ${name}: Codable, Equatable, Sendable {\n${body.join("\n")}\n}`;
}

/** Coding for an object that keeps unknown keys in extra. */
function openCoding(fields: { key: string; type: string }[]): string[] {
	const known = JSON.stringify(fields.map((f) => f.key)).slice(1, -1);
	const decode = fields.map((f) => {
		const bare = f.type.replace(/\?$/, "");
		const how = f.type.endsWith("?") ? "decodeIfPresent" : "decode";
		return `\t\tself.${field(f.key)} = try c.${how}(${bare}.self, forKey: AnyKey(${JSON.stringify(f.key)}))`;
	});
	const encode = fields.map((f) => `\t\ttry c.encode${f.type.endsWith("?") ? "IfPresent" : ""}(${field(f.key)}, forKey: AnyKey(${JSON.stringify(f.key)}))`);
	return [
		"",
		"\tpublic init(from decoder: Decoder) throws {",
		"\t\tlet c = try decoder.container(keyedBy: AnyKey.self)",
		...decode,
		`\t\tlet known: Set<String> = [${known}]`,
		"\t\tfor key in c.allKeys where !known.contains(key.stringValue) { extra[key.stringValue] = try c.decode(JSONValue.self, forKey: key) }",
		"\t}",
		"",
		"\tpublic func encode(to encoder: Encoder) throws {",
		"\t\tvar c = encoder.container(keyedBy: AnyKey.self)",
		...encode,
		"\t\tfor (key, value) in extra { try c.encode(value, forKey: AnyKey(key)) }",
		"\t}",
	];
}

function unionDecl(name: string, members: string[], tag: string | undefined, values: string[]): string {
	const cases = members.map((m, i) => `\tcase m${i + 1}(${m})`);
	const encodes = members.map((_, i) => `\t\tcase .m${i + 1}(let v): try v.encode(to: encoder)`);
	const decode = tag
		? [`\t\tlet c = try decoder.container(keyedBy: AnyKey.self)`, `\t\tlet tag = try c.decode(String.self, forKey: AnyKey(${JSON.stringify(tag)}))`, ...members.map((m, i) => `\t\tif tag == ${JSON.stringify(values[i])} { self = .m${i + 1}(try ${m}(from: decoder)); return }`)]
		: members.map((m, i) => `\t\tif let v = try? ${m}(from: decoder) { self = .m${i + 1}(v); return }`);
	return [
		`public enum ${name}: Codable, Equatable, Sendable {`,
		...cases,
		"",
		"\tpublic init(from decoder: Decoder) throws {",
		...decode,
		`\t\tthrow DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "No case of ${name} fits."))`,
		"\t}",
		"",
		"\tpublic func encode(to encoder: Encoder) throws {",
		"\t\tswitch self {",
		...encodes,
		"\t\t}",
		"\t}",
		"}",
	].join("\n");
}
