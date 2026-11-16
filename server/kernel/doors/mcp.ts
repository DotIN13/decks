import { jsonSchemaOf, PROTOCOL_VERSION, type AnyCall, type Caller, type Envelope } from "../../../protocol/index.ts";
import { SERVER_VERSION, type Built } from "../kernel.ts";

// The MCP door, POST /mcp: JSON-RPC 2.0 over HTTP. Its tools are the calls
// this caller may make here, named as the protocol names them, each with its
// arguments as JSON Schema. A tool's result carries the envelope.


const MCP_VERSION = "2025-06-18";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

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
			const text = textOf(envelope);
			return reply({ content: [{ type: "text", text }], structuredContent: envelope, isError: !envelope.ok });
		}
		default:
			return { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `There is no method ${rpc.method}.` } };
	}
}

const tool = (call: AnyCall) => ({ name: call.name, description: call.summary, inputSchema: jsonSchemaOf(call.input) });

/** What an MCP client reads: the value then its notes, or the refusal, its hint, then notes; as clients/mcp writes it. */
export function textOf(envelope: Envelope<unknown>): string {
	if (!envelope.ok) {
		const { message, code, hint } = envelope.error;
		return [`${message} (${code})`, ...(hint ? [`Try ${hint}.`] : []), ...envelope.notes].join("\n");
	}
	const { value } = envelope;
	const text = value === undefined || value === null ? "(done)" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return [text, ...envelope.notes].join("\n");
}
