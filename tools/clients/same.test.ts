import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { API, calls, events, Refused } from "../../protocol/index.ts";
import { login } from "../../clients/cli/index.ts";
import { clientFor, type Heard } from "../../clients/sdk/index.ts";
import { callers, testServer, type TestServer } from "../../server/kernel/testing.ts";
import { defineFeature, handleAll } from "../../server/kernel/types.ts";
import { byCommand, byMcp, byScript } from "./same.ts";

// The same call by a script, the decks command and the MCP relay gives the
// same answer, and the same refusal, against Keel's kernel through its real
// doors (a few lines of HTTP stand in where a kernel has no doors yet).

const items = { n1: { type: "note", id: "n1", box: { x1: 0, y1: 0, x2: 100, y2: 40 } } } as Record<string, { type: string; id: string; box: { x1: number; y1: number; x2: number; y2: number } }>;
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
			move: (ctx, { id, at }) => {
				ctx.events.emit(events.itemChanged, { canvas: "plan", ids: [id], by: ctx.caller.id, rev: 1 });
				return { ...items[id]!, box: { x1: at?.x ?? 0, y1: at?.y ?? 0, x2: 100, y2: 40 } };
			},
		},
	),
});

let server: TestServer;
let doors: { url: string; close(): Promise<void> };
let url = "";
let token = "";
let fallback: Server | undefined;

/** Keel's real doors when the testing module has them; else the router behind a few lines of HTTP. */
async function serve(): Promise<string> {
	const listen = (server as { listen?: (port: number) => Promise<{ url: string; close(): Promise<void> }> }).listen;
	if (listen) {
		doors = await listen.call(server, 4600);
		return doors.url;
	}
	fallback = createServer((req, res) => {
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
	await new Promise<void>((resolve) => fallback!.listen(4600, "127.0.0.1", resolve));
	return "http://127.0.0.1:4600";
}

before(async () => {
	server = await testServer({ features: [probe] });
	token = server.token(callers.agent("ann", "plan"));
	url = await serve();
});

after(async () => {
	if (fallback) {
		fallback.close();
		fallback.closeAllConnections();
	} else await doors.close();
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

test("a token the server never gave is refused the same three ways", async () => {
	const answers = await Promise.all([byScript(url, "nope", "deck.now", {}), byCommand(url, "nope", "deck.now", {}), byMcp(url, "nope", "deck.now", {})]);
	assert.equal((answers[0] as { refusal: { code: string } }).refusal.code, "refused");
	assert.deepEqual(answers[1], answers[0]);
	assert.deepEqual(answers[2], answers[0]);
});

test("the SDK hears an event through the real socket", async () => {
	const heard: Heard[] = [];
	const stream = clientFor(url, token).events((event) => heard.push(event));
	await new Promise((resolve) => setTimeout(resolve, 200));
	await byScript(url, token, "item.move", { id: "n1", canvas: "plan" });
	await new Promise((resolve) => setTimeout(resolve, 200));
	stream.stop();
	assert.ok(heard.some((one) => one.name === "item.changed"), JSON.stringify(heard));
});

test("decks login trades the person's token for a terminal's own, kept by address", async () => {
	const home = mkdtempSync(`${tmpdir()}/decks-login-`);
	const saved = { ...process.env };
	try {
		Object.assign(process.env, { DECKS_URL: url, DECKS_TOKEN: server.token(callers.person) });
		const said = await login([], `${home}/tokens.json`);
		assert.match(said, /^Logged in/);
		const tokens = JSON.parse(readFileSync(`${home}/tokens.json`, "utf8")) as Record<string, string>;
		assert.equal(typeof tokens[url], "string");
		assert.ok("value" in (await byScript(url, tokens[url]!, "deck.now", {})));
	} finally {
		process.env = saved;
		rmSync(home, { recursive: true });
	}
});
