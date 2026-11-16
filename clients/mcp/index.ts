import { existsSync, readFileSync } from "node:fs";
import { CALLS, ENV, PROTOCOL_VERSION, type AnyCall, jsonSchemaOf, refusalFrom, toolText } from "../../protocol/index.ts";
import { isOld } from "../../protocol/compat/old-calls.ts";
import { connect, DecksError, type Client } from "../sdk/index.ts";

// The MCP relay: JSON-RPC 2.0 over stdio. Each server call an agent may make
// is a tool of the same name, whose input is the call's arguments; a call
// goes to the server through the SDK. DECKS_TOOLS narrows the list to some
// nouns or calls (item,card,view.focus). A tool named in today's words is
// still taken, unlisted, and answered as today's (protocol/compat).

type Rpc = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> };
type Content = { type: "text"; text: string };

type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
const GENERATED = new URL("../../dist-gen/mcp/tools.json", import.meta.url);

/** Serve on stdin and stdout until stdin ends. */
export function serve(): void {
	let client: Promise<Client> | undefined;
	const get = () => (client ??= connect());
	let buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk: string) => {
		buffer += chunk;
		for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
			const line = buffer.slice(0, at).trim();
			buffer = buffer.slice(at + 1);
			if (!line) continue;
			let message: Rpc;
			try {
				message = JSON.parse(line) as Rpc;
			} catch {
				continue;
			}
			void answer(message, get).then((out) => out && process.stdout.write(`${JSON.stringify(out)}\n`));
		}
	});
}

/** The answer to one JSON-RPC message, or undefined for a notification. */
export async function answer(message: Rpc, client: () => Promise<Client>): Promise<object | undefined> {
	const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
	if (message.method === "initialize") {
		const version = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18";
		return reply({ protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "decks", version: PROTOCOL_VERSION } });
	}
	if (message.id === undefined) return undefined;
	if (message.method === "tools/list") return reply({ tools: tools() });
	if (message.method === "tools/call") return reply(await callTool(await client(), String(message.params?.name), message.params?.arguments));
	if (message.method === "ping") return reply({});
	return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `No method ${message.method}.` } };
}

/** The tool list the generators wrote, else the same list made here. */
export function tools(filter?: string): Tool[] {
	const all: Tool[] = existsSync(GENERATED)
		? (JSON.parse(readFileSync(GENERATED, "utf8")) as Tool[])
		: CALLS.map((call) => ({ name: call.name, description: call.summary, inputSchema: jsonSchemaOf(call.input) }));
	const shown = new Set(shownCalls(filter).map((call) => call.name));
	return all.filter((tool) => shown.has(tool.name));
}

/** The tools shown, after the DECKS_TOOLS filter. */
export function shownCalls(filter = process.env[ENV.tools] ?? ""): AnyCall[] {
	const wanted = filter.split(",").map((one) => one.trim()).filter(Boolean);
	const forAgents = CALLS.filter((call) => call.side === "server" && call.who.includes("agent"));
	return wanted.length ? forAgents.filter((call) => wanted.includes(call.name) || wanted.includes(call.name.split(".")[0]!)) : forAgents;
}

/** One tool call's content: the value and its notes, or the refusal with its code and hint. */
export async function callTool(client: Client, name: string, input: unknown, filter?: string): Promise<{ content: Content[]; isError: boolean }> {
	if (!shownCalls(filter).some((call) => call.name === name) && !isOld(name)) {
		return { content: [{ type: "text", text: `There is no tool called ${name}. (not_found)` }], isError: true };
	}
	let shown: { text: string; isError: boolean };
	try {
		const { value, notes } = await client.call(name, input ?? {});
		shown = toolText({ ok: true, value, notes });
	} catch (error) {
		shown = toolText(refusalFrom(error, error instanceof DecksError ? error.notes : []));
	}
	return { content: [{ type: "text", text: shown.text }], isError: shown.isError };
}
