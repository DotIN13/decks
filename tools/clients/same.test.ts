import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { API, calls, Refused } from "../../protocol/index.ts";
import { callers, testServer, type TestServer } from "../../server/kernel/testing.ts";
import { defineFeature, handleAll } from "../../server/kernel/types.ts";
import { byCommand, byMcp, byScript } from "./same.ts";

// The same call by a script, the decks command and the MCP relay gives the
// same answer, and the same refusal, against Keel's kernel and router. Until
// Keel's doors run, a few lines here put the router behind HTTP.

const items = { n1: { type: "note", id: "n1", box: { x1: 0, y1: 0, x2: 100, y2: 40 } } } as Record<string, { type: string; id: string; box: object }>;
const probe = defineFeature({
	name: "probe",
	calls: handleAll(
		{ get: calls.item.get, move: calls.item.move },
		{
			get: (_ctx, { id }) => {
				const found = items[id];
				if (!found) throw new Refused("not_found", `No item called ${id}.`, "item.list");
				return found;
			},
			move: (_ctx, { id, at }) => ({ ...items[id]!, box: { x1: at?.x ?? 0, y1: at?.y ?? 0, x2: 100, y2: 40 } }),
		},
	),
});

let server: TestServer;
let http: Server;
let url = "";
let token = "";

before(async () => {
	server = await testServer({ features: [probe] });
	token = server.token(callers.agent("ann", "plan"));
	http = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", async () => {
			const caller = server.callers.resolve(req.headers.authorization?.replace(/^Bearer /, ""));
			const name = (req.url ?? "").slice(API.length + 1);
			const answer = caller ? await server.call(name, body ? JSON.parse(body) : {}, caller) : { ok: false, error: { code: "refused", message: "No such token." }, notes: [] };
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(answer));
		});
	});
	await new Promise<void>((resolve) => http.listen(4600, "127.0.0.1", resolve));
	url = "http://127.0.0.1:4600";
});

after(async () => {
	http.close();
	http.closeAllConnections();
	await server.close();
});

async function threeWays(name: string, args: Record<string, unknown>) {
	return Promise.all([byScript(url, token, name, args), byCommand(url, token, name, args), byMcp(url, token, name, args)]);
}

test("a call answers the same through a script, the decks command and MCP", async () => {
	const [script, command, mcp] = await threeWays("item.move", { id: "n1", at: { x: 40, y: 8 }, canvas: "plan" });
	assert.deepEqual(script, { value: { type: "note", id: "n1", box: { x1: 40, y1: 8, x2: 100, y2: 40 } } });
	assert.deepEqual(command, script);
	assert.deepEqual(mcp, script);
});

test("the kernel's own call answers the same three ways", async () => {
	const [script, command, mcp] = await threeWays("deck.now", {});
	assert.ok("value" in script);
	const strip = (one: object) => ({ ...(one as { value: Record<string, unknown> }).value, epoch: 0, iso: "", words: "" });
	assert.deepEqual(strip(command), strip(script));
	assert.deepEqual(strip(mcp), strip(script));
});

test("a refusal arrives with its code, sentence and hint through all three", async () => {
	const [script, command, mcp] = await threeWays("item.get", { id: "zz" });
	assert.deepEqual(script, { refusal: { code: "not_found", message: "No item called zz.", hint: "item.list" } });
	assert.deepEqual(command, script);
	assert.deepEqual(mcp, script);
});

test("arguments that do not fit are refused as invalid the same way", async () => {
	const [script, command, mcp] = await threeWays("item.move", { id: 5 });
	assert.equal((script as { refusal: { code: string } }).refusal.code, "invalid");
	assert.deepEqual(command, script);
	assert.deepEqual(mcp, script);
});
