import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, serialize } from "@decks/pen";
import type { Caller } from "../../../protocol/index.ts";
import { MemoryDeck } from "../../kernel/memory-deck.ts";
import { toDeckPath } from "../../kernel/types.ts";
import { memoryStore, memoryStudio } from "../testing.ts";
import { DeckSync } from "./sync.ts";

const me: Caller = { kind: "person", id: "ada", name: "Ada" };
const drawing = (...notes: string[]) => serialize({ version: "2.14", children: notes.map((id, i) => ({ id, type: "note", content: id, x: i * 100, y: 0 })) } as never);
const read = async (deck: MemoryDeck, path: string) => new TextDecoder().decode(await deck.read(toDeckPath(path)));
const write = (deck: MemoryDeck, path: string, text: string) => deck.write(toDeckPath(path), new TextEncoder().encode(text), me);
const until = async (ok: () => boolean | Promise<boolean>, ms = 3000) => {
	const end = Date.now() + ms;
	while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
	return ok();
};

function world() {
	const studio = memoryStudio();
	studio.hub.name("ada", "Ada Lovelace");
	studio.keys.set("ada", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-ada", name: "mini" } });
	studio.keys.set("bob", { user: { id: "bob", name: "Bob" }, harness: { id: "h-bob", name: "laptop" } });
	const harness = (key: string, more: Partial<ConstructorParameters<typeof DeckSync>[0]> = {}) => {
		const deck = new MemoryDeck();
		const store = memoryStore();
		return { deck, store, sync: new DeckSync({ deck, store, url: studio.url, key, transport: studio.transport, ...more }) };
	};
	return { studio, harness };
}

test("a canvas shared with me lands in shared/canvases/<owner>/, and one shared to view never pushes", async () => {
	const { studio, harness } = world();
	const ada = harness("ada");
	await write(ada.deck, "canvases/plan/canvas.pen", drawing("n1"));
	await write(ada.deck, "canvases/plan/files/a.txt", "from ada");
	await ada.sync.sync();
	const id = studio.hub.canvases("ada")[0]!.id;
	studio.hub.share(id, "bob", "view");
	const bob = harness("bob");
	await bob.sync.sync();
	const folder = "shared/canvases/ada-lovelace/plan";
	assert.deepEqual(parse(await read(bob.deck, `${folder}/canvas.pen`)).children.map((n) => n.id), ["n1"]);
	assert.equal(await read(bob.deck, `${folder}/files/a.txt`), "from ada");
	await write(bob.deck, `${folder}/canvas.pen`, drawing("n1", "bobs"));
	await write(bob.deck, `${folder}/files/b.txt`, "from bob");
	await bob.sync.sync();
	assert.deepEqual(studio.hub.canvas(id)!.pen.children.map((n) => n.id), ["n1"], "a viewer's edit stays home");
	assert.equal(studio.hub.canvasFiles(id).length, 1);
});

test("a change made elsewhere comes down as edits, and Studio's live socket starts the pass", async () => {
	const { studio, harness } = world();
	const one = harness("ada");
	const two = harness("ada");
	await write(one.deck, "canvases/plan/canvas.pen", drawing("n1"));
	await one.sync.sync();
	await two.sync.sync();
	await two.sync.start();
	await write(one.deck, "canvases/plan/canvas.pen", drawing("n1", "n2"));
	await one.sync.sync();
	const ids = async () => parse(await read(two.deck, "canvases/plan/canvas.pen")).children.map((n) => n.id).join(",");
	assert.ok(await until(async () => (await ids()) === "n1,n2"), await ids());
	await two.sync.stop();
});

test("secrets and dependencies never sync", async () => {
	const { studio, harness } = world();
	const ada = harness("ada");
	await write(ada.deck, "canvases/plan/canvas.pen", drawing("n1"));
	for (const name of ["server.pem", "id_rsa", "credentials.json", "node_modules/x/index.js", "keys.png"]) await write(ada.deck, `canvases/plan/files/${name}`, "x");
	await ada.sync.sync();
	assert.deepEqual(studio.hub.canvasFiles(studio.hub.canvases("ada")[0]!.id).map((f) => f.path), ["files/keys.png"]);
});

test("the app list goes up once a connection, then only when a name, title or kind changes; an older Studio's 404 is no failure", async () => {
	const { studio, harness } = world();
	const apps = [{ name: "trip", title: "Trip", kind: "server", status: "running" }];
	const ada = harness("ada", { inventory: () => apps });
	await ada.sync.sync();
	await ada.sync.sync();
	assert.deepEqual(studio.hub.inventory.get("h-ada"), [{ name: "trip", title: "Trip", kind: "server" }]);
	const puts = () => (studio.hub.inventory.get("h-ada") ?? []).length;
	apps[0]!.status = "asleep";
	studio.hub.inventory.clear();
	await ada.sync.sync();
	assert.equal(puts(), 0, "a change of status is not a change of the list");
	apps.push({ name: "notes", title: "Notes", kind: "static", status: "running" });
	await ada.sync.sync();
	assert.equal(puts(), 2);
	const old = memoryStudio((req) => (new URL(req.url).pathname === "/sync/v1/inventory" ? new Response("{}", { status: 404 }) : undefined));
	old.keys.set("ada", { user: { id: "ada", name: "Ada" }, harness: { id: "h", name: "m" } });
	const deck = new MemoryDeck();
	await new DeckSync({ deck, store: memoryStore(), url: old.url, key: "ada", transport: old.transport, inventory: () => apps }).sync();
});

test("a token asked on the live socket is answered on it, and a revoked key unlinks the deck", async () => {
	const { studio, harness } = world();
	const why: string[] = [];
	const ada = harness("ada", { issueToken: (ask) => ({ token: `dk_h_for_${ask.user.name}`, expires: 9 }), unlinked: (reason) => why.push(reason) });
	await ada.sync.sync();
	await ada.sync.start();
	await new Promise((r) => setTimeout(r, 10));
	assert.deepEqual(await studio.live.askToken("h-ada", { id: "ada", name: "Ada" }, "https://studio.test", 1000), { token: "dk_h_for_Ada", expires: 9 });
	studio.live.dropHarness("h-ada");
	assert.ok(await until(() => why.length > 0));
	assert.equal(why[0], "revoked");
	await ada.sync.stop();
});
