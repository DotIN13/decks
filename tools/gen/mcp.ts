import { CALLS, type AnyCall, type Node } from "../../protocol/index.ts";

// The MCP tool list: every call an agent may make, with plain JSON Schema
// for its arguments, every named shape written out where it is used.

/** dist-gen/mcp/tools.json. */
export function mcpTools(): string {
	const tools = CALLS.filter(forAgents).map((call) => ({ name: call.name, description: call.summary, inputSchema: jsonSchemaOf(call.input) }));
	return `${JSON.stringify(tools, null, "\t")}\n`;
}

const forAgents = (call: AnyCall) => call.side === "server" && call.who.includes("agent");

export function jsonSchemaOf(node: Node): Record<string, unknown> {
	const description = node.doc ? { description: node.doc } : {};
	switch (node.k) {
		case "any":
			return { ...description };
		case "union":
			return { anyOf: node.of.map(jsonSchemaOf), ...description };
		case "lit":
			return { enum: [...node.values], ...description };
		case "arr":
			return { type: "array", items: jsonSchemaOf(node.items), ...description };
		case "num":
			return { type: node.int ? "integer" : "number", ...description };
		case "str":
			return { type: "string", ...description };
		case "bool":
			return { type: "boolean", ...description };
		case "null":
			return { type: "null", ...description };
		case "obj":
			return {
				type: "object",
				properties: Object.fromEntries(Object.entries(node.props).map(([name, one]) => [name, jsonSchemaOf(one)])),
				...(node.required.length ? { required: [...node.required] } : {}),
				additionalProperties: node.rest === undefined ? false : node.rest === true ? true : jsonSchemaOf(node.rest),
				...description,
			};
	}
}
