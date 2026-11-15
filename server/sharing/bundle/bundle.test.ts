import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { calls } from "../../../protocol/index.ts";
import { testServer } from "../../kernel/testing.ts";
import { defineFeature, handle, type CanvasDoc, type Item } from "../../kernel/types.ts";
import { sharingFeature } from "../feature.ts";
import { bundleFileName, resolveRef } from "./bundle.ts";

// GET /api/bundle/<canvas>: the canvas as one .decks zip, with its folder,
// lib/, the files its cards name, and a manifest; nothing else of the deck.

function unzip(bytes: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	let at = bytes.readUInt32LE(end + 16);
	for (let n = bytes.readUInt16LE(end + 10); n > 0; n--) {
		const method = bytes.readUInt16LE(at + 10);
		const size = bytes.readUInt32LE(at + 20);
		const nameLength = bytes.readUInt16LE(at + 28);
		const local = bytes.readUInt32LE(at + 42);
		const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
		const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		const body = bytes.subarray(start, start + size);
		out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
		at += 46 + nameLength;
	}
	return out;
}

const card = "canvases/plan/cards/q3/index.html";
const items: Item[] = [{ type: "card", id: "q3", card, title: "Q3", box: { x1: 10, y1: 20, x2: 410, y2: 320 } }];
const doc: CanvasDoc = { read: () => items, apply: () => ({ items: [], rev: 0 }), since: () => [] };
const standIn = defineFeature({
	name: "stand-in",
	calls: [handle(calls.canvas.get, () => ({ name: "plan", title: "The Plan", open: [], cards: 1, rev: 7 }))],
	canvases: () => ({ name: (n) => n, doc: () => doc }),
});

test("a person downloads a canvas as one .decks zip", async () => {
	const deck = {
		"canvases/plan/canvas.pen": JSON.stringify({ children: [{ type: "note", id: "n" }] }),
		[card]: '<link href="card.css"><img src="../../../../assets/logo.png"><a href="../other/index.html">x</a>',
		"canvases/plan/cards/q3/card.css": "body { background: url(bg.png) }",
		"canvases/plan/cards/q3/bg.png": "png",
		"canvases/plan/cards/other/index.html": "other",
		"assets/logo.png": "logo",
		"assets/unused.png": "no",
		"lib/cards.css": "lib",
		"canvases/elsewhere/canvas.pen": "{}",
	};
	const server = await testServer({ features: [sharingFeature({ transport: { fetch: async () => new Response("{}") } }), standIn], deck });
	const doors = await server.listen(4653);
	try {
		const res = await fetch(`${doors.url}/api/bundle/plan`, { headers: { authorization: `Bearer ${doors.token}` } });
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("content-type"), "application/zip");
		assert.match(res.headers.get("content-disposition") ?? "", /The Plan\.decks/);
		const files = unzip(Buffer.from(await res.arrayBuffer()));
		const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
		assert.deepEqual(manifest.stage, { name: "plan", title: "The Plan", rev: 7 });
		assert.deepEqual([manifest.boards[0].path, manifest.boards[0].w, manifest.boards[0].h], [card, 400, 300]);
		assert.equal(manifest.pen.base, "canvases/plan/");
		const names = [...files.keys()].filter((n) => n !== "manifest.json").sort();
		assert.ok(names.includes("deck/assets/logo.png") && names.includes("deck/lib/cards.css") && names.includes(`deck/${card}`));
		assert.ok(!names.includes("deck/assets/unused.png") && !names.some((n) => n.includes("elsewhere")), "nothing the canvas does not name");
		assert.equal(files.get("deck/canvases/plan/cards/q3/bg.png")!.toString(), "png");
		const card404 = await fetch(`${doors.url}/api/bundle/plan`, { headers: { authorization: `Bearer ${server.token({ kind: "card", id: card, name: card, canvas: "plan" })}` } });
		assert.equal(card404.status, 403, "only the person downloads");
	} finally {
		await doors.close();
		await server.close();
	}
});

test("references stay inside the deck, and the file name is safe", () => {
	assert.equal(resolveRef("canvases/a/cards/x/index.html", "../../files/p%20q.png?x=1"), "canvases/a/files/p q.png");
	assert.equal(resolveRef("canvases/a/cards/x/index.html", "https://x.test/a.png"), undefined);
	assert.equal(resolveRef("assets/a.css", "../../etc/passwd"), undefined);
	assert.equal(bundleFileName('a/b: "c"'), "a b c.decks");
});
