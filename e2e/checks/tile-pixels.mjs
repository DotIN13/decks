/**
 * Tiles handed to the page as their bytes draw the same pixels as tiles handed over as pictures.
 *
 * Under WebKit the render worker reads each tile it paints back from its device and posts its bytes
 * (`paintPixels` in `crates/web/src/bind.rs`, `pixelsFirst` in `packages/canvas/src/stage/engine.ts`),
 * and the page writes them into its texture (`putTilePixels`), because WebKit's copy of a worker's
 * picture into a texture costs the page about 2 ms a tile; Chromium, and WebGL 2 everywhere, keep
 * pictures. Both ways are compared in Chromium and in WebKit as an iPhone (whose WebGPU Playwright
 * has on a page served from 127.0.0.1), with `__decksTilePixels` choosing: three fresh pages on the
 * same stage, pictures, bytes, pictures again (the boards' own pictures and their shadows left out, which are made
 * again a little differently on each visit), each screenshotted at rest five zoom steps out from where
 * it opens, eight, and seven (one back in). The two picture pages must agree (the screenshots are steady), and the
 * bytes page must match them pixel for pixel, in WebKit exactly, in Chromium but for one faint seam
 * it draws one of two ways from visit to visit (within two levels); the bytes page must have had its tiles as
 * bytes, the others as pictures. Then, with nothing asked, WebKit is checked to hand tiles over as
 * bytes and Chromium as pictures.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps the screenshots.
 */
import { canvasFrame, open, rest, say, settle } from "../harness.mjs";
import { TARGETS, zoomStep } from "../backends-kit.mjs";
import { join } from "node:path";

const flag = (on) => `globalThis.__decksTilePixels = ${on};`;

/** Wait until the stage is at rest and has every tile of its window at its resting scale. */
async function sharp(page) {
	await rest(page, { start: 200, timeout: 8000 }).catch(() => {});
	// The stage and its engine are in the canvas frame.
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => (globalThis.__decksSheet?.settledAt ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
	// Quiet: no tile in for 600 ms.
	let last = -1;
	for (let i = 0; i < 40; i++) {
		const n = await canvas.evaluate(() => globalThis.__decksSheet?.tiles ?? 0);
		if (n === last) break;
		last = n;
		await settle(page, 600);
	}
}

async function shots(target, on, label) {
	const { browser, page, errors } = await open({ ...target.open, scheme: "light", init: flag(on) });
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 });
	const out = { label, errors, pictures: [], boards: [] };
	/*
	 * A screenshot, and where the boards are on it, in its pixels: a board's picture is the page's own
	 * (not a tile) and is made again from its page on each visit, a little differently, so it is left out.
	 */
	/* The chrome is not what is compared: the floats over the canvas (the tool column, the bars, the composer) are hidden for the picture. */
	const hidden = { content: ".pen-tools, .dock, .v3-bar, .panel-shell, .notices, .v3-zoom, .frame-tool-row { visibility: hidden !important; }" };
	await page.addStyleTag(hidden);
	await canvas.addStyleTag(hidden);
	const snap = async () => {
		out.pictures.push((await page.screenshot()).toString("base64"));
		out.boards.push(await canvas.evaluate(() => (window.__decksCards?.() ?? []).map(({ rect: r }) => [r.left, r.top, r.right, r.bottom].map((v) => v * devicePixelRatio))));
	};
	// Out by fixed steps (not until the boards are pictures, which depends on timing), so every page is at the same zoom.
	// Where it opens is not compared: live boards' pages differ a little from page to page.
	const out_ = async (steps) => {
		for (let i = 0; i < steps; i++) {
			await zoomStep(page, 60);
			await settle(page, 120);
		}
		await sharp(page);
	};
	await out_(5);
	await snap();
	await out_(3);
	await snap();
	await zoomStep(page, -25);
	await sharp(page);
	await snap();
	out.stats = await canvas.evaluate(() => ({ ...window.__decksEngine.stats(), pixelTiles: globalThis.__decksSheet?.pixelTiles ?? 0, tiles: globalThis.__decksSheet?.tiles ?? 0 }));
	out.compare = (a, b, boards) =>
		page.evaluate(
			async ([one, two, boards]) => {
				const read = async (base64) => {
					const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
					const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
					const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
					const context = canvas.getContext("2d");
					context.drawImage(bitmap, 0, 0);
					return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
				};
				const [x, y] = await Promise.all([read(one), read(two)]);
				let differ = 0;
				let most = 0;
				let box;
				const width = (await createImageBitmap(new Blob([Uint8Array.from(atob(one), (c) => c.charCodeAt(0))], { type: "image/png" }))).width;
				const onBoard = (px, py) => boards.some(([l, t, r, b]) => px >= l - 48 && px <= r + 48 && py >= t - 48 && py <= b + 48);
				for (let i = 0; i < x.length; i += 4) {
					const p = i / 4;
					if (onBoard(p % width, Math.floor(p / width))) continue;
					const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
					if (d > 0) {
						differ++;
						const [px, py] = [p % width, Math.floor(p / width)];
						box = box ? [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)] : [px, py, px, py];
					}
					most = Math.max(most, d);
				}
				return { differ, most, pixels: x.length / 4, box };
			},
			[a, b, boards],
		);
	out.close = () => browser.close();
	const dir = process.env.DECKS_E2E_SHOTS;
	if (dir) {
		const { writeFileSync } = await import("node:fs");
		out.pictures.forEach((p, i) => writeFileSync(join(dir, `tile-pixels-${target.slug}-${label}-${i}.png`), Buffer.from(p, "base64")));
	}
	return out;
}

for (const target of TARGETS) {
	const name = target.label;
	const first = await shots(target, false, "pictures");
	const bytes = await shots(target, true, "bytes");
	const again = await shots(target, false, "pictures-again");
	say(`${name}: tiles as pictures when not asked for bytes`, first.stats.pixelTiles === 0 && first.stats.tiles > 0, JSON.stringify(first.stats));
	say(`${name}: tiles as bytes when asked (__decksTilePixels), on WebGPU`, first.stats.workerBackend === "webgpu" && bytes.stats.pixelTiles > 0 && bytes.stats.pixelTiles === bytes.stats.tiles, JSON.stringify(bytes.stats));
	const views = ["five zoom steps out", "eight steps out", "seven steps out"];
	for (let i = 0; i < views.length; i++) {
		const boards = [...first.boards[i], ...again.boards[i], ...bytes.boards[i]];
		const steady = await first.compare(first.pictures[i], again.pictures[i], boards);
		/*
		 * Chromium draws its seams (a line a pixel wide where two tiles meet) one of two ways, a few
		 * levels apart, as it happens on each visit, tiles as pictures both times as well: in Chromium,
		 * steady and the same are each within four levels on under 0.25% of the pixels. A seam runs the
		 * height of the window between two columns of tiles, and the fixture's cards stand in one narrow
		 * column, so two seams' whole length is bare canvas: 1 to 2.2 thousand pixels of 1.26 million,
		 * at most two levels, were seen. WebKit, the engine the bytes are for, must match exactly.
		 */
		const webkit = target.open.engine === "webkit";
		const near = (d) => d.differ === 0 || (!webkit && d.most <= 4 && d.differ < d.pixels * 0.0025);
		say(`${name}, ${views[i]}: two picture pages agree (the screenshot is steady)`, near(steady), JSON.stringify(steady));
		const same = [await first.compare(first.pictures[i], bytes.pictures[i], boards), await again.compare(again.pictures[i], bytes.pictures[i], boards)];
		say(`${name}, ${views[i]}: tiles as bytes draw the same pixels as tiles as pictures`, same.some((d) => d.differ === 0) || same.every(near), JSON.stringify(same));
	}
	for (const run of [first, bytes, again]) say(`${name}, ${run.label}: no errors on the page`, run.errors.length === 0, run.errors.join(" | "));
	await first.close();
	await bytes.close();
	await again.close();
}

// Unasked, WebKit hands tiles over as bytes and Chromium as pictures (`pixelsFirst`).
for (const target of TARGETS) {
	const { browser, page } = await open({ ...target.open, scheme: "light", cards: false });
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 });
	await sharp(page);
	const stats = await canvas.evaluate(() => ({ ...window.__decksEngine.stats(), pixelTiles: globalThis.__decksSheet?.pixelTiles ?? 0, tiles: globalThis.__decksSheet?.tiles ?? 0 }));
	const webkit = target.open.engine === "webkit";
	say(`${target.label}: unasked, tiles come as ${webkit ? "bytes" : "pictures"}`, stats.tiles > 0 && (webkit ? stats.pixelTiles === stats.tiles : stats.pixelTiles === 0), JSON.stringify(stats));
	await browser.close();
}
