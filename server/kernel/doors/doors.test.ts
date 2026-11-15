import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_FILE, PROTOCOL_VERSION } from "../../../protocol/index.ts";
import { probeFeature } from "../probe.test.ts";
import { startServer } from "../server.ts";
import { callers, testServer } from "../testing.ts";

// One call answers the same through HTTP, the socket and MCP; refusals carry
// their codes; a browser Origin with no token is refused; a second start on
// the same port, or the same deck, fails with a sentence. Ports 4620 to 4629.

// The tests look into answers freely.
type Json = any;
const read = async (res: Response): Promise<Json> => res.json();
const post = (url: string, token: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });

function socketCall(url: string, token: string, name: string, args: unknown): Promise<unknown> {
	const ws = new WebSocket(`${url.replace("http", "ws")}/api/v1/socket`);
	return new Promise((done, fail) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		ws.onerror = () => fail(new Error("socket failed"));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			if (message.type === "hello") ws.send(JSON.stringify({ type: "call", id: "1", name, args }));
			if (message.type === "answer") (ws.close(), done(message.envelope));
		};
	});
}

async function mcpCall(url: string, token: string, name: string, args: unknown): Promise<unknown> {
	const answer = await await read(await post(`${url}/mcp`, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
	return answer.result.structuredContent;
}

test("one call gives the same answer through HTTP, the socket and MCP", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const doors = await server.listen(4621);
	await server.value("port.open", { port: 9 });
	const http = await await read(await post(`${doors.url}/api/v1/port.list`, doors.token, {}));
	assert.equal(http.ok, true);
	assert.deepEqual(await socketCall(doors.url, doors.token, "port.list", {}), http);
	assert.deepEqual(await mcpCall(doors.url, doors.token, "port.list", {}), http);
	const tools = await await read(await post(`${doors.url}/mcp`, doors.token, { jsonrpc: "2.0", id: 2, method: "tools/list" }));
	assert.ok(tools.result.tools.some((one: { name: string }) => one.name === "port.open"));
	await doors.close();
	await server.close();
});

test("a wrong argument, an unknown call and a caller not allowed refuse with their codes", async () => {
	const server = await testServer({ features: [probeFeature()] });
	const doors = await server.listen(4622);
	const card = server.token(callers.card("canvases/a/cards/x/index.html", "a"));
	const code = async (name: string, token: string, args: unknown) => (await await read(await post(`${doors.url}/api/v1/${name}`, token, args))).error?.code;
	assert.equal(await code("port.open", doors.token, { port: "x" }), "invalid");
	assert.equal(await code("no.such", doors.token, {}), "not_found");
	assert.equal(await code("port.open", card, { port: 1 }), "refused");
	assert.equal(await code("canvas.list", doors.token, {}), "unavailable");
	await doors.close();
	await server.close();
});

test("no token answers 401, and a browser Origin with no token is refused", async () => {
	const server = await testServer();
	const doors = await server.listen(4623);
	assert.equal((await post(`${doors.url}/api/v1/deck.get`, undefined, {})).status, 401);
	const browser = await post(`${doors.url}/api/v1/deck.get`, undefined, {}, { origin: "https://evil.example" });
	assert.equal(browser.status, 403);
	assert.equal((await read(browser)).error.code, "refused");
	assert.equal((await post(`${doors.url}/api/v1/deck.get`, doors.token, {}, { origin: "https://ok.example" })).status, 200);
	const preflight = await fetch(`${doors.url}/api/v1/deck.get`, { method: "OPTIONS", headers: { origin: "null" } });
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("access-control-allow-origin"), "null");
	const framed = await post(`${doors.url}/api/v1/deck.get`, doors.token, {}, { origin: "null" });
	assert.equal(framed.headers.get("access-control-allow-origin"), "null");
	assert.equal((await post(`${doors.url}/api/v1/deck.get`, doors.token, {}, { origin: "https://ok.example" })).headers.get("access-control-allow-origin"), null);
	assert.equal((await post(`${doors.url}/api/v1/deck.get`, undefined, {}, { origin: "null" })).status, 403);
	await doors.close();
	await server.close();
});

test("a server on a folder writes a user-only lock file; a second start on its port or deck fails cleanly", async () => {
	const deck = await mkdtemp(join(tmpdir(), "keel-server-"));
	const other = await mkdtemp(join(tmpdir(), "keel-other-"));
	const running = await startServer({ deck, port: 4624, features: [] });
	try {
		const lock = JSON.parse(await readFile(join(deck, LOCK_FILE), "utf8"));
		assert.equal((await stat(join(deck, LOCK_FILE))).mode & 0o777, 0o600);
		assert.equal(lock.url, running.url);
		const login = await await read(await post(`${running.url}/api/v1/login`, lock.token, { label: "terminal" }));
		assert.equal(login.value.name, "terminal");
		assert.equal((await await read(await post(`${running.url}/api/v1/deck.now`, login.value.token, {}))).ok, true);
		await assert.rejects(startServer({ deck: other, port: 4624, features: [] }), /Port 4624 is in use/);
		await assert.rejects(startServer({ deck, port: 4625, features: [] }), /Another server is serving this deck/);
	} finally {
		await running.close();
	}
	await assert.rejects(readFile(join(deck, LOCK_FILE)), { code: "ENOENT" });
	await rm(deck, { recursive: true, force: true });
	await rm(other, { recursive: true, force: true });
});

test("a pairing code, made only by the person on this machine, logs in once", async () => {
	const server = await testServer();
	const doors = await server.listen(4626);
	const pair = await server.value<{ code: string }>("deck.pair");
	const first = await await read(await post(`${doors.url}/api/v1/login`, undefined, { code: pair.code }));
	assert.equal(first.ok, true);
	assert.equal((await post(`${doors.url}/api/v1/login`, undefined, { code: pair.code })).status, 401);
	const paired = await await read(await post(`${doors.url}/api/v1/deck.pair`, first.value.token, {}));
	assert.equal(paired.error.code, "refused");
	await doors.close();
	await server.close();
});
