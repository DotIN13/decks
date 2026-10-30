import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, serialize } from "@decks/pen";
import { HarnessSync } from "@decks/sync-client";
import { WebSocketServer } from "ws";
import { Live, MemoryStore, NotConnected, syncHandler, type Who } from "../src/index.ts";
import { nodeHandler } from "../src/node.ts";

/*
 * A whole sharing service in a few lines: a MemoryStore, a key per harness, the hub's handler and
 * its live socket. Real harness sync (@decks/sync-client) runs against it, as it does against Studio.
 */
let root = "";
let url = "";
let server: Server;
const store = new MemoryStore();
const live = new Live(store);
const keys = new Map<string, Who>();
const harness = (key: string, user: string, name: string) => keys.set(key, { user: { id: user, name }, harness: { id: `h-${key}`, name: key } });

before(async () => {
	root = mkdtempSync(join(tmpdir(), "hub-site-"));
	const who = (req: Request) => keys.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
	const handle = nodeHandler(syncHandler({ store, live, who }));
	server = createServer(async (req, res) => {
		if (!(await handle(req, res))) res.writeHead(404).end();
	});
	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req, socket, head) => {
		const found = keys.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
		if (!found || !req.url?.startsWith("/sync/v1/live")) return socket.destroy();
		wss.handleUpgrade(req, socket, head, (ws) => live.add(ws, found));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
	server.closeAllConnections();
	server.close();
	rmSync(root, { recursive: true, force: true });
});

const deck = (name: string) => {
	const d = join(root, name);
	mkdirSync(join(d, "canvases"), { recursive: true });
	return d;
};
const penAt = (folder: string) => parse(readFileSync(join(folder, "canvas.pen"), "utf8"));
const write = (path: string, text: string) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};
const quiet = () => {};

test("two harnesses and a friend's share in step through a hub with a memory store", async () => {
	store.name("ada", "Ada Lovelace");
	harness("mini", "ada", "Ada Lovelace");
	harness("laptop", "ada", "Ada Lovelace");
	harness("friend", "bob", "Bob");
	const a = deck("mini"), b = deck("laptop"), f = deck("friend");
	const sa = new HarnessSync({ deck: a, studio: url, key: "mini", log: quiet });
	const sb = new HarnessSync({ deck: b, studio: url, key: "laptop", log: quiet });
	const sf = new HarnessSync({ deck: f, studio: url, key: "friend", log: quiet });

	write(join(a, "canvases", "plan", "canvas.pen"), serialize({ version: "2.14", children: [{ id: "n1", type: "note", content: "one", x: 0, y: 0 }] } as never));
	write(join(a, "canvases", "plan", "boards", "plan.html"), "<h1>Plan</h1>");
	await sa.sync();
	await sb.sync();
	const id = store.canvases("ada").find((c) => c.name === "plan")!.id;
	assert.equal(penAt(join(b, "canvases", "plan")).children[0]!.id, "n1", "the canvas reached the second harness");
	assert.equal(readFileSync(join(b, "canvases", "plan", "boards", "plan.html"), "utf8"), "<h1>Plan</h1>", "and its board");

	// Both edit different items; after a round, both have both edits, merged by the hub.
	const docA = penAt(join(a, "canvases", "plan"));
	(docA.children[0] as { content: string }).content = "edited on the mini";
	write(join(a, "canvases", "plan", "canvas.pen"), serialize(docA));
	const docB = penAt(join(b, "canvases", "plan"));
	docB.children.push({ id: "n2", type: "note", content: "from the laptop", x: 0, y: 200 } as never);
	write(join(b, "canvases", "plan", "canvas.pen"), serialize(docB));
	await sa.sync(); await sb.sync(); await sa.sync();
	for (const d of [a, b]) {
		const doc = penAt(join(d, "canvases", "plan"));
		assert.equal((doc.children[0] as { content: string }).content, "edited on the mini");
		assert.equal(doc.children.length, 2);
	}

	// Shared with a friend to view: it lands in their shared/canvases/<owner>/, and their edits stay theirs.
	store.share(id, "bob", "view");
	await sf.sync();
	const theirs = join(f, "shared", "canvases", "ada-lovelace", "plan");
	assert.equal(penAt(theirs).children.length, 2);
	assert.equal(store.revOf(id) > 1, true);
	const rev = store.revOf(id);
	const docF = penAt(theirs);
	docF.children.pop();
	write(join(theirs, "canvas.pen"), serialize(docF));
	await sf.sync();
	assert.equal(store.revOf(id), rev, "a viewer's change does not reach the hub");
});

test("the handler refuses what a harness may not do", async () => {
	const call = (path: string, key: string, init: RequestInit = {}) => fetch(url + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
	assert.equal((await call("/sync/v1/canvases", "nobody")).status, 401);
	const id = store.canvases("ada")[0]!.id;
	assert.equal((await call(`/sync/v1/canvases/${id}/files?path=${encodeURIComponent("../../.ssh/x")}`, "mini", { method: "PUT", body: "x" })).status, 400);
	assert.equal((await call(`/sync/v1/canvases/${id}/files?path=boards/x.html`, "friend", { method: "PUT", body: "x" })).status, 403, "a viewer may not write");
	assert.equal((await call(`/sync/v1/canvases/${id}/edits`, "friend", { method: "POST", body: JSON.stringify({ base: 1, edits: [] }) })).status, 403);
	assert.equal((await call("/sync/v1/canvases", "mini", { method: "POST", body: JSON.stringify({ name: "../x" }) })).status, 400);
	assert.equal((await call("/sync/v1/canvases/nope", "mini")).status, 404);
});

/** Until `ready()` holds, looking every 20 ms, for at most two seconds. */
async function until(ready: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !ready(); i++) await new Promise((r) => setTimeout(r, 20));
	assert.ok(ready(), "in time");
}

test("a harness gives a token only when asked over its own key's socket, and an ask of a harness with none open fails at once", async () => {
	harness("asked", "ada", "Ada Lovelace");
	harness("quiet", "ada", "Ada Lovelace");
	harness("refuses", "ada", "Ada Lovelace");
	const asks: { user: { id: string; name: string }; origin: string }[] = [];
	const sa = new HarnessSync({ deck: deck("asked"), studio: url, key: "asked", log: quiet, issueToken: (ask) => (asks.push(ask), { token: "dk_h_given", expires: 1234 }) });
	const sr = new HarnessSync({ deck: deck("refuses"), studio: url, key: "refuses", log: quiet });
	const open = () => live.size;
	const before = open();
	await sa.start();
	await sr.start();
	try {
		await until(() => open() === before + 2);
		assert.deepEqual(await live.askToken("h-asked", { id: "ada", name: "Ada Lovelace" }, "https://studio.test"), { token: "dk_h_given", expires: 1234 });
		assert.deepEqual(asks, [{ user: { id: "ada", name: "Ada Lovelace" }, origin: "https://studio.test" }], "the harness heard who and where");
		await assert.rejects(live.askToken("h-refuses", { id: "ada", name: "Ada" }, "https://studio.test"), /gives no tokens through Studio/, "a harness without issueToken says why");
		await assert.rejects(live.askToken("h-quiet", { id: "ada", name: "Ada" }, "https://studio.test"), NotConnected, "no socket, no token");
	} finally {
		await sa.stop();
		await sr.stop();
	}
});

test("an answer counts only from the harness that was asked, and an ask nobody answers runs out", async () => {
	const local = new Live(store);
	const sockets: { sent: string[]; message?: (data: unknown) => void; close?: () => void }[] = [];
	const socket = (key: string) => {
		const one: (typeof sockets)[number] = { sent: [] };
		sockets.push(one);
		local.add({ send: (text) => one.sent.push(text), close: () => {}, on: ((event: string, listener: (data?: unknown) => void) => void (event === "message" ? (one.message = listener) : (one.close = listener as () => void))) as never }, keys.get(key)!);
		return one;
	};
	const asked = socket("mini");
	const other = socket("laptop");
	const answer = local.askToken("h-mini", { id: "ada", name: "Ada" }, "https://studio.test", 200);
	const ask = JSON.parse(asked.sent.at(-1)!) as { type: string; id: string };
	assert.equal(ask.type, "token.ask");
	assert.ok(!other.sent.some((text) => text.includes("token.ask")), "only the harness asked hears the ask");
	other.message!(JSON.stringify({ type: "token", id: ask.id, token: "dk_h_forged", expires: 1 }));
	asked.message!(JSON.stringify({ type: "token", id: ask.id, token: "dk_h_real", expires: 2 }));
	assert.deepEqual(await answer, { token: "dk_h_real", expires: 2 }, "another harness's answer to it is ignored");
	await assert.rejects(local.askToken("h-mini", { id: "ada", name: "Ada" }, "https://studio.test", 30), NotConnected, "no answer in time");
	const gone = local.askToken("h-mini", { id: "ada", name: "Ada" }, "https://studio.test", 5000);
	asked.close!();
	await assert.rejects(gone, /went away/, "its socket closing fails the ask at once");
});
