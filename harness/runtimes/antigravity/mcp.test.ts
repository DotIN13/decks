// Antigravity's Google Docs tools come from the MCP relay its mcp_config.json names
// (clients/mcp), with the agent's own DECKS_URL and DECKS_TOKEN. A call reaches the server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fakeServer } from "@decks/sdk/testing";
import { mcpConfig } from "./install.ts";

type Server = { command: string; args: string[]; env: Record<string, string> };

/** The relay as agy starts it from mcp_config.json, and a way to ask it things. */
function relay(env: Record<string, string>) {
	const server = (JSON.parse(mcpConfig()) as { mcpServers: { decks: Server } }).mcpServers.decks;
	const child = spawn(server.command, server.args, { env: { ...process.env, ...env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
	const waiting = new Map<number, (result: unknown) => void>();
	createInterface({ input: child.stdout! }).on("line", (line) => {
		const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
		if (typeof message.id === "number") waiting.get(message.id)?.(message.result ?? message.error);
	});
	let id = 0;
	const ask = (method: string, params: unknown = {}) =>
		new Promise<unknown>((answer) => {
			waiting.set(++id, answer);
			child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	return { ask, stop: () => child.kill() };
}

test("Antigravity's relay lists google.read and google.edit alone, and a read reaches the server as the agent", async () => {
	const fake = await fakeServer(4676, { "google.read": (args) => ({ doc: String(args.doc), text: "Hello" }) });
	const mcp = relay({ DECKS_URL: fake.url, DECKS_TOKEN: fake.token });
	try {
		await mcp.ask("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
		const listed = (await mcp.ask("tools/list")) as { tools: Array<{ name: string }> };
		assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["google.edit", "google.read"]);
		const result = (await mcp.ask("tools/call", { name: "google.read", arguments: { doc: "doc-1" } })) as { content: Array<{ text: string }>; isError?: boolean };
		assert.ok(!result.isError, JSON.stringify(result));
		assert.match(result.content[0]!.text, /Hello/);
		assert.deepEqual(fake.calls.at(-1), { name: "google.read", args: { doc: "doc-1" }, token: fake.token });
	} finally {
		mcp.stop();
		await fake.close();
	}
});
