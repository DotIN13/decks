import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// The example MCP server, started against a stand-in for Decks on loopback: no real deck is touched.
test("the example MCP server lists its tools and runs one through the SDK", async (t) => {
	const stage = { boards: async () => [{ path: "boards/a.html" }] };
	const fake = createServer((req, res) => {
		let body = ""; req.on("data", (c) => (body += c));
		req.on("end", async () => {
			const { code } = JSON.parse(body);
			res.setHeader("content-type", "application/json");
			try { res.end(JSON.stringify({ ok: true, value: await new AsyncFunction("stage", code)(stage), logs: [] })); }
			catch (error) { res.end(JSON.stringify({ ok: false, error: error.message, logs: [] })); }
		});
	});
	await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
	const port = 20000 + Math.floor(Math.random() * 20000);
	const child = spawn(process.execPath, [fileURLToPath(new URL("../examples/mcp-server.mjs", import.meta.url))], {
		env: { ...process.env, PORT: String(port), DECKS_SDK: fileURLToPath(new URL("../src/index.js", import.meta.url)), DECKS_STAGE_URL: `http://127.0.0.1:${fake.address().port}/stage`, DECKS_STAGE_TOKEN: "t" },
		stdio: "ignore",
	});
	t.after(() => { child.kill(); fake.close(); });
	const rpc = async (message) => {
		for (let i = 0; i < 50; i++) {
			try { const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) }); return r.status === 202 ? null : r.json(); }
			catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
		}
		throw new Error("the example never listened");
	};
	const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
	assert.equal(init.result.serverInfo.name, "decks");
	assert.equal(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
	const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	assert.deepEqual(list.result.tools.map((tool) => tool.name), ["decks_eval", "decks_boards", "decks_send"]);
	const call = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "decks_boards", arguments: {} } });
	assert.deepEqual(JSON.parse(call.result.content[0].text), [{ path: "boards/a.html" }]);
	const bad = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "decks_eval", arguments: { code: "throw new Error('nope')" } } });
	assert.equal(bad.result.isError, true);
	assert.equal(bad.result.content[0].text, "nope");
});
