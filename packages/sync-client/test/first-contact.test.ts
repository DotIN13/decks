import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, serialize, type PenDocument } from "@decks/pen";
import { Live, MemoryStore, syncHandler, type Who } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { conflictName, HarnessSync } from "../src/index.ts";

/*
 * A canvas is its Studio id, not its folder: a second harness arriving with a same-named canvas merges
 * into it rather than over it, a folder renamed keeps its canvas, a lost `.decks/` finds its canvases
 * again, a copied folder becomes a canvas of its own; and a file both sides have, differently, with no
 * version agreed on, is kept on both sides for a person to choose.
 */
let root = "";
let url = "";
let server: Server;
const store = new MemoryStore();
const live = new Live(store);
const keys = new Map<string, Who>();

before(async () => {
	root = mkdtempSync(join(tmpdir(), "sync-first-"));
	store.name("ada", "Ada Lovelace");
	keys.set("mini", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-mini", name: "mini" } });
	keys.set("laptop", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-laptop", name: "laptop" } });
	const handle = nodeHandler(syncHandler({ store, live, who: (req) => keys.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "") }));
	server = createServer(async (req, res) => {
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

const deck = (name: string) => {
	const d = join(root, name);
	mkdirSync(join(d, "canvases"), { recursive: true });
	return d;
};
const penAt = (folder: string) => parse(readFileSync(join(folder, "canvas.pen"), "utf8"));
const ids = (doc: PenDocument) => (doc.children as { id: string }[]).map((n) => n.id).sort();
const write = (path: string, text: string) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};
const meta = (folder: string) => JSON.parse(readFileSync(join(folder, "canvas.json"), "utf8")) as { studio?: string };
const quiet = () => {};
const drawing = (...notes: [string, string][]) => serialize({ version: "2.14", children: notes.map(([id, content], i) => ({ id, type: "note", content, x: i * 100, y: 0 })) } as never);

test("a second harness with a same-named canvas merges into it: one canvas, both drawings' items, the file kept both ways", async () => {
	const a = deck("mini");
	const b = deck("laptop");
	const sa = new HarnessSync({ deck: a, studio: url, key: "mini", log: quiet });
	const sb = new HarnessSync({ deck: b, studio: url, key: "laptop", log: quiet });
	write(join(a, "canvases", "plan", "canvas.pen"), drawing(["n1", "from the mini"]));
	write(join(a, "canvases", "plan", "boards", "plan.html"), "<h1>Plan, mini</h1>");
	await sa.sync();
	// The laptop has its own plan: another item, the same board with other words, and no record of Studio.
	write(join(b, "canvases", "plan", "canvas.pen"), drawing(["n9", "from the laptop"]));
	write(join(b, "canvases", "plan", "boards", "plan.html"), "<h1>Plan, laptop</h1>");
	await sb.sync();
	const canvases = store.canvases("ada");
	assert.equal(canvases.length, 1, "no second canvas");
	const id = canvases[0]!.id;
	assert.deepEqual(ids(store.canvas(id)!.pen), ["n1", "n9"], "both items, merged");
	assert.deepEqual(ids(penAt(join(b, "canvases", "plan"))), ["n1", "n9"], "the laptop has the merge, not Studio's copy over its own");
	assert.equal(meta(join(b, "canvases", "plan")).studio, id);
	await sa.sync();
	assert.deepEqual(ids(penAt(join(a, "canvases", "plan"))), ["n1", "n9"]);
	// The board: Studio's (the mini's) stays current, the laptop's is kept beside it and goes up.
	assert.equal(readFileSync(join(b, "canvases", "plan", "boards", "plan.html"), "utf8"), "<h1>Plan, mini</h1>");
	const kept = readdirSync(join(b, "canvases", "plan", "boards")).find((f) => f.startsWith("plan.conflict-"));
	assert.ok(kept, "a conflicted copy beside the file");
	assert.match(kept!, /^plan\.conflict-\d{8}-\d{4}\.html$/);
	assert.equal(readFileSync(join(b, "canvases", "plan", "boards", kept!), "utf8"), "<h1>Plan, laptop</h1>");
	assert.deepEqual(sb.conflicts, ["plan:boards/plan.html"]);
	await sb.sync();
	await sa.sync();
	assert.ok(existsSync(join(a, "canvases", "plan", "boards", kept!)), "and reaches the mini");
	assert.equal(store.canvasFiles(id).length, 2);
	await sa.stop();
	await sb.stop();
});

test("a folder renamed keeps its canvas; a lost .decks finds it again with its edits; a copy becomes a canvas of its own", async () => {
	const a = deck("mini");
	let sa = new HarnessSync({ deck: a, studio: url, key: "mini", log: quiet });
	const id = store.canvases("ada")[0]!.id;
	renameSync(join(a, "canvases", "plan"), join(a, "canvases", "roadmap"));
	await sa.sync();
	assert.equal(store.canvases("ada").length, 1, "a rename is not a new canvas");
	const state = JSON.parse(readFileSync(join(a, ".decks", "studio-sync.json"), "utf8")) as { canvases: Record<string, { id: string }> };
	assert.deepEqual(Object.keys(state.canvases), ["roadmap"]);
	assert.equal(state.canvases.roadmap!.id, id);
	// An edit under the new name still reaches the canvas.
	const doc = penAt(join(a, "canvases", "roadmap"));
	(doc.children as unknown[]).push({ id: "n2", type: "note", content: "renamed and edited", x: 0, y: 300 });
	write(join(a, "canvases", "roadmap", "canvas.pen"), serialize(doc));
	await sa.sync();
	assert.deepEqual(ids(store.canvas(id)!.pen), ["n1", "n2", "n9"]);
	await sa.stop();

	// The state lost, and an edit made while it was: the folder is matched by the id in canvas.json, nothing is uploaded twice, the edit goes up.
	rmSync(join(a, ".decks"), { recursive: true, force: true });
	const edited = penAt(join(a, "canvases", "roadmap"));
	(edited.children as unknown[]).push({ id: "n3", type: "note", content: "while unlinked", x: 0, y: 400 });
	write(join(a, "canvases", "roadmap", "canvas.pen"), serialize(edited));
	sa = new HarnessSync({ deck: a, studio: url, key: "mini", log: quiet });
	await sa.sync();
	assert.equal(store.canvases("ada").length, 1);
	assert.deepEqual(ids(store.canvas(id)!.pen), ["n1", "n2", "n3", "n9"], "the edit made while the state was lost is in Studio");
	assert.deepEqual(ids(penAt(join(a, "canvases", "roadmap"))), ["n1", "n2", "n3", "n9"], "and nothing local was lost");

	// A copy of the folder, canvas.json and all: a new canvas with an id of its own, the original untouched.
	cpSync(join(a, "canvases", "roadmap"), join(a, "canvases", "roadmap-copy"), { recursive: true });
	await sa.sync();
	const after = store.canvases("ada");
	assert.deepEqual(after.map((c) => c.name).sort(), ["plan", "roadmap-copy"], "Studio's name of the original stays plan; the copy is new");
	const copyId = after.find((c) => c.name === "roadmap-copy")!.id;
	assert.notEqual(copyId, id);
	assert.equal(meta(join(a, "canvases", "roadmap-copy")).studio, copyId, "the copy's canvas.json names its own canvas now");
	assert.equal(meta(join(a, "canvases", "roadmap")).studio, id);
	await sa.stop();
});

test("a conflicted copy's name", () => {
	const at = new Date("2026-11-03T00:12:45Z");
	assert.equal(conflictName("boards/plan.html", at), "boards/plan.conflict-20261103-0012.html");
	assert.equal(conflictName("files/notes", at), "files/notes.conflict-20261103-0012");
	assert.equal(conflictName("assets/.hidden", at), "assets/.hidden.conflict-20261103-0012");
});
