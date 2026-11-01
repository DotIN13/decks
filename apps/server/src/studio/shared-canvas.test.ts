import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { Live, MemoryStore, syncHandler, type Who } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { HarnessSync } from "@decks/sync-client";
import { StagePens } from "../stage/pens.ts";

/**
 * Two harnesses on one Studio account, one canvas: an edit on either is applied there at once, sent to
 * Studio as the canvas store logged it, and comes down to the other, which writes it as Studio's. Studio
 * here is the hub's own handler over its in-memory store, on a port, with the live socket.
 */
async function studio() {
	const store = new MemoryStore();
	const live = new Live(store);
	const user = { id: "tiger", name: "Tiger" };
	const keys = new Map<string, Who>([
		["key-a", { user, harness: { id: "harness-a", name: "A" } }],
		["key-b", { user, harness: { id: "harness-b", name: "B" } }],
	]);
	const whoOf = (header: string | undefined) => keys.get(header?.startsWith("Bearer ") ? header.slice(7) : "");
	const handle = nodeHandler(syncHandler({ store, live, who: (req) => whoOf(req.headers.get("authorization") ?? undefined) }));
	const server = createServer(async (req, res) => {
		if (await handle(req, res)) return;
		res.writeHead(404);
		res.end();
	});
	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req, socket, head) => {
		const who = whoOf(req.headers.authorization);
		if (new URL(req.url ?? "/", "http://s").pathname !== "/sync/v1/live" || !who) return socket.destroy();
		wss.handleUpgrade(req, socket, head, (ws) => live.add(ws, who));
	});
	server.listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { store, url, close: () => new Promise<void>((done) => server.close(() => done())) };
}

/** A harness: a deck folder, its canvas store, and its sync, wired as index.ts wires them. */
function harness(url: string, key: string) {
	const deck = mkdtempSync(join(tmpdir(), "decks-shared-"));
	mkdirSync(join(deck, "canvases"), { recursive: true });
	const heard: string[] = [];
	const present: Array<{ name: string; by: { kind: string; id: string; name?: string; harness?: string }; pointer?: { x: number; y: number } | null; gone?: true }> = [];
	const pens = new StagePens(deck, () => {});
	const sync = new HarnessSync({
		deck,
		studio: url,
		key,
		log: (line) => heard.push(line),
		presence: (name, event) => present.push({ name, by: event.by, ...(event.pointer !== undefined ? { pointer: event.pointer } : {}), ...(event.gone ? { gone: true } : {}) }),
		remote: {
			write: (name, text, by) => {
				pens.writeFrom(name, text, { kind: "studio", id: by });
				return true;
			},
		},
	});
	pens.wrote = (name, change) => sync.edited(name, change);
	return { deck, pens, sync, heard, present, async stop() {
		await sync.stop();
		pens.close();
		rmSync(deck, { recursive: true, force: true });
	} };
}

const until = async (test: () => boolean, ms = 4000) => {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (test()) return true;
		await new Promise((done) => setTimeout(done, 25));
	}
	return test();
};
const content = (pens: StagePens, name: string, id: string) => (pens.get(name).doc.children.find((n) => n.id === id) as { content?: string } | undefined)?.content;

test("two harnesses on one canvas: an edit on either reaches the other through Studio, as Studio's, and a tie ends the same on both", async () => {
	const s = await studio();
	const a = harness(s.url, "key-a");
	const b = harness(s.url, "key-b");
	try {
		const name = a.pens.claim("Room");
		a.pens.edit(name, [{ op: "insert", node: { type: "note", id: "n", content: "one" }, box: { x1: 0, y1: 0 } }]);
		await a.sync.start();
		await b.sync.start();
		assert.ok(await until(() => content(b.pens, name, "n") === "one"), `B has the canvas from Studio: ${b.heard.join(" / ")}`);
		const id = Object.values(s.store.canvases("tiger"))[0]!.id;

		// A edits: applied there at once, sent as logged, down to B as Studio's.
		a.pens.edit(name, [{ op: "update", id: "n", set: { content: "two" } }]);
		assert.equal(content(a.pens, name, "n"), "two");
		assert.ok(await until(() => content(b.pens, name, "n") === "two"), `B hears A's edit: B has ${content(b.pens, name, "n")}`);
		assert.equal((s.store.canvas(id)!.pen.children[0] as { content?: string }).content, "two", "Studio has it");
		const onB = b.pens.changesSince(name, 0).at(-1)!;
		assert.equal(onB.by.kind, "studio", "B's store records the write as Studio's");
		// A's own edit came back down as a live message naming A as its client: nothing of it is written on A again as Studio's.
		await new Promise((done) => setTimeout(done, 300));
		assert.equal(a.pens.changesSince(name, 0).some((r) => r.by.kind === "studio"), false, "A wrote nothing of its own edit again");

		// B edits: up, and down to A.
		b.pens.edit(name, [{ op: "insert", node: { type: "note", id: "m", content: "from b" }, box: { x1: 400, y1: 0 } }]);
		assert.ok(await until(() => content(a.pens, name, "m") === "from b"), `A hears B's edit: ${a.pens.get(name).doc.children.map((n) => n.id).join(",")}`);

		// Both set the same field at once: Studio orders them, and both end on what Studio has.
		a.pens.edit(name, [{ op: "update", id: "n", set: { content: "from a" } }]);
		b.pens.edit(name, [{ op: "update", id: "n", set: { content: "from b" } }]);
		assert.ok(await until(() => content(a.pens, name, "n") === content(b.pens, name, "n") && content(a.pens, name, "n") === (s.store.canvas(id)!.pen.children[0] as { content?: string }).content && ["from a", "from b"].includes(content(a.pens, name, "n") ?? "")), `tie settled: A ${content(a.pens, name, "n")}, B ${content(b.pens, name, "n")}, Studio ${(s.store.canvas(id)!.pen.children[0] as { content?: string }).content}`);

		// Presence: where someone on A is goes up A's socket and comes down B's, naming A's harness; A hears nothing of its own.
		a.sync.presence(name, { by: { kind: "person", id: "l1", color: "#2563eb" }, pointer: { x: 5, y: 6 } });
		assert.ok(await until(() => b.present.length > 0), "B hears A's presence through Studio");
		assert.deepEqual(b.present[0], { name, by: { kind: "person", id: "l1", color: "#2563eb", harness: "harness-a" }, pointer: { x: 5, y: 6 } });
		assert.equal(a.present.length, 0, "never back to the harness that said it");
		a.sync.presence(name, { by: { kind: "person", id: "l1", color: "#2563eb" }, gone: true });
		assert.ok(await until(() => b.present.some((one) => one.gone)), "and the leave");
	} finally {
		await a.stop();
		await b.stop();
		await s.close();
	}
});
