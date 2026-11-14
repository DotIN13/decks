import { MCP_PATH as PATH, PROTOCOL_VERSION, type AnyCall, type Caller, type Node } from "../../../protocol/index.ts";
import type { Built } from "../kernel.ts";
import { SERVER_VERSION } from "../own-calls.ts";

// The MCP door, POST /mcp: JSON-RPC 2.0 over HTTP. Its tools are the calls
// this caller may make here, named as the protocol names them, each with its
// arguments as JSON Schema. A tool's result carries the envelope.

export const MCP_PATH = PATH;
const MCP_VERSION = "2025-06-18";
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function jsonSchemaOf(node: Node): Record<string, unknown> {
	const doc = node.doc ? { description: node.doc } : {};
	switch (node.k) {
		case "any":
			return { ...doc };
		case "union":
			return { anyOf: node.of.map(jsonSchemaOf), ...doc };
		case "lit":
			return { enum: [...node.values], ...doc };
		case "arr":
			return { type: "array", items: jsonSchemaOf(node.items), ...doc };
		case "num":
			return { type: node.int ? "integer" : "number", ...doc };
		case "str":
		case "bool":
		case "null":
			return { type: { str: "string", bool: "boolean", null: "null" }[node.k], ...doc };
		case "obj": {
			const properties = Object.fromEntries(Object.entries(node.props).map(([key, one]) => [key, jsonSchemaOf(one)]));
			const rest = node.rest === undefined ? false : node.rest === true ? true : jsonSchemaOf(node.rest);
			return { type: "object", properties, ...(node.required.length ? { required: [...node.required] } : {}), additionalProperties: rest, ...doc };
		}
	}
}

const tool = (call: AnyCall) => ({ name: call.name, description: call.summary, inputSchema: jsonSchemaOf(call.input) });

/** One JSON-RPC message in, its answer out; undefined for a notification. */
export async function mcpAnswer(built: Built, caller: Caller, rpc: Rpc): Promise<Record<string, unknown> | undefined> {
	if (rpc.id === undefined || rpc.id === null) return undefined;
	const reply = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id, result });
	switch (rpc.method) {
		case "initialize":
			return reply({ protocolVersion: MCP_VERSION, capabilities: { tools: {} }, serverInfo: { name: "decks", version: SERVER_VERSION }, instructions: `Decks protocol ${PROTOCOL_VERSION}.` });
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools: built.router.callable(caller).map(tool) });
		case "tools/call": {
			const envelope = await built.router.call(String(rpc.params?.name), rpc.params?.arguments ?? {}, caller);
			const text = JSON.stringify(envelope.ok ? envelope.value : envelope.error);
			return reply({ content: [{ type: "text", text }], structuredContent: envelope, isError: !envelope.ok });
		}
		default:
			return { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `There is no method ${rpc.method}.` } };
	}
}
