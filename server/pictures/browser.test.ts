import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FolderDeck } from "../kernel/index.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import { chromium } from "./browser.ts";
import { picturesFeature } from "./feature.ts";
import { nativeBinary } from "./native.ts";

// The real Chromium on the fixture deck, heavy: run with DECKS_HEAVY=1 under
// node tools/heavy.mjs --wait. Skipped otherwise.

const HEAVY = process.env.DECKS_HEAVY === "1";
const ROOT = new URL("../../tools/fixtures/deck/", import.meta.url).pathname;
/** The card runtime a real server copies into a deck's lib/: card.css, its theme.css, the fonts. */
const LIB = new FolderDeck(new URL("../../canvas/cards/runtime/lib", import.meta.url).pathname);
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
	const s = await testServer({ features: [...features({ lib: LIB }).filter((one) => one.name !== "pictures"), picturesFeature({ browser })], deck: fixture() as never });
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
		assert.match(fitted.notes.join(" "), /^To fix: .*smallest text is \d+px/);
		const shot = await s.value<{ file: string; size: { w: number; h: number }; how?: string }>("canvas.screenshot", {}, ann);
		if (nativeBinary()) assert.equal(shot.how, "native", "with the engine's tool built, the canvas is drawn natively");
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

const STYLED = `<title>Styled</title>
<meta name="card" content='{"w":480}' />
<div class="doc"><h1>Tokens, a table and code</h1>
<div style="height:120px;background:var(--b-accent);border-radius:var(--b-radius)"></div>
<table><tr><th>Rung</th><th>Width</th></tr><tr><td>top</td><td>800</td></tr></table>
<pre><code class="language-js">const rung = 800;</code></pre></div>
`;

test("a card's picture has its card.css, theme tokens and fonts, which its page imports from the server", { skip: HEAVY ? false : "heavy: set DECKS_HEAVY=1 and run under tools/heavy.mjs" }, async () => {
	const browser = chromium();
	const s = await testServer({ features: [...features({ lib: LIB }).filter((one) => one.name !== "pictures"), picturesFeature({ browser, native: false })], deck: fixture() as never });
	const served = await s.listen();
	s.setUrl(served.url);
	try {
		const card = "canvases/auth-refresh/cards/styled/index.html";
		await s.value("file.write", { path: card, text: STYLED }, callers.agent("ann", "auth-refresh"));
		const got = await fetch(`${served.url}/pictures/${card}?w=480&pass=${served.token}`);
		assert.equal(got.headers.get("content-type"), "image/jpeg");
		const accent = await accentPixels(Buffer.from(await got.arrayBuffer()));
		assert.ok(accent > 2000, `the block drawn in the theme's accent (#3b5cf6), not unstyled or black: ${accent} pixels`);
	} finally {
		await served.close();
		await s.close();
		await browser.close();
	}
});

/** How many pixels of a JPEG are the light theme's accent, #3b5cf6, give or take JPEG's noise. */
async function accentPixels(jpeg: Buffer): Promise<number> {
	const { chromium: pw } = await import("playwright");
	const b = await pw.launch({ headless: true });
	try {
		const page = await b.newPage();
		return await page.evaluate(`(async () => { const i = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${jpeg.toString("base64")}")).blob()); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - 59) < 16 && Math.abs(d[k + 1] - 92) < 16 && Math.abs(d[k + 2] - 246) < 16) n++; return n; })()`);
	} finally {
		await b.close();
	}
}
