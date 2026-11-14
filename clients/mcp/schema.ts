import type { Node } from "../../protocol/index.ts";

// Plain JSON Schema for a protocol node, every named shape written out
// where it is used: what MCP clients read as a tool's input.

export function jsonSchema(node: Node): Record<string, unknown> {
	const description = node.doc ? { description: node.doc } : {};
	switch (node.k) {
		case "any":
			return { ...description };
		case "union":
			return { anyOf: node.of.map(jsonSchema), ...description };
		case "lit":
			return { enum: [...node.values], ...description };
		case "arr":
			return { type: "array", items: jsonSchema(node.items), ...description };
		case "num":
			return { type: node.int ? "integer" : "number", ...description };
		case "obj":
			return {
				type: "object",
				properties: Object.fromEntries(Object.entries(node.props).map(([name, one]) => [name, jsonSchema(one)])),
				...(node.required.length ? { required: [...node.required] } : {}),
				additionalProperties: node.rest === undefined ? false : node.rest === true ? true : jsonSchema(node.rest),
				...description,
			};
		default:
			return { type: node.k === "str" ? "string" : node.k === "bool" ? "boolean" : "null", ...description };
	}
}
