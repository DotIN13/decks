/**
 * A frame exported as a web page (`decks.canvas.export`, `@decks/pen`'s `html.ts`) looks like the
 * frame on the canvas.
 *
 * A fixture card is drawn on the stage: a column with padding, a gap, a white fill, rounded corners,
 * an inner stroke and a shadow, holding a row with an icon and a bold title, a paragraph that wraps
 * at its width, a vertical gradient, and a button that fills the card's width with its words in the
 * middle. It is exported twice, as plain HTML and as Tailwind classes; each page is opened in
 * Chromium at one pixel a stage unit and the card's element is pictured, and the server's own
 * picture of the card (`canvas.screenshot`, the stage engine's painter) is taken at the same scale.
 * The two are compared pixel by pixel: the share of pixels off by more than `FAR` in any channel, and
 * the mean difference, must stay under `MOST_FAR` and `MOST_MEAN`.
 *
 * The paragraph and the button's words are 14 px, with the paragraph's lines 1.45 of that apart
 * (20.3 px), as pen and the browser space them: the stage engine spaces each line by the text's own
 * size, so the card on the canvas is the page's height to within a pixel.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps the pictures and a picture of where they differ.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { API, asPerson, deckState, open, say, socket } from "../harness.mjs";

const keep = process.env.DECKS_E2E_SHOTS;
/** A channel this far apart (of 255) counts the pixel as different. */
const FAR = 40;
/** At most this share of the card's pixels may differ, and on average by this much. */
const MOST_FAR = 0.06;
const MOST_MEAN = 8;
const ID = "export-card";

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const { browser, page, errors } = await open({ width: 1200, height: 800, scheme: "light", boards: true });
const deck = await deckState();
const placed = deck.boards.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
const X = Math.round(Math.max(0, ...placed.map((b) => b.x + (b.w ?? 0))) + 400);
const Y = Math.round((placed.length ? Math.min(...placed.map((b) => b.y)) : 0) + 120);

const card = {
	type: "frame", id: ID, x: X, y: Y, width: 320, layout: "vertical", gap: 16, padding: 24, fill: "#ffffff", cornerRadius: 16,
	stroke: "#d9d9e3", strokeWidth: 1, strokeAlignment: "inner",
	effect: { type: "shadow", offset: { x: 0, y: 6 }, blur: 18, spread: 0, color: "#00000026" },
	children: [
		{ type: "frame", id: "export-head", width: "fill_container", layout: "horizontal", gap: 10, alignItems: "center", children: [
			{ type: "ellipse", id: "export-dot", width: 28, height: 28, fill: "#ffe8a3" },
			{ type: "icon", id: "export-zap", library: "lucide", icon: "zap", width: 20, height: 20, fill: "#b45309" },
			{ type: "text", id: "export-title", content: "Pro plan", fontSize: 22, fontWeight: 700, fill: "#14141a" },
		] },
		{ type: "text", id: "export-body", content: "Everything in Starter, with unlimited canvases and the agents that work on them.", textGrowth: "fixed-width", width: 272, fontSize: 14, lineHeight: 1.45, fill: "#55555f" },
		{ type: "rectangle", id: "export-band", width: "fill_container", height: 48, cornerRadius: 10, fill: { type: "gradient", gradientType: "linear", rotation: 0, colors: [{ color: "#c7d2fe", position: 0 }, { color: "#3b5cf6", position: 1 }] } },
		{ type: "frame", id: "export-button", width: "fill_container", layout: "horizontal", padding: [12, 16], justifyContent: "center", fill: "#3b5cf6", cornerRadius: 10, children: [
			{ type: "text", id: "export-cta", content: "Start free trial", fontSize: 14, fontWeight: 600, fill: "#ffffff" },
		] },
	],
};

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: card, box: { x1: X, y1: Y } }] });
const landed = await until(() => link.received.find((m) => m.type === "stage.pen" && m.doc?.children?.some((n) => n.id === ID)) ?? (link.received.some((m) => m.type === "stage.pen.delta") ? link.received.find((m) => m.type === "stage.pen") : undefined));
const stage = landed?.stage;
say("the fixture card is on the stage", !!stage);

const person = await asPerson();
const call = async (verb, args) => {
	const response = await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) });
	return response.json();
};

// The card's box as the canvas lays it out.
const read = await call("canvas.read", [{ canvas: stage, of: ID, depth: 0 }]);
const box = read.value?.items?.[0]?.box;
say("the canvas has a box for the card", !!box, JSON.stringify(read.error ?? box));

// The server's picture of the card, at one pixel a stage unit.
const params = new URLSearchParams({ agent: agentId, scale: "1", scheme: "light", of: ID });
const shotResponse = await fetch(`${API}/api/stage-shot?${params}`, { headers: person });
const shotBox = JSON.parse(shotResponse.headers.get("x-shot-box") ?? "null");
const shotHow = decodeURIComponent(shotResponse.headers.get("x-shot-how") ?? "");
const shot = Buffer.from(await shotResponse.arrayBuffer());
say("the server pictures the card", shotResponse.ok && !!shotBox, `${shotResponse.status} ${shotHow}`);
if (keep) writeFileSync(`${keep}/export-screenshot.png`, shot);

/** In a page: two PNGs compared over the same rectangle of each, and a picture of where they differ. */
async function compare([a, ax, ay, b, bx, by, w, h, far]) {
	const load = async (png) => {
		const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext("2d", { willReadFrequently: true });
		context.drawImage(bitmap, 0, 0);
		return context;
	};
	const one = (await load(a)).getImageData(ax, ay, w, h).data;
	const two = (await load(b)).getImageData(bx, by, w, h).data;
	const diff = new OffscreenCanvas(w, h);
	const out = diff.getContext("2d").createImageData(w, h);
	let off = 0;
	let sum = 0;
	for (let i = 0; i < one.length; i += 4) {
		const d = Math.max(Math.abs(one[i] - two[i]), Math.abs(one[i + 1] - two[i + 1]), Math.abs(one[i + 2] - two[i + 2]));
		sum += (Math.abs(one[i] - two[i]) + Math.abs(one[i + 1] - two[i + 1]) + Math.abs(one[i + 2] - two[i + 2])) / 3;
		if (d > far) off++;
		const grey = (one[i] + one[i + 1] + one[i + 2]) / 3;
		out.data.set(d > far ? [255, 0, 0, 255] : [grey, grey, grey, 255], i);
	}
	diff.getContext("2d").putImageData(out, 0, 0);
	const blob = await diff.convertToBlob({ type: "image/png" });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return { far: off / (w * h), mean: sum / (w * h), diff: btoa(text) };
}

const viewer = await chromium.launch();
for (const format of ["html", "tailwind"]) {
	const exported = await call("canvas.export", [ID, { canvas: stage, format, to: `exports/${ID}-${format}.html` }]);
	say(`canvas.export writes the ${format} page`, exported.ok && exported.value?.file === `exports/${ID}-${format}.html`, JSON.stringify(exported.error ?? exported.value));
	if (!exported.ok || !box || !shotBox) continue;
	// The page as the deck serves it, read with the person's token.
	const address = await call("file.url", [exported.value.file]);
	const url = new URL(address.value, API);
	const html = await (await fetch(url, { headers: person })).text();
	say(`the ${format} page is served from the deck`, html.startsWith("<!doctype html>"), html.slice(0, 120));
	const context = await viewer.newContext({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
	const tab = await context.newPage();
	await tab.setContent(html, { waitUntil: "networkidle" });
	await tab.evaluate(() => document.fonts.ready);
	await tab.waitForTimeout(300);
	const rect = await tab.evaluate((id) => {
		const r = document.querySelector(`[data-pen-id="${id}"]`).getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	}, ID);
	const want = { w: box.x2 - box.x1, h: box.y2 - box.y1 };
	say(`the ${format} page's card is the canvas's size`, Math.abs(rect.w - want.w) <= 1 && Math.abs(rect.h - want.h) <= 1, `page ${rect.w}×${rect.h}, canvas ${want.w}×${want.h}`);
	// The card and its shadow's reach round it, from both pictures.
	const M = 12;
	const pagePng = await tab.screenshot({ type: "png", clip: { x: Math.round(rect.x) - M, y: Math.round(rect.y) - M, width: Math.round(want.w) + 2 * M, height: Math.round(want.h) + 2 * M } });
	if (keep) writeFileSync(`${keep}/export-${format}.png`, pagePng);
	const w = Math.round(want.w) + 2 * M;
	const h = Math.round(want.h) + 2 * M;
	const found = await page.evaluate(compare, [shot.toString("base64"), Math.round(box.x1 - shotBox.x1) - M, Math.round(box.y1 - shotBox.y1) - M, pagePng.toString("base64"), 0, 0, w, h, FAR]);
	if (keep) writeFileSync(`${keep}/export-${format}-diff.png`, Buffer.from(found.diff, "base64"));
	const said = `${(found.far * 100).toFixed(2)}% of ${w}×${h} pixels differ by more than ${FAR}/255, mean difference ${found.mean.toFixed(2)}/255 (screenshot ${shotHow})`;
	console.log(`export ${format}: ${said}`);
	say(`the ${format} page looks like the canvas's picture of the card: ${said}`, found.far <= MOST_FAR && found.mean <= MOST_MEAN);
	await context.close();
}
await viewer.close();

say("no page errors", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
