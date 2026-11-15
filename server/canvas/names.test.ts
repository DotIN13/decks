import assert from "node:assert/strict";
import { test } from "node:test";
import { callers, testServer } from "../kernel/testing.ts";
import type { Item } from "../kernel/types.ts";
import { canvasFeature } from "./feature.ts";
import { leafFeature, DECK, stickerFeature } from "./test-deck.ts";

// README rule 10: anywhere an item's id is taken, a page's path is too: a
// card's as its folder or its index.html, an older page's as its file.

const ann = callers.agent("ann", "plan");
const FULL = "canvases/plan/stickers/s1/index.html";
const NAMES = [FULL, "stickers/s1/index.html", "canvases/plan/stickers/s1", "stickers/s1"];

async function withPage() {
	const s = await testServer({ features: [canvasFeature({ clock: () => 5 }), stickerFeature(), leafFeature()], deck: DECK });
	await s.value("item.insert", { item: { type: "sticker", id: "st", path: FULL }, at: { x: 0, y: 600 } }, ann);
	return s;
}

for (const name of NAMES) {
	test(`${name} names the page in get, update, replace, move and copy`, async () => {
		const s = await withPage();
		assert.equal((await s.value<Item>("item.get", { id: name }, ann)).id, "st");
		assert.equal((await s.value<Item>("item.update", { id: name, at: { x: 10, y: 610 } }, ann)).box!.x1, 10);
		assert.equal((await s.value<Item>("item.move", { id: name, at: { x: 20, y: 620 } }, ann)).box!.x1, 20);
		assert.equal((await s.value<Item>("item.copy", { id: name, as: "st2", at: { x: 900, y: 900 } }, ann)).id, "st2");
		assert.equal((await s.value<Item>("item.replace", { id: name, item: { type: "sticker", path: FULL } }, ann)).id, "st");
		await s.close();
	});

	test(`${name} names the page in delete, beside, below, list's of, clip and space's near`, async () => {
		const s = await withPage();
		assert.deepEqual((await s.value<Item>("item.insert", { item: { type: "note", id: "n1" }, beside: name }, ann)).box!.x1, 460);
		assert.deepEqual((await s.value<Item>("item.insert", { item: { type: "note", id: "n2" }, below: name }, ann)).box!.y1, 960);
		assert.equal((await s.value<Item[]>("item.batch", { ops: [{ op: "move", id: name, at: { x: 0, y: 650 } }] }, ann))[0]!.id, "st");
		assert.equal((await s.value<{ items: number }>("item.clip", { ids: [name], id: `c-${name}` }, ann)).items, 1);
		assert.deepEqual(await s.value("item.space", { size: { w: 10, h: 10 }, near: name, side: "left" }, ann), { x: -170, y: 650 });
		assert.equal(s.kernel.canvas("plan").read({ ids: [name] })[0]!.id, "st");
		assert.deepEqual(await s.value("item.delete", { id: name }, ann), { deleted: name });
		await s.close();
	});
}

test("an older page is named by its file, with or without the canvas's folder", async () => {
	const s = await testServer({ features: [canvasFeature(), leafFeature()], deck: DECK });
	await s.value("item.insert", { item: { type: "leaf", id: "b1", file: "leaves/old.html" }, at: { x: 0, y: 600 } }, ann);
	assert.equal((await s.value<Item>("item.get", { id: "leaves/old.html" }, ann)).id, "b1");
	assert.equal((await s.value<Item>("item.get", { id: "canvases/plan/leaves/old.html" }, ann)).id, "b1");
	await s.close();
});
