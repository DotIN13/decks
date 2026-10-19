/**
 * What the backend checks share (`checks/backends.mjs`, `checks/context-loss.mjs`,
 * `checks/sharper-pictures.mjs`): the two browsers they run in, the APIs they take away, and how
 * they tell the stage's canvas drew something.
 */
import { join } from "node:path";
import { settle } from "./harness.mjs";

/** Chromium on a desktop, and WebKit as an iPhone: Safari's engine, a touch screen, a 3× screen. */
export const TARGETS = [
	{ label: "Chromium", slug: "chromium", open: { width: 1400, height: 900 } },
	{ label: "WebKit iPhone 15 Pro", slug: "webkit-iphone", open: { engine: "webkit", device: "iPhone 15 Pro" } },
];

/** `packages/canvas/src/stage/backends/notice.ts`, word for word. */
export const NOTICE_TEXT = "This browser can't draw the stage: it needs WebGPU or WebGL 2.";

/** No WebGPU on the page: the worker is told the page's backend and opens the same. */
export function noGpu() {
	try {
		delete Navigator.prototype.gpu;
		delete navigator.gpu;
	} catch {
		/* not there to begin with */
	}
}

/** No WebGPU and no WebGL 2, on a page canvas or an `OffscreenCanvas`. */
export function noGpuNoWebgl() {
	try {
		delete Navigator.prototype.gpu;
		delete navigator.gpu;
	} catch {
		/* not there to begin with */
	}
	for (const kind of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas]) {
		if (!kind) continue;
		const get = kind.prototype.getContext;
		kind.prototype.getContext = function (type, ...rest) {
			return type === "webgl2" ? null : get.call(this, type, ...rest);
		};
	}
}

/** A wheel step about the middle of the stage, with the zoom key: `dy` < 0 zooms in. */
export async function zoomStep(page, dy) {
	await page.evaluate((deltaY) => {
		const stage = document.querySelector(".stage");
		const rect = stage.getBoundingClientRect();
		stage.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
	}, dy);
}

/** Zoom out until the boards are pictures rather than live pages. */
export async function outOfLive(page) {
	await page.waitForSelector(".stage", { timeout: 30000 });
	await settle(page, 1200);
	for (let i = 0; i < 16 && (await page.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")); i++) {
		await zoomStep(page, 60);
		await settle(page, 350);
	}
	await settle(page, 800);
}

/**
 * Whether the stage's canvas shows anything: a screenshot with it and one with it hidden, compared
 * in the page on a grid of points. `changed` is the share of points that differ.
 */
export async function canvasDraws(page) {
	const withIt = (await page.screenshot()).toString("base64");
	await page.evaluate(() => {
		for (const canvas of document.querySelectorAll("canvas.stage-engine")) canvas.style.visibility = "hidden";
	});
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
	const without = (await page.screenshot()).toString("base64");
	await page.evaluate(() => {
		for (const canvas of document.querySelectorAll("canvas.stage-engine")) canvas.style.visibility = "";
	});
	return page.evaluate(
		async ([a, b]) => {
			const pixels = async (base64) => {
				const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
				const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const context = canvas.getContext("2d");
				context.drawImage(bitmap, 0, 0);
				return context.getImageData(0, 0, bitmap.width, bitmap.height);
			};
			const [one, two] = await Promise.all([pixels(a), pixels(b)]);
			let points = 0;
			let changed = 0;
			for (let y = 2; y < one.height; y += 7) {
				for (let x = 2; x < one.width; x += 7) {
					const i = (y * one.width + x) * 4;
					points++;
					if (Math.abs(one.data[i] - two.data[i]) + Math.abs(one.data[i + 1] - two.data[i + 1]) + Math.abs(one.data[i + 2] - two.data[i + 2]) > 24) changed++;
				}
			}
			return { changed: Number((changed / points).toFixed(4)), points };
		},
		[withIt, without],
	);
}

/** A screenshot into `DECKS_E2E_SHOTS`, when it is set. */
export async function shot(page, name) {
	const dir = process.env.DECKS_E2E_SHOTS;
	if (dir) await page.screenshot({ path: join(dir, name) });
}
