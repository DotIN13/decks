import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { callers, testContext, testServer } from "../kernel/testing.ts";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { slug, titleOf } from "./cards.ts";
import { PAGE_PASS_MS } from "./calls.ts";
import { cards } from "./feature.ts";
import { cardKind } from "./item.ts";
import { syncLib } from "./lib.ts";
import { answerFile, cardModules } from "./page.ts";

// The README's rules 9 to 15.

const ann = callers.agent("ann", "a");
const seed = { "canvases/a/canvas.pen": "{}", "shared/canvases/bo/b/canvas.pen": "{}", "shared/canvases/bo/b/cards/x/index.html": "<script type=module>export default () => 1</script>" };
const start = () => testServer({ features: [cards()], deck: seed });

test("rules 9 to 11: create, name, title, list, get, writer", async () => {
	const s = await start();
	const made = await s.value<{ path: string; title: string; by: string; named?: number; changed?: number }>("card.create", { title: "Sales rose 12% & held" }, ann);
	assert.deepEqual([made.path, made.title, made.by], ["canvases/a/cards/sales-rose-12-held/index.html", "Sales rose 12% & held", "ann"]);
	assert.ok(made.named && made.changed);
	const again = await s.value<{ path: string }>("card.create", { title: "Sales rose 12% & held" }, ann);
	assert.equal(again.path, "canvases/a/cards/sales-rose-12-held-2/index.html");
	const got = await s.value<{ path: string }>("card.get", { card: "canvases/a/cards/sales-rose-12-held" });
	assert.equal(got.path, made.path);
	const list = await s.value<{ path: string }[]>("card.list", {}, ann);
	assert.deepEqual(list.map((c) => c.path), [again.path, made.path, "shared/canvases/bo/b/cards/x/index.html"]);
	assert.equal((await s.call("card.create", { title: "x" }, callers.agent("nobody"))).ok, false);
	assert.equal((await s.call("card.get", { card: "docs/x.html" })).ok, false);
	await s.close();
});

test("rule 10: a claim makes the claimer the writer, until someone writes", async () => {
	const s = await start();
	const { path } = await s.value<{ path: string }>("card.create", { title: "T" }, ann);
	const [claimed] = await s.value<{ by: string }[]>("card.claim", { cards: path }, callers.agent("cy"));
	assert.equal(claimed!.by, "cy");
	assert.ok(s.heard.some((e) => e.name === "card.changed"));
	await s.value("file.write", { path, text: "<title>New</title>" }, ann);
	const now = await s.value<{ title: string; by: string }>("card.get", { card: path });
	assert.deepEqual([now.title, now.by], ["New", "ann"]);
	await s.close();
});

test("titles and folder names", () => {
	assert.equal(titleOf("canvases/a/cards/x/index.html", "<h1>A <b>bold</b> &amp; plain</h1>"), "A bold & plain");
	assert.equal(titleOf("canvases/a/cards/x/index.html", ""), "x");
	assert.equal(slug("Ünïcode café, then a very long title that keeps on going past forty"), "unicode-cafe-then-a-very-long-title-that");
	assert.equal(slug("!!!"), "card");
});

test("rule 12: the fixture deck's cards read as items and write back unchanged", () => {
	const pen = JSON.parse(readFileSync(new URL("../../tools/fixtures/deck/canvases/auth-refresh/canvas.pen", import.meta.url), "utf8")) as { children: Record<string, unknown>[] };
	assert.equal(pen.children.length, 5);
	for (const node of pen.children) {
		const item = cardKind.fromPen(node as never, { canvas: "auth-refresh" });
		assert.equal(item.type, "card");
		assert.match(String(item.card), /^canvases\/auth-refresh\/cards\/[^/]+\/index\.html$/);
		assert.deepEqual(cardKind.toPen(item, { canvas: "auth-refresh" }), node);
	}
	const plan = cardKind.fromPen(pen.children[0] as never, { canvas: "auth-refresh" });
	assert.deepEqual(plan.box, { x1: 0, y1: 0, x2: 1600, y2: 1000 });
	assert.deepEqual(cardKind.files!(plan), ["canvases/auth-refresh/cards/plan"]);
});

test("rule 14: a card's page, its modules, and a friend's card runs none", async () => {
	const html = "<title>T</title><div>hi</div><script type=module>export default (c) => c</script><script type=text/x-data>{}</script>";
	const deck = new MemoryDeck({ "canvases/a/cards/t/index.html": html, ...seed });
	const ctx = testContext({ deck });
	assert.equal(cardModules(html).length, 1);
	const page = await answerFile(ctx, "/files/canvases/a/cards/t/index.html", new URLSearchParams("pass=p1"));
	assert.equal(page.type, "text/html");
	assert.match(String(page.body), /index\.html\.m0\.js\?pass=p1/);
	assert.match(String(page.body), /text\/x-data/);
	assert.doesNotMatch(String(page.body), /export default \(c\)/);
	const module = await answerFile(ctx, "canvases/a/cards/t/index.html.m0.js", new URLSearchParams());
	assert.equal(module.body, "export default (c) => c");
	assert.equal((await answerFile(ctx, "canvases/a/cards/t/index.html.m1.js", new URLSearchParams())).status, 404);
	assert.equal((await answerFile(ctx, "shared/canvases/bo/b/cards/x/index.html.m0.js", new URLSearchParams())).status, 403);
	assert.equal((await answerFile(ctx, ".decks/server.json", new URLSearchParams())).status, 403);
	assert.equal((await answerFile(ctx, "canvases/a/cards/t/index.html", new URLSearchParams("raw"))).type, "text/html");
	await assert.doesNotReject(answerFile(ctx, "canvases/a/canvas.pen", new URLSearchParams()));
});

test("card.url carries a pass that calls as the card", async () => {
	const s = await start();
	const { path } = await s.value<{ path: string }>("card.create", { title: "T" }, ann);
	const url = await s.value<string>("card.url", { card: path });
	assert.match(url, /^\/files\/canvases\/a\/cards\/t\/index\.html\?pass=.+/);
	await s.close();
});

test("rule 15: lib/ follows the build, writing only what differs", async () => {
	const source = new MemoryDeck({ "card.css": "new", "fonts/a.woff2": "f" });
	const deck = new MemoryDeck({ "lib/card.css": "old", "lib/gone.js": "x", "lib/fonts/a.woff2": "f" });
	assert.deepEqual(await syncLib(source, deck), { written: ["lib/card.css"], removed: ["lib/gone.js"], same: 1 });
	assert.deepEqual(await syncLib(source, deck), { written: [], removed: [], same: 2 });
	assert.deepEqual(await syncLib(new MemoryDeck(), deck), { written: [], removed: [], same: 0 });
});

test("the real card runtime syncs into an empty deck", async () => {
	const root = new URL("../../canvas/cards/runtime/lib/", import.meta.url).pathname;
	const files: Record<string, Uint8Array> = {};
	const walk = (dir: string) => {
		for (const name of readdirSync(join(root, dir))) {
			const rel = dir ? `${dir}/${name}` : name;
			if (statSync(join(root, rel)).isDirectory()) walk(rel);
			else if (!name.startsWith(".")) files[rel] = readFileSync(join(root, rel));
		}
	};
	walk("");
	const deck = new MemoryDeck();
	const got = await syncLib(new MemoryDeck(files), deck);
	assert.equal(got.written.length, Object.keys(files).length);
	assert.ok(got.written.includes("lib/card.css"));
});

test("rules 18 and 19: a resize names its resizer the writer; a change after a read is news", async () => {
	const { features } = await import("../main.ts");
	const s = await testServer({ features: features(), deck: { "canvases/a/canvas.pen": '{"version":"2.14","children":[]}', "canvases/a/cards/n/index.html": "<title>N</title>\n<meta name=\"card\" content='{\"w\":400,\"h\":300}' />\n" } });
	const path = "canvases/a/cards/n/index.html";
	const placed = await s.value<{ id: string }>("item.insert", { item: { type: "card", card: path } }, ann);
	await s.value("item.update", { id: placed.id, size: { w: 424, h: 300 }, canvas: "a" }, "person");
	let got = await s.value<{ by?: string; named?: number; changed?: number; seen?: number }>("card.get", { card: path });
	for (let i = 0; i < 20 && got.by !== "person"; i++) {
		await new Promise((r) => setTimeout(r, 10));
		got = await s.value("card.get", { card: path });
	}
	assert.equal(got.by, "person");
	const read = await s.value<{ seen?: number; changed?: number }>("card.seen", { card: path }, "person");
	assert.ok((read.seen ?? 0) >= (read.changed ?? 0));
	assert.equal((await s.call("card.seen", { card: path }, ann)).ok, false);
	await new Promise((r) => setTimeout(r, 5));
	await s.value("file.write", { path: "canvases/a/cards/n/data.json", text: "{}" }, ann);
	const after = await s.value<{ seen?: number; changed?: number }>("card.get", { card: path });
	assert.ok((after.changed ?? 0) > (after.seen ?? 0), JSON.stringify(after));
	await s.close();
});

test("rule 14: a card's own :host rules apply to its element on its page", async () => {
	const { hostRules } = await import("./page.ts");
	assert.equal(hostRules("<style>:host { background: #000 } :host([data-theme=dark]) p { color: red }</style><p>x</p>"), "<style>#decks-card { background: #000 } #decks-card[data-theme=dark] p { color: red }</style><p>x</p>");
	assert.equal(hostRules("<p>:host stays in words</p>"), "<p>:host stays in words</p>");
});

test("rule 14: card.url's pass ends after an hour", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const s = await start();
	const { path } = await s.value<{ path: string }>("card.create", { title: "Short" }, ann);
	const url = await s.value<string>("card.url", { card: path });
	const pass = decodeURIComponent(url.split("pass=")[1]!);
	assert.equal(s.kernel.callers.resolve(pass)?.kind, "card");
	t.mock.timers.tick(PAGE_PASS_MS);
	assert.equal(s.kernel.callers.resolve(pass), undefined);
	await s.close();
});
