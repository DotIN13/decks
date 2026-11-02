#!/usr/bin/env node
/**
 * How long a canvas switch takes, as a person sees it: opens the app, switches canvas from the top
 * bar's canvas menu, films the window (CDP screencast) and finds when the picture first changes and
 * when it stops changing (each frame against the last one, as a share of pixels that differ).
 *
 *   node scripts/switch-timing.mjs <url> "<from title>" "<to title>" [latency ms] [runs]
 *
 * Latency is added to every request, the canvas frame's and its workers' too (a route that holds each
 * request that long: Chrome's network emulation does not reach the sandboxed frame, which runs in a
 * process of its own), about what a laptop on a tailnet sees at 40. Each run switches from → to, then back, and times the second switch to `to` as well,
 * so a canvas seen before (warm caches, a kept frame) is timed beside one seen for the first time.
 */
import { chromium } from "playwright";
const [url, from, to, latency = "0", runs = "1"] = process.argv.slice(2);
if (!url || !from || !to) throw new Error("usage: switch-timing.mjs <url> <from> <to> [latency] [runs]");
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6000);

const pick = async (title) => {
	await page.locator('[data-tip="Canvases"]:visible').first().click();
	await page.waitForTimeout(300);
	const row = page.locator(".switcher-canvas", { hasText: title }).first();
	if (!(await row.count())) {
		await page.locator(".menu-find input").first().fill(title);
		await page.waitForTimeout(300);
	}
	return row;
};
const here = async () => (await page.locator('[data-tip="Canvases"]:visible').first().innerText()).trim();

/** Diffs of each screencast frame against the one before, worked out in the browser. */
const diffs = async (frames) =>
	page.evaluate(async (list) => {
		const decode = async (b64) => createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
		const canvas = new OffscreenCanvas(320, 200);
		const g = canvas.getContext("2d", { willReadFrequently: true });
		const pixels = async (b64) => {
			g.drawImage(await decode(b64), 0, 0, 320, 200);
			return g.getImageData(0, 0, 320, 200).data;
		};
		const differ = (a, b) => {
			let changed = 0;
			for (let p = 0; p < a.length; p += 4) if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 48) changed++;
			return changed / (320 * 200);
		};
		const all = [];
		for (const one of list) all.push({ t: one.t, px: await pixels(one.data) });
		const last = all.at(-1).px;
		// Against the frame before (when it starts to change) and against the last frame (when it is as it ends).
		return all.slice(1).map((one, i) => ({ t: one.t, share: differ(one.px, all[i].px), fromEnd: differ(one.px, last) }));
	}, frames);

async function timeSwitch(title) {
	const row = await pick(title);
	const frames = [];
	const onFrame = async (f) => {
		frames.push({ t: Date.now(), data: f.data });
		await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
	};
	cdp.on("Page.screencastFrame", onFrame);
	await cdp.send("Page.startScreencast", { format: "jpeg", quality: 50, maxWidth: 640, maxHeight: 400 });
	await page.waitForTimeout(400);
	const t0 = Date.now();
	frames.push({ t: t0, data: frames.at(-1)?.data });
	await row.click();
	await page.waitForTimeout(Number(latency) ? 10000 : 6000);
	await cdp.send("Page.stopScreencast");
	cdp.off("Page.screencastFrame", onFrame);
	const usable = frames.filter((f) => f.data && f.t >= t0 - 1);
	const d = await diffs(usable);
	const moving = d.filter((x) => x.share > 0.004);
	const notYet = d.filter((x) => x.fromEnd > 0.01);
	return { first: moving.length ? moving[0].t - t0 : null, settled: notYet.length ? notYet.at(-1).t - t0 : 0 };
}

let delay = 0;
await ctx.route("**/*", (route) => (delay ? setTimeout(() => route.continue().catch(() => {}), delay) : route.continue().catch(() => {})));
const results = [];
for (let r = 0; r < Number(runs); r++) {
	if ((await here()) !== from) await (await pick(from)).click(), await page.waitForTimeout(5000);
	delay = Number(latency);
	const cold = await timeSwitch(to);
	await page.waitForTimeout(1000);
	await (await pick(from)).click();
	await page.waitForTimeout(Number(latency) ? 6000 : 4000);
	const warm = await timeSwitch(to);
	delay = 0;
	results.push({ cold, warm });
	console.error(`run ${r + 1}: first visit ${cold.first}–${cold.settled} ms, again ${warm.first}–${warm.settled} ms`);
}
console.log(JSON.stringify({ url, from, to, latency: Number(latency), results }));
await browser.close();
