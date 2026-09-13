import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mcpServerPath } from "./install.ts";

/**
 * The canvas-tool MCP server, driven the way the CLI drives it.
 *
 * `runtime/antigravity/mcp-server.mjs` is the one file this project runs that is not a
 * test, and what it has to get right is a protocol — the MCP handshake, the one tool's
 * schema, and a tool body that is one HTTP call carrying the agent's token — none of
 * which needs a model. So it is spawned for real (the `node` that runs Decks runs it) and
 * spoken to over stdio, with a throwaway HTTP server standing in for Decks' own
 * `/api/stage/eval`. That covers the whole round trip through the CLI's own mechanism
 * except the CLI itself.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** A stand-in for Decks' own `/api/stage/eval`, which answers and remembers. */
async function stageServer(answer: { text: string; isError?: boolean }) {
	const seen: Array<{ token: string | undefined; code: unknown }> = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			const header = request.headers.authorization;
			seen.push({ token: typeof header === "string" ? header.replace("Bearer ", "") : undefined, code: JSON.parse(body || "{}").code });
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(answer));
		});
	});
	await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
	const port = (server.address() as { port: number }).port;
	return { url: `http://127.0.0.1:${port}/api/stage/eval`, seen, close: () => server.close() };
}

interface McpClient {
	call(method: string, params: unknown): Promise<unknown>;
	send(line: unknown): void;
	close(): void;
}

/** Spawn the MCP server, and return a client that maps request id to answer. */
async function mcpClient(url: string): Promise<McpClient> {
	const child = spawn(process.execPath, [mcpServerPath()], {
		env: { ...process.env, DECKS_STAGE_URL: url, DECKS_STAGE_TOKEN: "test-token" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const waiter = new Map<number, { accept: (value: unknown) => void }>();
	let nextId = 1;
	createInterface({ input: child.stdout! }).on("line", (line) => {
		let message: { id?: number; result?: unknown };
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof message.id === "number" && waiter.has(message.id)) {
			waiter.get(message.id)!.accept(message.result);
			waiter.delete(message.id);
		}
	});
	return {
		call(method, params) {
			return new Promise((accept) => {
				const id = nextId++;
				waiter.set(id, { accept: accept as (value: unknown) => void });
				child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
			});
		},
		send(line) {
			child.stdin!.write(`${JSON.stringify(line)}\n`);
		},
		close() {
			child.stdin!.end();
			child.kill();
		},
	};
}

test("the handshake lists the one tool, in Decks' words", { skip: false }, async () => {
	const stage = await stageServer({ text: "4" });
	const client = await mcpClient(stage.url);
	try {
		const init = (await client.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agy", version: "1" } })) as {
			capabilities?: Record<string, unknown>;
			serverInfo?: { name?: string };
		};
		assert.equal(init.serverInfo?.name, "decks");
		assert.deepEqual(init.capabilities, { tools: {} });

		client.send({ jsonrpc: "2.0", method: "notifications/initialized" });

		const listed = (await client.call("tools/list", {})) as { tools?: Array<{ name?: string; inputSchema?: Record<string, unknown> }> };
		assert.equal(listed.tools?.length, 1);
		assert.equal(listed.tools![0]!.name, "stage_eval");
		assert.equal((listed.tools![0]!.inputSchema?.required as string[])?.join(","), "code");
	} finally {
		client.close();
		stage.close();
	}
});

test("a tool call reaches Decks with the agent's token, and the answer comes back", { skip: false }, async () => {
	const stage = await stageServer({ text: "4" });
	const client = await mcpClient(stage.url);
	try {
		await client.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agy", version: "1" } });
		client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const outcome = (await client.call("tools/call", { name: "stage_eval", arguments: { code: "return 42" } })) as {
			content?: Array<{ type?: string; text?: string }>;
			isError?: boolean;
		};
		assert.deepEqual(stage.seen, [{ token: "test-token", code: "return 42" }]);
		assert.equal(outcome.isError, false);
		assert.equal(outcome.content?.[0]?.text, "4");
	} finally {
		client.close();
		stage.close();
	}
});

test("a canvas failure is a failed tool call, not a crash", { skip: false }, async () => {
	const stage = await stageServer({ text: "that board does not exist", isError: true });
	const client = await mcpClient(stage.url);
	try {
		await client.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agy", version: "1" } });
		client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const outcome = (await client.call("tools/call", { name: "stage_eval", arguments: { code: "return missing()" } })) as {
			content?: Array<{ text?: string }>;
			isError?: boolean;
		};
		// Raised on the server side, so the CLI reads a failed tool call rather than a
		// result that happens to contain the word "Error".
		assert.equal(outcome.isError, true);
		assert.match(outcome.content?.[0]?.text ?? "", /that board does not exist/);
	} finally {
		client.close();
		stage.close();
	}
});

test("a server that is not there is a failed tool call too", { skip: false }, async () => {
	const client = await mcpClient("http://127.0.0.1:1/api/stage/eval");
	try {
		await client.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agy", version: "1" } });
		client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		const outcome = (await client.call("tools/call", { name: "stage_eval", arguments: { code: "x" } })) as { isError?: boolean; content?: Array<{ text?: string }> };
		assert.equal(outcome.isError, true);
		assert.match(outcome.content?.[0]?.text ?? "", /117|answered|fetch/i);
	} finally {
		client.close();
	}
});