import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import { chromium } from "./browser.ts";
import { picturesFeature } from "./feature.ts";

// The real Chromium on the fixture deck, heavy: run with DECKS_HEAVY=1 under
// node tools/heavy.mjs --wait. Skipped otherwise.

const HEAVY = process.env.DECKS_HEAVY === "1";
const ROOT = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;
const CARD = "canvases/auth-refresh/cards/risks/index.html";
const PNG = [137, 80, 78, 71];

function fixture(dir = ""): Record<string, Uint8Array> {
	const out: Record<string, Uint8Array> = {};
	for (const name of readdirSync(join(ROOT, dir))) {
		const rel = dir ? `${dir}/${name}` : name;
		if (statSync(join(ROOT, rel)).isDirectory()) Object.assign(out, fixture(rel));
		else out[rel] = readFileSync(join(ROOT, rel));
	}
	return out;
}

test("card.fit and canvas.screenshot in a real browser, on the fixture deck", { skip: HEAVY ? false : "heavy: set DECKS_HEAVY=1 and run under tools/heavy.mjs" }, async () => {
	const browser = chromium();
	const s = await testServer({ features: [...features().filter((one) => one.name !== "pictures"), picturesFeature({ browser })], deck: fixture() as never });
	const served = await s.listen();
	s.setUrl(served.url);
	const ann = callers.agent("ann", "auth-refresh");
	try {
		await s.value("item.update", { id: "risks", size: { h: 2000 } }, ann);
		const fitted = await s.call("card.fit", { card: CARD }, ann);
		assert.ok(fitted.ok, JSON.stringify(fitted));
		const box = (fitted.value as { box: { y1: number; y2: number } }).box;
		const h = box.y2 - box.y1;
		assert.ok(h > 300 && h < 1500, `the content's height, not the 2000 set before: ${h}`);
		assert.match(fitted.notes.join(" "), /This card is \d+ words.*smallest text is \d+px/);
		const shot = await s.value<{ file: string; size: { w: number; h: number } }>("canvas.screenshot", {}, ann);
		const bytes = await s.deck.read(shot.file as never);
		assert.deepEqual([...bytes.slice(0, 4)], PNG);
		assert.ok(Math.max(shot.size.w, shot.size.h) <= 1600);
		const card = await s.value<{ file: string }>("canvas.screenshot", { of: CARD, format: "jpeg", to: "exports/risks.jpg" }, ann);
		assert.deepEqual([...(await s.deck.read(card.file as never)).slice(0, 2)], [0xff, 0xd8]);
		await s.value("file.write", { path: "shared/canvases/ada/old-notes/pages/notes.html", text: "<title>Notes</title><h1>An old page</h1>" }, ann);
		for (const path of [CARD, "shared/canvases/ada/old-notes/pages/notes.html"]) {
			const t0 = Date.now();
			const first = await fetch(`${served.url}/pictures/${path}?w=480&v=0&pass=${served.token}`);
			assert.equal(first.headers.get("content-type"), "image/jpeg", path);
			assert.ok((await first.arrayBuffer()).byteLength > 1000, `${path} is a real picture`);
			const again = Date.now();
			await (await fetch(`${served.url}/pictures/${path}?w=480&v=0&pass=${served.token}`)).arrayBuffer();
			assert.ok(Date.now() - again < 300, `the second from the store, under 300 ms (first took ${again - t0} ms)`);
		}
		const folder = CARD.replace(/index\.html$/, "");
		await s.value("file.write", { path: `${folder}snap.css`, text: "body { background: rgb(255, 0, 0); margin: 0 }" }, ann);
		const snap = await fetch(`${served.url}/pictures/snapshot?path=${CARD}&w=200&h=100&pass=${served.token}`, { method: "POST", body: '<html><head><link rel="stylesheet" href="snap.css"></head><body></body></html>' });
		assert.equal(snap.headers.get("content-type"), "image/png", await snap.clone().text());
		const red = await redPixel(Buffer.from(await snap.arrayBuffer()));
		assert.ok(red, "the card's own stylesheet loaded, by its relative address");
	} finally {
		await served.close();
		await s.close();
		await browser.close();
	}
});

/** Whether the PNG's middle pixel is red, read in a page of its own. */
async function redPixel(png: Buffer): Promise<boolean> {
	const { chromium: pw } = await import("playwright");
	const b = await pw.launch({ headless: true });
	try {
		const page = await b.newPage();
		const data = png.toString("base64");
		return await page.evaluate(`(async () => { const i = await createImageBitmap(await (await fetch("data:image/png;base64,${data}")).blob()); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); const p = x.getImageData(i.width >> 1, i.height >> 1, 1, 1).data; return p[0] > 200 && p[1] < 60 && p[2] < 60; })()`);
	} finally {
		await b.close();
	}
}
