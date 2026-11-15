/**
 * The pill's ⋯ Export, for a card, a drawing, and a group of both, as PNG and as PDF.
 *
 * Each is pressed as a person presses it (select, ⋯, Export as …) and the file the browser saves is
 * read: a PNG of the size asked, with the card's words and the drawing's colour where they should be;
 * a PDF whose page carries the card's words and the drawing. The page fetches `/stage-shot`, which runs
 * `canvas.screenshot`, the call `decks canvas screenshot` makes, so a download is drawn as an agent's
 * screenshot is. `DECKS_E2E_SHOTS=<dir>` keeps the files to look at.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { canvasFrame, card, open, say, selectCard, settle, socket, rest } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const keep = process.env.DECKS_E2E_SHOTS;
const { browser, page, errors } = await open({ width: 1500, height: 950, scheme: "light", panelTab: "canvas" });
const canvas = await canvasFrame(page);
const NOTES = card("notes");
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);

// The card on screen, then a blue square and a word just right of it.
await page.locator('.panel-shell [title^="What the survey round found"]').first().click();
await settle(page, 900);
await selectCard(page, NOTES);
const cardRect = await canvas.evaluate((path) => window.__decksProbes?.cards?.().find((one) => one.path === path)?.rect, NOTES);
const world = await canvas.evaluate(() => {
	const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(globalThis.__decksProbes?.cameraTransform?.() ?? "");
	const r = document.querySelector(".stage").getBoundingClientRect();
	return m ? { left: r.left + Number(m[1]), top: r.top + Number(m[2]), zoom: Number(m[3]), cx: Number(m[4]), cy: Number(m[5]) } : null;
});
const toWorld = (x, y) => ({ x: (x - world.left) / world.zoom - world.cx, y: (y - world.top) / world.zoom - world.cy });
const right = toWorld(cardRect.x + cardRect.width, cardRect.y);
const X = Math.round(right.x + 60);
const Y = Math.round(right.y);
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{ op: "insert", node: { type: "rectangle", id: "ex-square", width: 160, height: 160, fill: "#2563eb", stroke: "#1f2328", strokeWidth: 2 }, box: { x1: X, y1: Y, x2: X + 160, y2: Y + 160 } },
		{ op: "insert", node: { type: "text", id: "ex-word", content: "Exported", fontSize: 28, fill: "#1f2328" }, box: { x1: X, y1: Y + 180 } },
	],
});
await until(() => link.received.some((m) => m.type === "stage.pen" && m.doc?.children?.some((n) => n.id === "ex-square")));
await page.keyboard.press("Escape");
await canvas.locator("[aria-label='Fit everything on the canvas']").first().click();
await rest(page);
await settle(page, 600);

/** Press ⋯ on the pill showing now, then the export, and read what the browser saves. */
const exported = async (format) => {
	// Once the camera rests: a moving camera hides the pill and shuts its menu.
	await settle(page, 700);
	const pill = canvas.locator(".stage-fixed > .card-callout:not([data-hidden])").first();
	await pill.locator('[aria-label="More"]').click({ timeout: 4000 });
	await settle(page, 150);
	const download = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
	await pill.locator(`[aria-label="Export as ${format.toUpperCase()}"]`).click({ timeout: 4000 });
	const saved = await download;
	const file = saved ? await saved.path().catch(() => null) : null;
	return file ? { name: saved.suggestedFilename(), bytes: readFileSync(file) } : null;
};

/** A PNG's size, and how much of it is blue, ink (dark) and anything but the background. */
const readPng = (bytes) =>
	page.evaluate(async (b64) => {
		const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
		const c = new OffscreenCanvas(image.width, image.height);
		const g = c.getContext("2d");
		g.drawImage(image, 0, 0);
		const { data } = g.getImageData(0, 0, image.width, image.height);
		const [br, bg, bb] = [data[0], data[1], data[2]];
		let blue = 0, dark = 0, other = 0;
		for (let i = 0; i < data.length; i += 4) {
			const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
			if (b > 180 && r < 80 && gg > 70 && gg < 130) blue += 1;
			if (r + gg + b < 200) dark += 1;
			if (Math.abs(r - br) + Math.abs(gg - bg) + Math.abs(b - bb) > 40) other += 1;
		}
		const n = data.length / 4;
		return { w: image.width, h: image.height, blue: blue / n, dark: dark / n, other: other / n };
	}, bytes.toString("base64"));

/** A PDF's first page: its words and how much it draws, read by pdf.js. */
const readPdf = async (bytes) => {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
	const first = await doc.getPage(1);
	const text = (await first.getTextContent()).items.map((one) => one.str).join(" ");
	const ops = (await first.getOperatorList()).fnArray.length;
	const [, , w, h] = first.view;
	const pages = doc.numPages;
	await doc.destroy();
	return { pages, text, ops, w: Math.round(w), h: Math.round(h) };
};

const cases = [
	// aspect: the box's width over its height, 24 units of margin round what is picked.
	{ name: "card", select: async () => selectCard(page, NOTES), words: "survey", blue: false, aspect: (760 + 48) / (240 + 48) },
	{
		name: "drawing",
		select: async () => {
			const r = await canvas.evaluate(() => window.__decksProbes?.penBox?.("ex-square"));
			await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
		},
		blue: true,
		aspect: 1,
	},
	{
		name: "group",
		select: async () => {
			const r = await canvas.evaluate(() => window.__decksProbes?.penBox?.("ex-square"));
			await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
			const c = await canvas.evaluate((path) => window.__decksProbes?.cards?.().find((one) => one.path === path)?.rect, NOTES);
			await page.keyboard.down("Shift");
			await page.mouse.click(c.x + c.width / 2, c.y + c.height * 0.6);
			await page.keyboard.up("Shift");
		},
		words: "survey",
		blue: true,
		aspect: (760 + 60 + 160 + 48) / (240 + 48),
	},
];

for (const one of cases) {
	await page.keyboard.press("Escape");
	await settle(page, 200);
	await one.select();
	await settle(page, 500);
	const label = await canvas.evaluate(() => document.querySelector(".stage-fixed > .card-callout:not([data-hidden])")?.getAttribute("aria-label") ?? "");
	if (one.name === "group") say("the square and the card are picked together", /1 card, 1 item/.test(label), label);

	const png = await exported("png");
	if (keep && png) writeFileSync(`${keep}/export-${one.name}.png`, png.bytes);
	const p = png && png.bytes.subarray(1, 4).toString() === "PNG" ? await readPng(png.bytes) : null;
	say(
		`${one.name}: Export as PNG saves a picture of it`,
		!!p && p.w >= 300 && p.h >= 150 && p.other > 0.03 && (one.blue ? p.blue > 0.03 : p.blue < 0.01) && p.dark > 0.002,
		png ? `${png.name} ${JSON.stringify(p)}` : "no download",
	);

	await settle(page, 300);
	const pdf = await exported("pdf");
	if (keep && pdf) writeFileSync(`${keep}/export-${one.name}.pdf`, pdf.bytes);
	const d = pdf && pdf.bytes.subarray(0, 4).toString() === "%PDF" ? await readPdf(pdf.bytes) : null;
	// The page is the shot's box (a card alone: the card's), and the card's words are text in it.
	say(
		`${one.name}: Export as PDF saves one page of it`,
		!!d && d.pages === 1 && d.ops > 10 && (!one.words || d.text.toLowerCase().includes(one.words)) && Math.abs(d.w / d.h - one.aspect) < 0.03,
		pdf ? `${pdf.name} ${JSON.stringify({ ...d, text: d?.text.slice(0, 80) })}` : "no download",
	);
}

link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
