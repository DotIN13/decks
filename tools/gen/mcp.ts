import { CALLS, jsonSchemaOf, type AnyCall } from "../../protocol/index.ts";

// The MCP tool list: every call an agent may make, with plain JSON Schema
// for its arguments, every named shape written out where it is used.

/** dist-gen/mcp/tools.json. */
export function mcpTools(): string {
	const tools = CALLS.filter(forAgents).map((call) => ({ name: call.name, description: call.summary, inputSchema: jsonSchemaOf(call.input) }));
	return `${JSON.stringify(tools, null, "\t")}\n`;
}

const forAgents = (call: AnyCall) => call.side === "server" && call.who.includes("agent");
