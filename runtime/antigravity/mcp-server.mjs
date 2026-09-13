#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * The Decks canvas tool, for antigravity — over MCP.
 *
 * Antigravity's own tool surface is fixed: the CLI ships its built-ins plus
 * `call_mcp_tool`, so the only way a board-writing tool gets into the agent's
 * toolset is MCP. This server is what the CLI spawns (`mcp_config.json` in the
 * HOME Decks hands it) and it exposes exactly one tool: the same `stage_eval`
 * every other runtime gets, in the same words.
 *
 * The body is one HTTP call back to the Decks server that spawned the CLI. The
 * *CLI process* carries `DECKS_STAGE_URL` and `DECKS_STAGE_TOKEN` in its
 * environment and the MCP child inherits them — the token is this agent's
 * identity, minted per agent, and Decks knows which conversation it belongs to,
 * so nothing here has to say who is calling. `DECKS_AGENT` is ride-along
 * identity for a runtime that wants to say so.
 *
 * No dependencies and no package.json: the MCP protocol is JSON-RPC 2.0 over
 * stdio, which is small enough to hold in one file, and the fewer things agy
 * has to resolve to spawn this, the fewer ways a deck can be missing it.
 */

/*
 * The tool's own words, read from `runtime/tool-description.txt`.
 *
 * One file, four runtimes: Pi and Claude are handed it by the server, opencode's loader
 * reads it, and this reads it. It used to be typed out here too, shortened, under a comment
 * that said "in the same words" — and the model on antigravity was told a different thing
 * about what a board is for than the model on Pi. The MCP protocol wants the text at
 * registration time, which is why it is read here rather than passed in.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DESCRIPTION = readFileSync(resolve(HERE, "../tool-description.txt"), "utf8").trim();

const STAGE_URL = process.env.DECKS_STAGE_URL ?? "";
const STAGE_TOKEN = process.env.DECKS_STAGE_TOKEN ?? "";

/** The one tool, named and worded as `stage/tool.ts` has it. */
const TOOLS = [
	{
		name: "stage_eval",
		description: TOOL_DESCRIPTION,
		inputSchema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description:
						"TypeScript, run as an async function body with `stage` in scope. Return a value to see it.",
				},
			},
			required: ["code"],
		},
	},
];

async function callTool(name, args) {
	if (name !== "stage_eval") throw new Error(`Unknown tool: ${name}`);
	const code = String((args && args.code) ?? "");
	if (!STAGE_URL || !STAGE_TOKEN) {
		throw new Error("This antigravity session was not started by Decks, so there is no canvas to reach.");
	}
	const response = await fetch(STAGE_URL, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${STAGE_TOKEN}` },
		body: JSON.stringify({ code }),
	});
	if (!response.ok) throw new Error(`The Decks canvas answered ${response.status}.`);
	const outcome = await response.json();
	const text = String(outcome && typeof outcome.text === "string" ? outcome.text : JSON.stringify(outcome));
	// Thrown rather than returned, which is what the Pi adapter does and for the same
	// reason: a failed eval must read as a failed tool call and not as a result that
	// happens to contain the word "Error".
	if (outcome && outcome.isError) throw new Error(text);
	return text;
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