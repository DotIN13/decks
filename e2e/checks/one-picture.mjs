/**
 * Every board has one picture, fetched once at one width for the device's GPU (`device.ts`,
 * `PICTURES`: 480 px on a big one, 192 on a small one) and copied to the GPU once; the GPU makes
 * its smaller sizes and draws it at any zoom from the nearest (`stage/engine.ts`, `wantBoardPictures`).
 * A zoom out and back in fetches nothing. Over the budget, pictures shrink on the GPU (`fitPictures`),
 * with no request either. Chromium (a big GPU) and WebKit as an iPhone (a small one).
 */
import { canvasFrame, open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, noGpu, outOfLive, zoomStep } from "../backends-kit.mjs";

/** The board pictures asked for: `{ board, w }`, `w` 0 for the whole picture. */
function watchCopies(page) {
	const asked = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		// The server's picture of a board (`canvas/shots/adaptors.ts`): `whole=1`, and `w=` for a copy.
		if (!url.searchParams.has("whole")) return;
		asked.push({ board: url.searchParams.get("path") ?? url.pathname, w: Number(url.searchParams.get("w") ?? 0), astc: url.searchParams.get("astc") === "1" });
	});
	return asked;
}
/** WebKit as an iPhone, as a real one reports itself: Playwright's says it is a Mac with no touch. */
function asIPhone() {
	Object.defineProperty(Navigator.prototype, "platform", { get: () => "iPhone" });
}
const held = (frame) => frame.evaluate(() => Object.fromEntries([...window.__decksRust.picturesAsked.entries()].filter(([key]) => key.startsWith("board:")).map(([key, one]) => [key, one.size ?? 0])));

for (const target of TARGETS) {
	const name = target.label;
	const width = target.slug === "chromium" ? 480 : 192;
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, boards: false, init: target.slug === "chromium" ? undefined : `(${noGpu})(); (${asIPhone})();` });
	// The stage and its engine are in the canvas frame.
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});
	const asked = watchCopies(page);
	await outOfLive(page);
	for (let i = 0; i < 6; i++) {
		await zoomStep(page, 80);
		await settle(page, 120);
	}
	await settle(page, 2500);
	const first = await held(canvas);
	say(`${name}: every board's picture is fetched at ${width} px`, Object.keys(first).length > 0 && Object.values(first).every((w) => w === width), JSON.stringify(first));
	const before = asked.length;
	// Compressed wherever the GPU takes ASTC: WebGPU with the feature, or WebGL 2 with `WEBGL_compressed_texture_astc` (any Mac's).
	if (await canvas.evaluate(() => window.__decksRust.page.compressedPictures())) {
		// Compressed: asked for so, sent so, and a byte a pixel on the GPU (four, as RGBA, before).
		// A first look gets the server's stand-in for a size it has not made yet, asked again until it has.
		const boards = Object.keys(first).length;
		const put = () => canvas.evaluate(() => window.__decksRust.compressedPut);
		for (let i = 0; i < 40 && (await put()) < boards; i++) await settle(page, 500);
		const perPixel = await canvas.evaluate(() => {
			const engine = window.__decksRust;
			const each = [...engine.compressedSize].map(([key, [w, h]]) => engine.pictureBytes.get(key) / (w * h));
			return each.length ? Math.max(...each) : 0;
		});
		say(`${name}: pictures are asked for compressed, for the GPU`, asked.every((one) => one.astc), JSON.stringify(asked.slice(0, 3)));
		say(`${name}: …and come compressed, every board`, (await put()) >= boards, `${await put()} put compressed for ${boards} boards`);
		say(`${name}: …about a byte a pixel on the GPU, its smaller sizes included`, perPixel > 1 && perPixel < 1.6, perPixel.toFixed(2));
	} else say(`${name}: where the GPU takes no ASTC, pictures are not asked for compressed`, asked.every((one) => !one.astc), JSON.stringify(asked.slice(0, 3)));

	// In and back out, in steps a pinch would make, below the live zoom, resting between.
	for (const delta of [-30, -30, -30, -30, 80, 80, 80, 80]) {
		if (delta < 0 && (await canvas.evaluate(() => document.querySelector(".stage")?.dataset.live === "true"))) continue;
		await zoomStep(page, delta);
		await settle(page, 400);
	}
	await settle(page, 1500);
	const zoomed = asked.slice(before).filter((one) => Object.keys(first).some((key) => key.endsWith(one.board)));
	say(`${name}: zooming in and out fetches no board again`, zoomed.length === 0, JSON.stringify(zoomed.slice(0, 6)));
	say(`${name}: and each still holds its one picture`, JSON.stringify(await held(canvas)) === JSON.stringify(first), JSON.stringify(await held(canvas)));

	// A budget far too small: the pictures shrink on the GPU, with no request.
	const sent = asked.length;
	const shrunk = await canvas.evaluate(async () => {
		window.__decksPictureMB = 0.05;
		window.__decksRust.fitPictures();
		await new Promise((done) => setTimeout(done, 300));
		return { shrunk: window.__decksRust.shrunk.size, bytes: window.__decksRust.heldBytes() };
	});
	const backend = await canvas.evaluate(() => window.__decksEngine?.stats?.().backend);
	// WebGL 2 keeps one size of a WebP picture (`Gpu::picture_texture`), and cannot copy a compressed one's smaller sizes (`Gpu::shrink`), so nothing shrinks.
	if (backend === "webgl2") say(`${name}: on WebGL 2 nothing shrinks`, shrunk.shrunk === 0, JSON.stringify({ backend, ...shrunk }));
	else say(`${name}: over the budget, pictures shrink on the GPU`, shrunk.shrunk > 0, JSON.stringify({ backend, ...shrunk }));
	say(`${name}: …with no picture fetched for it`, asked.length === sent, JSON.stringify(asked.slice(sent, sent + 4)));
	await canvas.evaluate(() => delete window.__decksPictureMB);
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
