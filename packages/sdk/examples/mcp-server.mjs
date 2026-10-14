// An MCP server that controls Decks, built on @decks/sdk with no other packages.
//
// Run it as a Decks server app, so Decks gives it a stage token: copy this file to
// apps/decks-mcp/server.js beside an app.json of { "kind": "server", "start": "node server.js" }.
// Any MCP client then connects to http://<decks>/app/decks-mcp/mcp (MCP's streamable HTTP
// transport, answering in JSON). The first tool call asks the person, in Decks, to allow the app.
import { createServer } from "node:http";

const { connect } = await import(process.env.DECKS_SDK ?? "@decks/sdk");
const decks = connect();

const TOOLS = [
	{
		name: "decks_eval",
		description: "Run stage code in Decks: the body of an async function with `stage` in scope, the same API Decks' agents have (boards, show, fit, pen, send, agents, apps...). Return a JSON value.",
		inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
		run: ({ code }) => decks.run(code),
	},
	{
		name: "decks_boards",
		description: "List every board in the deck, with its path, title, place and size.",
		inputSchema: { type: "object", properties: {} },
		run: () => decks.stage.boards(),
	},
	{
		name: "decks_send",
		description: "Hand a task to a Decks agent by name; with `kind`, the agent is made first when there is none by that name. Returns at once.",
		inputSchema: { type: "object", properties: { agent: { type: "string" }, kind: { type: "string", enum: ["claude", "pi", "opencode", "antigravity"] }, task: { type: "string" } }, required: ["agent", "task"] },
		run: ({ agent, kind, task }) => (kind ? decks.sendTo({ name: agent, kind }, { task }) : decks.send(agent, { task })),
	},
];

async function answer(message) {
	const { id, method, params } = message;
	if (id === undefined) return undefined; // a notification, such as notifications/initialized
	const ok = (result) => ({ jsonrpc: "2.0", id, result });
	if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "decks", version: "0.1.0" } });
	if (method === "ping") return ok({});
	if (method === "tools/list") return ok({ tools: TOOLS.map(({ run, ...tool }) => tool) });
	if (method === "tools/call") {
		const tool = TOOLS.find((t) => t.name === params?.name);
		if (!tool) return { jsonrpc: "2.0", id, error: { code: -32602, message: `No tool ${params?.name}` } };
		try {
			const value = await tool.run(params.arguments ?? {});
			return ok({ content: [{ type: "text", text: JSON.stringify(value ?? null, null, 1) }] });
		} catch (error) {
			return ok({ content: [{ type: "text", text: error.message }], isError: true });
		}
	}
	return { jsonrpc: "2.0", id, error: { code: -32601, message: `No method ${method}` } };
}

createServer((req, res) => {
	if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", async () => {
		let parsed;
		try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
		const replies = (await Promise.all((Array.isArray(parsed) ? parsed : [parsed]).map(answer))).filter(Boolean);
		if (!replies.length) { res.writeHead(202).end(); return; }
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
	});
}).listen(Number(process.env.PORT) || 8787, process.env.HOST || "127.0.0.1");
