import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import type { Browser, Page, PageOptions } from "./browser.ts";
import { picturesFeature } from "./feature.ts";
import type { Reading, Views } from "./reading.ts";

// The calls against a fake browser that answers what a page would read.

const CARD = "canvases/work/cards/sales/index.html";
const pen = (children: unknown[]) => JSON.stringify({ version: "2.14", children });
const cardNode = { type: "browser", id: "sales", name: "Sales", url: "cards/sales/index.html", width: 800, height: 900, x: 100, y: 50, metadata: { type: "decks.card", path: "cards/sales/index.html" } };
const note = { type: "note", id: "n1", content: "Look here", x: 1100, y: 50, width: 200, height: 100 };
const DECK = {
	"canvases/work/canvas.pen": pen([cardNode, note]),
	[CARD]: "<title>Sales rose</title><meta name=\"card\" content='{\"w\":800}' /><div class=\"doc\"><h1>Sales rose</h1></div>",
};

type Seen = { options: PageOptions; urls: string[]; html: string[]; shots: number };

function fakeBrowser(reading: Reading, views: Views = { controls: 0, opening: reading.h, views: [] }, errors: string[] = []) {
	const seen: Seen[] = [];
	const browser: Browser = {
		async page(options) {
			const one: Seen = { options, urls: [], html: [], shots: 0 };
			seen.push(one);
			const page: Page = {
				errors,
				goto: async (url) => void one.urls.push(url),
				show: async (html) => void one.html.push(html),
				evaluate: async <T>(script: string) => (script.includes("controls") ? views : script.startsWith("(() =>") ? reading : undefined) as T,
				screenshot: async () => (one.shots++, new Uint8Array([137, 80, 78, 71])),
				pdf: async () => new TextEncoder().encode("%PDF"),
				close: async () => {},
			};
			return page;
		},
		close: async () => {},
	};
	return { browser, seen };
}

const start = (browser: Browser, origin: string | null = "http://127.0.0.1:4664") => testServer({ features: [...features(), picturesFeature({ browser, origin: () => origin ?? undefined })], deck: DECK });
const ann = callers.agent("ann", "work");

test("rule 4: fit measures at the card's width there, writes its height, and says one screen", async () => {
	const fake = fakeBrowser({ h: 420, words: 40, minFont: 17 });
	const s = await start(fake.browser);
	const answer = await s.call("card.fit", { card: "canvases/work/cards/sales" }, ann);
	assert.ok(answer.ok);
	assert.deepEqual((answer.value as { box: unknown }).box, { x1: 100, y1: 50, x2: 900, y2: 470 });
	assert.equal(fake.seen[0]!.options.width, 800);
	assert.match(fake.seen[0]!.urls[0]!, /^http:\/\/127\.0\.0\.1:4664\/files\/canvases\/work\/cards\/sales\/index\.html\?pass=dk_/);
	assert.match(answer.notes.join(" "), /One screen: 420 px tall, 40 words, smallest text 17px/);
	const items = await s.value<{ id: string; box: { y2: number } }[]>("item.list", { canvas: "work" });
	assert.equal(items.find((i) => i.id === "sales")!.box.y2, 470);
	await s.close();
});

test("rules 5 and 6: what is over a limit is advice, with the view a control opens", async () => {
	const views = { controls: 2, opening: 700, views: [{ label: "Method", h: 980, overflowX: 0 }] };
	const fake = fakeBrowser({ h: 700, words: 300, minFont: 12, cut: 1 }, views, ["boom"]);
	const s = await start(fake.browser);
	const answer = await s.call("card.fit", { card: CARD, margin: 10 }, ann);
	const said = answer.notes.join(" ");
	for (const part of [/710 px tall, more than one screen/, /300 words/, /12px/, /1 box cut off/, /pressing "Method" it is 980 px tall/, /throws: boom/]) assert.match(said, part);
	await s.close();
});

test("rule 4: a card not on the canvas is refused with the call that places it", async () => {
	const s = await start(fakeBrowser({ h: 1, words: 1 }).browser);
	await s.value("file.write", { path: "canvases/work/cards/other/index.html", text: "<p>x</p>" }, ann);
	const answer = await s.call("card.fit", { card: "canvases/work/cards/other/index.html" }, ann);
	assert.ok(!answer.ok);
	assert.deepEqual([answer.error.code, answer.error.hint], ["invalid", "item.insert"]);
	await s.close();
});

test("rule 2: with no address known, the browser calls are unavailable", async () => {
	const s = await start(fakeBrowser({ h: 1, words: 1 }).browser, null);
	const answer = await s.call("card.fit", { card: CARD }, ann);
	assert.ok(!answer.ok);
	assert.equal(answer.error.code, "unavailable");
	await s.close();
});

test("rules 7 and 9: the whole canvas, composed with each card's page, kept in exports/", async () => {
	const fake = fakeBrowser({ h: 1, words: 1 });
	const s = await start(fake.browser);
	const shot = await s.value<{ file: string; size: { w: number; h: number }; box: unknown; how: string }>("canvas.screenshot", {}, ann);
	assert.match(shot.file, /^exports\/screenshots\/work-.*\.png$/);
	assert.deepEqual(shot.box, { x1: 100, y1: 50, x2: 1300, y2: 950 });
	assert.deepEqual(shot.size, { w: 1200, h: 900 });
	assert.match(fake.seen[0]!.html[0]!, /<iframe[^>]+src="http:\/\/127\.0\.0\.1:4664\/files\/canvases\/work\/cards\/sales\/index\.html\?pass=/);
	assert.match(fake.seen[0]!.html[0]!, /Look here/);
	assert.ok((await s.deck.read(shot.file as never)).length > 0);
	await s.close();
});

test("rule 7: the long side is 1,600 px at most, and scale multiplies it", async () => {
	const s = await start(fakeBrowser({ h: 1, words: 1 }).browser);
	const big = await s.value<{ size: { w: number } }>("canvas.screenshot", { of: { x1: 0, y1: 0, x2: 4000, y2: 1000 }, to: "exports/big.jpg", format: "jpeg" }, ann);
	assert.equal(big.size.w, 1600);
	const twice = await s.value<{ size: { w: number } }>("canvas.screenshot", { of: "n1", scale: 2 }, ann);
	assert.equal(twice.size.w, 400);
	await s.close();
});

test("rule 8: a card's path is its own page; an unknown id is not_found", async () => {
	const fake = fakeBrowser({ h: 1, words: 1 });
	const s = await start(fake.browser);
	const one = await s.call("canvas.screenshot", { of: CARD, to: "exports/card.png" }, ann);
	assert.ok(one.ok);
	assert.equal((one.value as { how: string }).how, "chromium: the card's page");
	assert.match(fake.seen[0]!.urls[0]!, /\/files\/canvases\/work\/cards\/sales\/index\.html\?pass=/);
	const none = await s.call("canvas.screenshot", { of: "nope" }, ann);
	assert.ok(!none.ok);
	assert.equal(none.error.code, "not_found");
	await s.close();
});

test("rule 10: export writes pen's page, a card as an iframe from where the page is", async () => {
	const s = await start(fakeBrowser({ h: 1, words: 1 }).browser);
	const file = await s.value<{ path: string; by: string }>("canvas.export", { of: ["sales", "n1"] }, ann);
	assert.deepEqual([file.path, file.by], ["exports/sales.html", "ann"]);
	const page = await s.value<{ text: string }>("file.read", { path: file.path });
	assert.match(page.text, /<iframe[^>]+src="\.\.\/canvases\/work\/cards\/sales\/index\.html"/);
	assert.match(page.text, /Look here/);
	const tw = await s.value<{ text: string }>("file.read", { path: (await s.value<{ path: string }>("canvas.export", { of: "n1", format: "tailwind", to: "exports/n.html" }, ann)).path });
	assert.match(tw.text, /tailwindcss/);
	await s.close();
});

test("rule 11: a card's picture is taken once per version and rung", async () => {
	const fake = fakeBrowser({ h: 1, words: 1 });
	const s = await start(fake.browser);
	const served = await s.listen();
	const get = () => fetch(`${served.url}/pictures/${CARD}?w=300&pass=${served.token}`);
	const first = await get();
	assert.equal(first.headers.get("content-type"), "image/png");
	await get();
	assert.equal(fake.seen.length, 1, "the second is from the store");
	assert.equal(fake.seen[0]!.options.scale, 480 / 800);
	await served.close();
	await s.close();
});
