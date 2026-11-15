// Today's GET /api/deck lists every card, and a friend's old board, with its deck path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";

const card = (id: string, path: string, type = "decks.card") => ({ type: "browser", id, name: id, x: 0, y: 0, width: 100, height: 100, metadata: { type, path } });

test("GET /api/deck lists the cards on every canvas and a friend's old board", async () => {
	const deck = {
		"canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [card("one", "cards/one/index.html")] }),
		"canvases/plan/cards/one/index.html": "<p>one</p>",
		"shared/canvases/ada/old/canvas.pen": JSON.stringify({ version: "2.14", children: [card("notes", "boards/notes.html", "decks.board")] }),
		"shared/canvases/ada/old/boards/notes.html": "<p>notes</p>",
	};
	const server = await testServer({ features: features(), deck });
	const doors = await server.listen(0);
	const answer = await fetch(`${doors.url}/api/deck`, { headers: { authorization: `Bearer ${doors.token}` } });
	const paths = ((await answer.json()) as { deck: { boards: Array<{ path: string }> } }).deck.boards.map((b) => b.path).sort();
	assert.deepEqual(paths, ["canvases/plan/cards/one/index.html", "shared/canvases/ada/old/boards/notes.html"]);
	await doors.close();
	await server.close();
});

test("an upload lands in the canvas's files/, never over another, and where finds it", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [] }) } });
	const doors = await server.listen(0);
	const up = () => fetch(`${doors.url}/api/upload?name=${encodeURIComponent("a photo.png")}&canvas=plan`, { method: "POST", headers: { authorization: `Bearer ${doors.token}` }, body: new Uint8Array([1, 2, 3]) }).then((r) => r.json() as Promise<{ path: string; ref?: string; bytes: number }>);
	const first = await up();
	const second = await up();
	assert.deepEqual([first.path, first.ref, first.bytes], ["canvases/plan/files/a photo.png", "files/a photo.png", 3]);
	assert.equal(second.path, "canvases/plan/files/a photo-2.png");
	const where = await fetch(`${doors.url}/api/where?path=${encodeURIComponent(first.path)}`, { headers: { authorization: `Bearer ${doors.token}` } }).then((r) => r.json() as Promise<{ inDeck: boolean }>);
	assert.equal(where.inDeck, true);
	await doors.close();
	await server.close();
});


test("pages carry a card's news as today's Page did", async () => {
	const { pagesOf } = await import("./drawing.ts");
	const doc = { children: [{ type: "browser", id: "one", metadata: { type: "decks.card", path: "cards/one/index.html" } }] };
	const news = new Map([["canvases/plan/cards/one/index.html", { by: "person", named: 1, changed: 2, seen: 3 }]]);
	const [page] = pagesOf("plan", doc, false, news);
	assert.deepEqual([page!.lastWrittenBy, page!.namedAt, page!.modifiedAt, page!.seenAt], ["you", 1, 2, 3]);
});

test("a host can leave a compat route to itself", async () => {
	const { compatFeature } = await import("./feature.ts");
	const prefixes = (compatFeature({ leave: ["/api/upload"] }).routes ?? []).map((r) => r.prefix);
	assert.ok(!prefixes.includes("/api/upload") && prefixes.includes("/api/where"));
});
