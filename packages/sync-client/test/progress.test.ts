import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serialize } from "@decks/pen";
import { Live, MemoryStore, syncHandler, type Who } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { HarnessSync, type SyncProgress } from "../src/index.ts";

/*
 * How far a deck is in step with Studio, as the harness says it: the work a pass finds due (every
 * file it will send or take, with its bytes), counted done as each is dealt with, then in step; a
 * second pass with nothing changed finds nothing due; Studio out of reach says offline, and why.
 */
let root = "";
let url = "";
let server: Server;
const store = new MemoryStore();
const live = new Live(store);
const keys = new Map<string, Who>();
let busyPuts = 0;

before(async () => {
	root = mkdtempSync(join(tmpdir(), "sync-progress-"));
	store.name("ada", "Ada Lovelace");
	store.name("bo", "Bo");
	keys.set("mini", {
		user: { id: "ada", name: "Ada Lovelace" },
		harness: { id: "h-mini", name: "mini" },
	});
	keys.set("busy", { user: { id: "bo", name: "Bo" }, harness: { id: "h-busy", name: "busy" } });
	keys.set("laptop", {
		user: { id: "ada", name: "Ada Lovelace" },
		harness: { id: "h-laptop", name: "laptop" },
	});
	const handle = nodeHandler(
		syncHandler({
			store,
			live,
			who: (req) => keys.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""),
		}),
	);
	server = createServer(async (req, res) => {
		// Studio's limits, for the test that asks: its key gets a wait for files once it has sent two.
		if (req.headers.authorization === "Bearer busy" && req.method === "PUT" && req.url?.includes("/files?") && ++busyPuts > 2 && busyPuts <= 4) {
			res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" }).end(JSON.stringify({ error: "Too many uploads." }));
			return;
		}
		if (!(await handle(req, res))) res.writeHead(404).end();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
	server.closeAllConnections();
	server.close();
	rmSync(root, { recursive: true, force: true });
});

const write = (path: string, text: string | Buffer) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};
const drawing = serialize({
	version: "2.14",
	children: [{ id: "n1", type: "note", content: "hello", x: 0, y: 0 }],
} as never);

test("a first pass counts every file due with its bytes, says each done as it goes up, and ends in step", async () => {
	const deck = join(root, "mini");
	write(join(deck, "canvases", "plan", "canvas.pen"), drawing);
	write(join(deck, "canvases", "plan", "cards", "a", "index.html"), "<h1>A</h1>");
	write(join(deck, "canvases", "plan", "files", "big.bin"), Buffer.alloc(40_000, 7));
	write(join(deck, "canvases", "notes", "canvas.pen"), drawing);
	write(join(deck, "canvases", "notes", "files", "n.txt"), "words");
	const heard: SyncProgress[] = [];
	const sync = new HarnessSync({
		deck,
		studio: url,
		key: "mini",
		log: () => {},
		progress: (p) => heard.push(p),
	});
	assert.equal(sync.progress().state, "connecting");
	await sync.sync();
	const end = sync.progress();
	assert.equal(end.state, "synced");
	assert.ok(end.syncedAt && end.syncedAt <= Date.now());
	assert.deepEqual(end.canvases, { done: 2, total: 2 });
	assert.deepEqual(end.files, { done: 3, total: 3 }, "the card, the big file and the note's file");
	assert.equal(end.bytes.total, 10 + 40_000 + 5);
	assert.equal(end.bytes.done, end.bytes.total);
	assert.ok(end.sent >= end.bytes.total, "every byte due went up");
	assert.equal(end.now, undefined, "nothing moving once in step");
	assert.ok(
		heard.some((p) => p.state === "syncing" && p.bytes.total > 0 && p.bytes.done < p.bytes.total),
		"said part way, while files went up",
	);
	assert.equal(heard.at(-1)!.state, "synced", "the last word is in step");
	await sync.stop();

	// Nothing changed: the next pass finds nothing due and sends nothing.
	const again = new HarnessSync({
		deck,
		studio: url,
		key: "mini",
		log: () => {},
	});
	await again.sync();
	assert.equal(again.progress().state, "synced");
	assert.deepEqual(again.progress().files, { done: 0, total: 0 });
	assert.equal(again.progress().sent, 0);
	await again.stop();
});

test("a second machine counts what comes down, as it learns of it from Studio's list", async () => {
	const deck = join(root, "laptop");
	mkdirSync(join(deck, "canvases"), { recursive: true });
	const sync = new HarnessSync({
		deck,
		studio: url,
		key: "laptop",
		log: () => {},
	});
	await sync.sync();
	const end = sync.progress();
	assert.equal(end.state, "synced");
	assert.deepEqual(end.files, { done: 3, total: 3 });
	assert.equal(end.bytes.done, 10 + 40_000 + 5);
	assert.ok(end.received >= end.bytes.done);
	assert.equal(end.sent, 0);
	await sync.stop();
});

test("Studio out of reach says offline, with why", async () => {
	const deck = join(root, "away");
	write(join(deck, "canvases", "plan", "canvas.pen"), drawing);
	const sync = new HarnessSync({
		deck,
		studio: "http://127.0.0.1:9",
		key: "mini",
		log: () => {},
	});
	await sync.sync();
	assert.equal(sync.progress().state, "offline");
	assert.equal(sync.progress().error, "Studio could not be reached.");
	await sync.stop();

	const refused = new HarnessSync({
		deck,
		studio: url,
		key: "nobody",
		log: () => {},
	});
	await refused.sync();
	assert.equal(refused.progress().state, "offline");
	assert.match(refused.progress().error ?? "", /refused this harness's key/);
	await refused.stop();
});

test("a wait from Studio holds what is left, counted as not done, and the pass after the wait goes on from there", async () => {
	const deck = join(root, "busy");
	write(join(deck, "canvases", "plan", "canvas.pen"), drawing);
	for (let i = 0; i < 5; i++) write(join(deck, "canvases", "plan", "files", `f${i}.txt`), "x".repeat(1000));
	const heard: SyncProgress[] = [];
	const sync = new HarnessSync({ deck, studio: url, key: "busy", log: () => {}, progress: (p) => heard.push(p) });
	await sync.sync();
	const held = sync.progress();
	assert.equal(held.state, "held");
	assert.ok(held.heldUntil && held.heldUntil > Date.now());
	assert.equal(held.files.total, 5);
	assert.equal(held.files.done, 2, "the two that went up, not the three kept back");
	assert.equal(held.bytes.done, 2000);
	for (let i = 0; i < 60 && sync.progress().state !== "synced"; i++) await new Promise((r) => setTimeout(r, 100));
	const end = sync.progress();
	assert.equal(end.state, "synced");
	assert.deepEqual(end.files, { done: 5, total: 5 }, "the bar went on from two of five");
	assert.ok(!heard.some((p) => p.state === "syncing" && p.files.total > 0 && p.files.done < 2 && p.at > held.at), "never back to nothing done");
	await sync.stop();
});
