import type { Envelope } from "./call.ts";
import type { Node } from "./schema.ts";

// What an MCP client is shown: a tool's input as plain JSON Schema, and an
// answer as text. One copy, for the server's MCP door, the stdio relay and
// the generators.

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

/** A call's answer as a tool's text: the value and its notes, or the refusal's sentence, code and hint. */
export function toolText(envelope: Envelope<unknown>): { text: string; isError: boolean } {
	if (!envelope.ok) {
		const { message, code, hint } = envelope.error;
		return { text: [`${message} (${code})`, ...(hint ? [`Try ${hint}.`] : []), ...envelope.notes].join("\n"), isError: true };
	}
	const { value } = envelope;
	const text = value === undefined || value === null ? "(done)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return { text: [text, ...envelope.notes].join("\n"), isError: false };
}
