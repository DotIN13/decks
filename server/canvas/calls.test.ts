import assert from "node:assert/strict";
import { test } from "node:test";
import { callers, testServer } from "../kernel/testing.ts";
import { toDeckPath, type Item } from "../kernel/types.ts";
import { canvasFeature } from "./feature.ts";
import { DECK, NOTE, stickerFeature } from "./test-deck.ts";

// The canvas feature's calls, made through the kernel's test server on an
// in-memory deck, one case per README rule, in the README's order.

const ann = callers.agent("ann", "plan");
const bob = callers.agent("bob", "plan");
const start = (deck: Record<string, string> = DECK) => testServer({ features: [canvasFeature({ clock: () => 5 }), stickerFeature()], deck });
const text = async (s: Awaited<ReturnType<typeof start>>, path: string) => new TextDecoder().decode(await s.deck.read(toDeckPath(path)));

test("insert, update, replace, move, copy and delete each answer the item as it now is", async () => {
	const s = await start();
	const made = await s.value<Item>("item.insert", { item: { type: "note", id: "c", content: "C", width: 100, height: 50 }, below: "a" }, ann);
	assert.deepEqual(made.box, { x1: 0, y1: 260, x2: 100, y2: 310 });
	assert.equal((await s.value<Item>("item.update", { id: "c", set: { content: "Sea" }, size: { w: 300 } }, ann)).box!.x2, 300);
	assert.equal((await s.value<Item & { content: string }>("item.replace", { id: "c", item: { type: "text", content: "T" } }, ann)).type, "text");
	assert.deepEqual((await s.value<Item>("item.move", { id: "c", beside: "b" }, ann)).box!.x1, 720);
	const copy = await s.value<Item>("item.copy", { id: "a", as: "a2", at: { x: 0, y: 900 } }, ann);
	assert.deepEqual([copy.id, copy.box!.y1], ["a2", 900]);
	assert.deepEqual(await s.value("item.delete", { id: "a2" }, ann), { deleted: "a2" });
	assert.equal((await s.value<Item[]>("item.list", {}, ann)).length, 3);
	await s.close();
});

test("item.variables sets a colour that follows the theme, and the change is in the log", async () => {
	const s = await start();
	const canvas = await s.value<{ variables: Record<string, unknown> }>("item.variables", { set: { brand: { light: "#111111", dark: "#eeeeee" } } }, ann);
	assert.deepEqual(canvas.variables.brand, { light: "#111111", dark: "#eeeeee" });
	assert.equal(s.kernel.canvas("plan").since(0)[0]!.ops[0]!.op, "variables");
	await s.close();
});

test("a batch with one bad op changes nothing, and says which op and why", async () => {
	const s = await start();
	const before = await text(s, "canvases/plan/canvas.pen");
	const answer = await s.call("item.batch", { ops: [{ op: "insert", item: { type: "note" } }, { op: "move", id: "zz", at: { x: 0, y: 0 } }] }, ann);
	assert.equal(answer.ok, false);
	if (!answer.ok) assert.match(answer.error.message, /^Op 2 \(move\) failed, so nothing changed: Nothing called zz/);
	assert.equal(await text(s, "canvases/plan/canvas.pen"), before);
	assert.equal(s.heard.filter((e) => e.name === "item.changed").length, 0);
	await s.close();
});

test("two callers' edits get rising revisions, each with its author, announced as item.changed", async () => {
	const s = await start();
	await s.value("item.update", { id: "a", set: { content: "1" } }, ann);
	await s.value("item.update", { id: "b", set: { content: "2" } }, bob);
	const heard = s.heard.filter((e) => e.name === "item.changed").map((e) => [e.payload.rev, e.payload.by, e.payload.ids]);
	assert.deepEqual(heard, [[1, "ann", ["a"]], [2, "bob", ["b"]]]);
	assert.deepEqual(s.kernel.canvas("plan").since(1).map((c) => [c.rev, c.by, c.at]), [[2, "bob", 5]]);
	await s.close();
});

test("item.changed comes after the file is written, so a listener reads the new drawing", async () => {
	const s = await start();
	let seen = "";
	s.kernel.events.on((await import("../../protocol/index.ts")).events.itemChanged, () => {
		void s.deck.read(toDeckPath("canvases/plan/canvas.pen")).then((b) => { seen = new TextDecoder().decode(b); });
	});
	await s.value("item.update", { id: "a", set: { content: "fresh" } }, ann);
	await new Promise((r) => setTimeout(r, 5));
	assert.match(seen, /"fresh"/);
	await s.close();
});

test("a write from outside the server is read in as one change by its writer", async () => {
	const s = await start();
	const writer = callers.agent("pen.dev");
	await s.deck.write(toDeckPath("canvases/plan/canvas.pen"), new TextEncoder().encode(JSON.stringify({ version: "2.14", children: [NOTE("a", 0, 0, "outside")] })), writer);
	await waitFor(async () => s.kernel.canvas("plan").since(0).length, (n) => n > 0);
	assert.deepEqual(s.kernel.canvas("plan").since(0).map((c) => c.by), ["pen.dev"]);
	assert.deepEqual(s.heard.filter((e) => e.name === "item.changed").map((e) => [e.payload.by, [...(e.payload.ids as string[])].sort()]), [["pen.dev", ["a", "b"]]]);
	await s.close();
});

test("a drawing's versions are its file's revisions, newest first; one reads back and restores as a new change", async () => {
	const s = await start();
	await s.value("item.update", { id: "a", set: { content: "one" } }, ann);
	await s.value("item.update", { id: "a", set: { content: "two" } }, ann);
	const versions = await s.value<{ rev: number; by: string }[]>("canvas.versions", { canvas: "plan" });
	assert.ok(versions.length >= 2 && versions[0]!.rev > versions[1]!.rev && versions[0]!.by === "ann", JSON.stringify(versions));
	const older = await s.value<{ rev: number; text: string }>("canvas.version", { rev: versions[1]!.rev, canvas: "plan" });
	assert.match(older.text, /"one"/);
	const restored = await s.value<{ rev: number }>("canvas.restore", { rev: versions[1]!.rev, canvas: "plan" });
	assert.equal((await s.value<Item & { content: string }>("item.get", { id: "a", canvas: "plan" })).content, "one");
	assert.match(await text(s, "canvases/plan/canvas.pen"), /"one"/);
	assert.ok(s.heard.some((e) => e.name === "item.changed" && e.payload.rev === restored.rev && e.payload.by === "person"));
	assert.equal((await s.call("canvas.restore", { rev: versions[1]!.rev, canvas: "plan" }, ann)).ok, false);
	await s.close();
});

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
	for (let i = 0; i < 50; i++) {
		const v = await read();
		if (ok(v)) return v;
		await new Promise((r) => setTimeout(r, 5));
	}
	return read();
}

test("a drawing written back to an earlier text of its own is read in, not taken for an echo", async () => {
	const s = await start();
	await s.value("item.update", { id: "a", set: { content: "one" } }, ann);
	await new Promise((r) => setTimeout(r, 10));
	const old = await text(s, "canvases/plan/canvas.pen");
	await s.value("item.update", { id: "a", set: { content: "two" } }, ann);
	await new Promise((r) => setTimeout(r, 10));
	await s.deck.write(toDeckPath("canvases/plan/canvas.pen"), new TextEncoder().encode(old), callers.agent("studio"));
	await waitFor(async () => (await s.value<Item & { content: string }>("item.get", { id: "a" }, ann)).content, (c) => c === "one");
	assert.equal((await s.value<Item & { content: string }>("item.get", { id: "a" }, ann)).content, "one");
	await s.close();
});

test("a size with only a width leaves the height to the item", async () => {
	const s = await start();
	await s.value("item.insert", { item: { type: "frame", id: "f", layout: "vertical", width: 200, height: "fit_content(48)" }, at: { x: 0, y: 600 } }, ann);
	await s.value("item.update", { id: "f", size: { w: 320 } }, ann);
	const node = JSON.parse(await text(s, "canvases/plan/canvas.pen")).children.find((n: { id: string }) => n.id === "f");
	assert.deepEqual([node.width, node.height], [320, "fit_content(48)"]);
	await s.close();
});

test("an item given no place joins right of the newest page, in the nearest open slot", async () => {
	const s = await start({ "canvases/plan/canvas.pen": `${JSON.stringify({ version: "2.14", children: [] })}\n`, "canvases/plan/stickers/s1/index.html": "x", "canvases/plan/stickers/s2/index.html": "y" });
	await s.value("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s1/index.html" }, at: { x: 0, y: 0 } }, ann);
	assert.deepEqual((await s.value<Item>("item.insert", { item: { type: "note", id: "n", width: 240, height: 120 } }, ann)).box!.x1, 460);
	const third = await s.value<Item>("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s2/index.html", id: "s2" } }, ann);
	assert.deepEqual([third.box!.x1, third.box!.y1], [460, 280]);
	await s.close();
});

test("a page already on the canvas is not inserted again", async () => {
	const s = await start();
	await s.value("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s1/index.html" }, at: { x: 0, y: 600 } }, ann);
	const again = await s.call("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s1/index.html" } }, ann);
	assert.ok(!again.ok && again.error.code === "conflict" && /already on this canvas/.test(again.error.message));
	assert.equal((await s.value<Item[]>("item.list", {}, ann)).filter((i) => i.type === "sticker").length, 1);
	await s.close();
});

test("item.space finds room clear of everything, and nothing is placed", async () => {
	const s = await start();
	const corner = await s.value<{ x: number; y: number }>("item.space", { size: { w: 100, h: 100 }, near: "b" }, ann);
	assert.deepEqual(corner, { x: 720, y: 0 });
	assert.equal((await s.value<Item[]>("item.list", {}, ann)).length, 2);
	await s.close();
});

test("canvas.undo takes back the person's edit, and refuses naming who when an agent changed it since", async () => {
	const s = await start();
	await s.value("item.update", { id: "a", set: { content: "mine" }, canvas: "plan" });
	assert.equal((await s.value<{ undo: boolean }>("canvas.get", { canvas: "plan" })).undo, true);
	await s.value("canvas.undo", { canvas: "plan" });
	assert.equal((await s.value<Item & { content: string }>("item.get", { id: "a", canvas: "plan" })).content, "a");
	await s.value("canvas.undo", { canvas: "plan", redo: true });
	await s.value("item.update", { id: "b", set: { x: 999 } }, ann);
	const refused = await s.call("canvas.undo", { canvas: "plan" });
	assert.ok(!refused.ok && refused.error.code === "conflict" && /ann changed the drawing since/.test(refused.error.message));
	assert.equal((await s.call("canvas.undo", { canvas: "plan" }, ann)).ok, false);
	await s.close();
});

test("before a kind's item is inserted, the kind may prepare it", async () => {
	const s = await start();
	const st = await s.value<Item>("item.insert", { item: { type: "sticker", title: "new one" }, at: { x: 0, y: 600 } }, ann);
	assert.equal(st.path, "canvases/plan/stickers/new-one/index.html");
	assert.equal(await text(s, "canvases/plan/stickers/new-one/index.html"), "<p>new one</p>");
	await s.close();
});

test("a box a kind's prepare adds is a size: the item is still placed beside the newest page", async () => {
	const s = await start();
	await s.value("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s1/index.html" }, at: { x: 0, y: 600 } }, ann);
	const made = await s.value<Item>("item.insert", { item: { type: "sticker", title: "sized" } }, ann);
	assert.deepEqual(made.box, { x1: 460, y1: 600, x2: 760, y2: 800 });
	await s.close();
});

test("an arrow whose end names a card by its deck path is routed to it", async () => {
	const s = await start();
	await s.value("item.insert", { item: { type: "sticker", id: "st", path: "canvases/plan/stickers/s1/index.html" }, at: { x: 0, y: 600 } }, ann);
	const arrow = await s.value<Item>("item.insert", { item: { type: "path", id: "ar", metadata: { type: "decks.arrow", from: "a", to: "canvases/plan/stickers/s1/index.html" } } }, ann);
	assert.ok(arrow.box && arrow.box.y2 > 550, JSON.stringify(arrow.box));
	await s.close();
});

test("an item you did not touch is byte for byte the same in the file after an edit", async () => {
	const s = await start();
	const before = await text(s, "canvases/plan/canvas.pen");
	await s.value("item.update", { id: "b", set: { content: "changed" } }, ann);
	await s.kernel.canvas("plan");
	const after = await waitFor(() => text(s, "canvases/plan/canvas.pen"), (t) => t !== before);
	const a = before.slice(before.indexOf("{", 30), before.indexOf("}") + 1);
	assert.ok(after.includes(a));
	await s.close();
});

test("a kind another feature registers owns its nodes; clip and paste carry its files and give new ids", async () => {
	const s = await start();
	const st = await s.value<Item>("item.insert", { item: { type: "sticker", path: "canvases/plan/stickers/s1/index.html" }, at: { x: 0, y: 400 } }, ann);
	assert.equal(st.type, "sticker");
	assert.match(await text(s, "canvases/plan/canvas.pen").then(() => s.deck.read(toDeckPath("canvases/plan/canvas.pen"))).then((b) => new TextDecoder().decode(b)), /decks\.sticker/);
	await s.value("item.clip", { ids: [st.id!, "a"], id: "clip1" }, ann);
	const pasted = await s.value<Item[]>("item.paste", { clip: { id: "clip1", canvas: "plan" }, canvas: "other", at: { x: 10, y: 10 } }, ann);
	assert.equal(pasted.length, 2);
	assert.ok(pasted.every((i) => i.id !== "a" && i.id !== st.id));
	assert.equal(await text(s, "canvases/other/stickers/s1/index.html"), "<p>sticker</p>");
	assert.equal(pasted.find((i) => i.type === "sticker")!.path, "canvases/other/stickers/s1/index.html");
	await s.close();
});

test("item.list reads everything with its box; a canvas is named by folder or title; none named is here", async () => {
	const s = await start();
	const items = await s.value<Item[]>("item.list", {}, ann);
	assert.deepEqual(items.map((i) => [i.id, i.box]), [["a", { x1: 0, y1: 0, x2: 200, y2: 100 }], ["b", { x1: 360, y1: 0, x2: 560, y2: 100 }]]);
	assert.equal((await s.value<Item[]>("item.list", { canvas: "The plan" }, "agent")).length, 2);
	assert.equal((await s.call("item.list", {}, "agent")).ok, false);
	await s.close();
});

test("canvas.list, create, update, copy, delete and here", async () => {
	const s = await start();
	const made = await s.value<{ name: string; title: string }>("canvas.create", { title: "Road map!" });
	assert.deepEqual([made.name, made.title], ["road-map", "Road map!"]);
	await s.value("canvas.update", { canvas: "road-map", title: "Roadmap" });
	assert.equal((await s.value<{ title: string }>("canvas.get", { canvas: "Roadmap" })).title, "Roadmap");
	const copy = await s.value<{ name: string; title: string }>("canvas.copy", { canvas: "plan" });
	assert.equal(copy.title, "Copy of The plan");
	assert.equal((await s.value<Item[]>("item.list", { canvas: copy.name })).length, 2);
	assert.deepEqual(await s.value("canvas.delete", { canvas: "road-map" }), { deleted: "road-map" });
	assert.deepEqual((await s.value<{ name: string }[]>("canvas.list")).map((c) => c.name), ["copy-of-the-plan", "other", "plan"]);
	assert.equal((await s.value<{ name: string }>("canvas.here", {}, ann)).name, "plan");
	assert.ok(s.heard.some((e) => e.name === "canvas.changed"));
	await s.close();
});

test("a canvas made from outside takes its title from canvas.json, and a rename from outside is read in", async () => {
	const s = await start();
	const put = (path: string, body: string) => s.deck.write(toDeckPath(path), new TextEncoder().encode(body), callers.agent("studio"));
	await put("canvases/garden/canvas.json", JSON.stringify({ title: "Garden plan" }));
	await put("canvases/garden/canvas.pen", `${JSON.stringify({ version: "2.14", children: [] })}\n`);
	const titleOf = async () => (await s.value<{ name: string; title: string }[]>("canvas.list")).find((c) => c.name === "garden")?.title;
	assert.equal(await waitFor(titleOf, (t) => t !== undefined), "Garden plan");
	await put("canvases/garden/canvas.json", JSON.stringify({ title: "Kitchen garden" }));
	assert.equal(await waitFor(titleOf, (t) => t === "Kitchen garden"), "Kitchen garden");
	assert.ok(s.heard.some((e) => e.name === "canvas.changed" && e.payload.canvas === "garden" && e.payload.by === "studio"));
	await s.close();
});

test("frame.create, list, get and save: a frame file holds one reusable item, placed as a ref", async () => {
	const s = await start();
	const made = await s.value<{ path: string; id: string }>("frame.create", { path: "frames/ui/chip", item: { type: "note", id: "chip", content: "Chip" } }, ann);
	assert.deepEqual(made, { path: "frames/ui/chip", id: "chip", ref: "frames/ui/chip" });
	const saved = await s.value<{ path: string; id: string }>("frame.save", { id: "b", path: "frames/b" }, ann);
	assert.equal(saved.id, "b");
	assert.equal((await s.value<Item>("item.get", { id: "b" }, ann)).type, "ref");
	assert.deepEqual((await s.value<{ path: string }[]>("frame.list", {}, ann)).map((f) => f.path).sort(), ["frames/b", "frames/ui/chip"]);
	assert.equal((await s.value<{ id: string }>("frame.get", { path: "frames/b" }, ann)).id, "b");
	assert.equal((await s.value<Item[]>("item.list", { frame: "frames/b" }, ann))[0]!.id, "b");
	await s.close();
});
