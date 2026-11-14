import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { CALL_BY_NAME, CALLS, Refused } from "../../protocol/index.ts";
import { clientFor } from "../sdk/index.ts";
import { fakeServer, type Fake } from "../sdk/testing/fake-server.ts";
import { answer, shownCalls, tools } from "./index.ts";
import { jsonSchema } from "./schema.ts";

// The relay lists a tool per agent's server call, filtered by DECKS_TOOLS,
// relays a call to the server, and turns a refusal into an error result.

let fake: Fake;
before(async () => {
	fake = await fakeServer(4607, {
		"item.move": (args) => ({ type: "note", id: args.id }),
		"item.get": () => {
			throw new Refused("not_found", "No item called zz.", "item.list");
		},
	});
});
after(() => fake.close());

test("the tools are the agents' server calls, and the generated list matches the protocol", () => {
	const listed = tools("");
	assert.deepEqual(listed.map((t) => t.name), shownCalls("").map((c) => c.name));
	assert.ok(!listed.some((t) => t.name.startsWith("chat.")));
	for (const tool of listed) assert.deepEqual(tool.inputSchema, jsonSchema(CALL_BY_NAME.get(tool.name)!.input), tool.name);
	assert.ok(CALLS.length > listed.length);
});

test("DECKS_TOOLS narrows the list to nouns or calls", () => {
	const names = tools("card,view.focus").map((t) => t.name);
	assert.ok(names.includes("card.fit") && names.includes("view.focus") && !names.includes("view.get") && !names.includes("item.move"));
});

test("a tool call relays to the server; a refusal is an error result with its code and hint", async () => {
	const client = async () => clientFor(fake.url, fake.token);
	const ok = (await answer({ id: 1, method: "tools/call", params: { name: "item.move", arguments: { id: "n1" } } }, client)) as { result: { content: { text: string }[]; isError: boolean } };
	assert.equal(ok.result.isError, false);
	assert.deepEqual(JSON.parse(ok.result.content[0]!.text.split("\n").slice(0, -1).join("\n")), { type: "note", id: "n1" });
	const no = (await answer({ id: 2, method: "tools/call", params: { name: "item.get", arguments: { id: "zz" } } }, client)) as { result: { content: { text: string }[]; isError: boolean } };
	assert.equal(no.result.isError, true);
	assert.equal(no.result.content[0]!.text, "No item called zz. (not_found)\nTry item.list.");
});

test("over stdio: initialize, list, call", async () => {
	const child = spawn(process.execPath, [new URL("./main.ts", import.meta.url).pathname], { env: { ...process.env, DECKS_URL: fake.url, DECKS_TOKEN: fake.token } });
	const lines: string[] = [];
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => lines.push(...chunk.split("\n").filter(Boolean)));
	const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "item.move", arguments: { id: "n9" } } });
	for (let i = 0; i < 50 && lines.length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 50));
	child.kill();
	const byId = new Map(lines.map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> }).map((m) => [m.id, m.result]));
	assert.equal((byId.get(1)?.serverInfo as { name: string }).name, "decks");
	assert.ok((byId.get(2)?.tools as unknown[]).length > 50);
	assert.equal(byId.get(3)?.isError, false);
});
