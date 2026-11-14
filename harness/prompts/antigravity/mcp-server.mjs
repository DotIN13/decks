#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Decks' Google Docs tools, for antigravity — over MCP.
 *
 * Antigravity's own tool surface is fixed: the CLI ships its built-ins plus `call_mcp_tool`, so
 * the only way Decks' own tools get into the agent's toolset is MCP. This server is what the CLI
 * spawns (`mcp_config.json` in the HOME Decks hands it), and it exposes the Google Docs tools. The
 * canvas is not one of them: the agent reaches it with the `decks` command in its shell, which
 * Decks puts on the CLI's PATH (`apps/server/src/runtimes/decks-env.ts`).
 *
 * The body is one HTTP call back to the Decks server that spawned the CLI. The *CLI process*
 * carries `DECKS_STAGE_URL` and `DECKS_STAGE_TOKEN` in its environment and the MCP child inherits
 * them — the token is this agent's identity, minted per agent.
 *
 * No dependencies and no package.json: the MCP protocol is JSON-RPC 2.0 over stdio, which is
 * small enough to hold in one file.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const STAGE_URL = process.env.DECKS_STAGE_URL ?? "";
const STAGE_TOKEN = process.env.DECKS_STAGE_TOKEN ?? "";

/** The Google Docs tools, worded in `runtime/gdocs-tools.json` as every runtime has them. */
const GDOCS = JSON.parse(readFileSync(resolve(HERE, "../gdocs-tools.json"), "utf8"));

/** The Google Docs tools. The canvas is the `decks` command in the CLI's shell. */
const TOOLS = [
	...GDOCS.map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: {
			type: "object",
			properties: Object.fromEntries(Object.entries(t.parameters).map(([key, about]) => [key, { type: "string", description: about }])),
			required: Object.keys(t.parameters).filter((key) => key !== "new"),
		},
	})),
];

async function callTool(name, args) {
	if (GDOCS.some((t) => t.name === name)) return callGdocs(name, args);
	throw new Error(`Unknown tool: ${name}`);
}

// --- stdio JSON-RPC ----------------------------------------------------------

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let newline;
	while ((newline = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		if (!line.trim()) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue; // a line that is not JSON is not a line we sent
		}
		void handle(message).catch((error) => {
			if (typeof message.id !== "undefined") send(String((error && error.message) || error), message.id);
		});
	}
});

/** A Google Docs tool: the same server, the same token, its own route. */
async function callGdocs(name, args) {
	if (!STAGE_URL || !STAGE_TOKEN) throw new Error("This antigravity session was not started by Decks, so there is no Google Docs to reach.");
	const response = await fetch(STAGE_URL.replace(/\/stage\/eval$/, "/gdocs/call"), {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${STAGE_TOKEN}` },
		body: JSON.stringify({ tool: name, args: args ?? {} }),
	});
	if (!response.ok) throw new Error(`Decks answered ${response.status}.`);
	const outcome = await response.json();
	if (outcome && outcome.isError) throw new Error(String(outcome.text));
	return String(outcome.text);
}

async function handle(message) {
	if (message.method === "initialize") {
		send(
			{
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "decks", version: "0.1.0" },
			},
			message.id,
		);
		return;
	}
	if (message.method === "notifications/initialized") return;
	if (message.method === "tools/list") {
		send({ tools: TOOLS }, message.id);
		return;
	}
	if (message.method === "tools/call") {
		const { name, arguments: args } = message.params ?? {};
		try {
			const text = await callTool(name, args);
			send({ content: [{ type: "text", text }], isError: false }, message.id);
		} catch (error) {
			send(
				{ content: [{ type: "text", text: String((error && error.message) || error) }], isError: true },
				message.id,
			);
		}
		return;
	}
	// Anything else answers null rather than hanging the caller — JSON-RPC requires an
	// answer, and agy will reconnect its own way if it wants the capability.
	if (typeof message.id !== "undefined") send(null, message.id);
}

function send(result, id) {
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}