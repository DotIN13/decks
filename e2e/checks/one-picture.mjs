/**
 * Every board has one picture, fetched once at one width for the device's GPU (`device.ts`,
 * `PICTURES`: 1024 px on a big one, 512 on a small one) and copied to the GPU once; the GPU makes
 * its smaller sizes and draws it at any zoom from the nearest (`stage/engine.ts`, `wantBoardPictures`).
 * A zoom out and back in fetches nothing. Over the budget, pictures shrink on the GPU (`fitPictures`),
 * with no request either. Chromium (a big GPU) and WebKit as an iPhone (a small one).
 */
import { open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, noGpu, outOfLive, zoomStep } from "../backends-kit.mjs";

/** The board pictures asked for: `{ board, w }`, `w` 0 for the whole picture. */
function watchCopies(page) {
	const asked = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		// The server's picture of a board (`canvas/shots/adaptors.ts`): `whole=1`, and `w=` for a copy.
		if (!url.searchParams.has("whole")) return;
		asked.push({ board: url.searchParams.get("path") ?? url.pathname, w: Number(url.searchParams.get("w") ?? 0) });
	});
	return asked;
}
/** WebKit as an iPhone, as a real one reports itself: Playwright's says it is a Mac with no touch. */
function asIPhone() {
	Object.defineProperty(Navigator.prototype, "platform", { get: () => "iPhone" });
}
const held = (page) => page.evaluate(() => Object.fromEntries([...window.__decksRust.picturesAsked.entries()].filter(([key]) => key.startsWith("board:")).map(([key, one]) => [key, one.size ?? 0])));

for (const target of TARGETS) {
	const name = target.label;
	const width = target.slug === "chromium" ? 1024 : 512;
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, boards: false, init: target.slug === "chromium" ? undefined : `(${noGpu})(); (${asIPhone})();` });
	await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});
	const asked = watchCopies(page);
	await outOfLive(page);
	for (let i = 0; i < 6; i++) {
		await zoomStep(page, 80);
		await settle(page, 120);
	}
	await settle(page, 2500);
	const first = await held(page);
	say(`${name}: every board's picture is fetched at ${width} px`, Object.keys(first).length > 0 && Object.values(first).every((w) => w === width), JSON.stringify(first));
	const before = asked.length;

	// In and back out, in steps a pinch would make, below the live zoom, resting between.
	for (const delta of [-30, -30, -30, -30, 80, 80, 80, 80]) {
		if (delta < 0 && (await page.evaluate(() => document.querySelector(".stage")?.dataset.live === "true"))) continue;
		await zoomStep(page, delta);
		await settle(page, 400);
	}
	await settle(page, 1500);
	const zoomed = asked.slice(before).filter((one) => Object.keys(first).some((key) => key.endsWith(one.board)));
	say(`${name}: zooming in and out fetches no board again`, zoomed.length === 0, JSON.stringify(zoomed.slice(0, 6)));
	say(`${name}: and each still holds its one picture`, JSON.stringify(await held(page)) === JSON.stringify(first), JSON.stringify(await held(page)));

	// A budget far too small: the pictures shrink on the GPU, with no request.
	const sent = asked.length;
	const shrunk = await page.evaluate(async () => {
		window.__decksPictureMB = 0.05;
		window.__decksRust.fitPictures();
		await new Promise((done) => setTimeout(done, 300));
		return { shrunk: window.__decksRust.shrunk.size, bytes: window.__decksRust.heldBytes() };
	});
	const backend = await page.evaluate(() => window.__decksEngine?.stats?.().backend);
	// WebGL 2 keeps one size of a picture (`Gpu::picture_texture`), so it has nothing smaller to shrink to.
	if (backend === "webgl2") say(`${name}: on WebGL 2 a picture has one size, so nothing shrinks`, shrunk.shrunk === 0, JSON.stringify({ backend, ...shrunk }));
	else say(`${name}: over the budget, pictures shrink on the GPU`, shrunk.shrunk > 0, JSON.stringify({ backend, ...shrunk }));
	say(`${name}: …with no picture fetched for it`, asked.length === sent, JSON.stringify(asked.slice(sent, sent + 4)));
	await page.evaluate(() => delete window.__decksPictureMB);
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
