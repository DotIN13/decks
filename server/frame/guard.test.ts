// README rule 5: a canvas pass is held to its canvas and to the frame's and its cards' calls, on every
// door. Reader's three probes (item.list and item.insert on another canvas, canvas.create) are refused,
// through the router, HTTP, the socket and MCP, and a card's script using the pass in its own address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, type Caller } from "../../protocol/index.ts";
import { testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

const deck = {
	"canvases/a/canvas.pen": JSON.stringify({ version: "2.14", children: [{ type: "document", id: "paper", x: 0, y: 0, width: 400, height: 300, path: "papers/paper.md" }] }),
	"canvases/a/canvas.json": JSON.stringify({ title: "A" }),
	"canvases/a/cards/note/index.html": "<title>Note</title><div class=\"doc\">a</div>",
	"canvases/b/canvas.pen": JSON.stringify({ version: "2.14", children: [] }),
	"canvases/b/canvas.json": JSON.stringify({ title: "B" }),
	"canvases/b/cards/secret/index.html": "<title>Secret</title><div class=\"doc\">b</div>",
	"papers/paper.md": "# Paper\n",
	"notes/private.md": "private\n",
};

const PASS: Caller = { kind: "person", id: "person~frame-1-abc", name: "you", canvas: "a" };

async function server() {
	return testServer({ features: features(), deck });
}

test("Reader's probes: a pass for a is refused on b and for canvas.create, and answered on a", async () => {
	const s = await server();
	try {
		const own = await s.call("item.list", { canvas: "a" }, PASS);
		assert.equal(own.ok, true, JSON.stringify(own));
		for (const [name, args] of [["item.list", { canvas: "b" }], ["item.insert", { canvas: "b", item: { type: "text", content: "x" } }], ["canvas.create", { title: "c" }]] as const) {
			const got = await s.call(name, args, PASS);
			assert.equal(got.ok, false, `${name} ${JSON.stringify(args)} was answered`);
			assert.match(got.ok ? "" : got.error.message, /A canvas pass may not call/);
		}
	} finally {
		await s.close();
	}
});

test("a pass's call with no canvas is filled in as its own; a card or file of another canvas is refused", async () => {
	const s = await server();
	try {
		const listed = await s.call("item.list", {}, PASS);
		assert.equal(listed.ok, true, JSON.stringify(listed));
		assert.equal((await s.call("card.get", { card: "canvases/a/cards/note/index.html" }, PASS)).ok, true);
		assert.equal((await s.call("card.get", { card: "canvases/b/cards/secret/index.html" }, PASS)).ok, false);
		assert.equal((await s.call("file.read", { path: "canvases/b/canvas.json" }, PASS)).ok, false);
		assert.equal((await s.call("file.read", { path: "notes/private.md" }, PASS)).ok, false);
		assert.equal((await s.call("file.read", { path: "papers/paper.md" }, PASS)).ok, true, "a document its drawing places");
		assert.equal((await s.call("agent.send", { agent: "x", task: "t", cards: ["canvases/b/cards/secret/index.html"] }, PASS)).ok, false);
		assert.equal((await s.call("deck.get", {}, PASS)).ok, false, "outside the frame's and the cards' calls");
	} finally {
		await s.close();
	}
});

test("on every door: HTTP, the socket and MCP refuse the pass on b, as does a card's script with the pass from its address", async () => {
	const s = await server();
	const doors = await s.listen(0);
	try {
		const asked = await fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${doors.token}`, "content-type": "application/json" }, body: JSON.stringify({ canvas: "a" }) });
		const { pass } = (await asked.json()) as { pass: string };
		const http = async (name: string, args: unknown) => (await fetch(`${doors.url}/api/v1/${name}`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json" }, body: JSON.stringify(args) })).json() as Promise<{ ok: boolean }>;
		assert.equal((await http("item.list", { canvas: "a" })).ok, true);
		assert.equal((await http("item.list", { canvas: "b" })).ok, false, "HTTP");
		assert.equal((await http("canvas.create", { title: "c" })).ok, false, "HTTP");

		const mcp = await fetch(`${doors.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${pass}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "item.insert", arguments: { canvas: "b", item: { type: "text", content: "x" } } } }) });
		const rpc = (await mcp.json()) as { result?: { isError?: boolean } };
		assert.equal(rpc.result?.isError, true, "MCP");

		// A card's script reads its own file address, takes the pass from it, and opens the socket with it.
		const address = `${doors.url}/api/t/${pass}/card/canvases/a/cards/note/index.html`;
		const stolen = /\/api\/t\/([^/]+)\//.exec(address)![1]!;
		const ws = new WebSocket(`${doors.url.replace("http", "ws")}/api/v1/socket`);
		const answers = new Map<number, { ok: boolean }>();
		await new Promise<void>((ready, fail) => {
			ws.onerror = () => fail(new Error("socket error"));
			ws.onmessage = (event) => {
				const message = JSON.parse(String(event.data)) as { type: string; id?: number; envelope?: { ok: boolean } };
				if (message.type === "hello") ready();
				if (message.type === "answer") answers.set(message.id!, message.envelope!);
			};
			ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: stolen, protocol: PROTOCOL_VERSION }));
		});
		const ask = (id: number, name: string, args: unknown) => ws.send(JSON.stringify({ type: "call", id, name, args }));
		ask(1, "item.list", { canvas: "b" });
		ask(2, "agent.create", {});
		ask(3, "item.list", { canvas: "a" });
		for (let i = 0; i < 50 && answers.size < 3; i++) await new Promise((r) => setTimeout(r, 20));
		assert.equal(answers.get(1)?.ok, false, "socket: another canvas");
		assert.equal(answers.get(2)?.ok, false, "socket: an agent made");
		assert.equal(answers.get(3)?.ok, true, "socket: its own canvas");
		ws.close();
	} finally {
		await doors.close();
		await s.close();
	}
});
