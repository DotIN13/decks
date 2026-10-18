/**
 * A board's picture is fetched again, larger, when a zoom in outgrows the copy held: on a phone the
 * first copy was a small one (`?w=192`, `?w=480`) and stayed, blurred, however far in the camera went
 * (`stage/engine.ts`, `wantBoardPictures`). The larger copy is asked once the zoom has rested, not
 * at every step of it, and never smaller again on the way out. Chromium and WebKit as an iPhone.
 */
import { open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, noGpu, outOfLive, zoomStep } from "../backends-kit.mjs";

/** The board copies asked for, by board, in order: `[path, width]`, width 0 for the whole picture. */
function watchCopies(page) {
	const asked = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		// The server's picture of a board (`canvas/shots/adaptors.ts`): `whole=1`, and `w=` for a copy.
		if (!url.searchParams.has("whole")) return;
		asked.push({ board: url.searchParams.get("path") ?? url.pathname, w: Number(url.searchParams.get("w") ?? 0), at: Date.now() });
	});
	return asked;
}

for (const target of TARGETS) {
	const name = target.label;
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, boards: false, init: target.slug === "chromium" ? undefined : noGpu });
	await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});
	await outOfLive(page);
	// Further out, so every board's first copy is the smallest.
	for (let i = 0; i < 6; i++) {
		await zoomStep(page, 80);
		await settle(page, 120);
	}
	await settle(page, 2500);
	const asked = watchCopies(page);
	const small = await page.evaluate(() => {
		const sizes = [...window.__decksRust.picturesAsked.entries()].filter(([key]) => key.startsWith("board:")).map(([key, one]) => [key, one.size ?? 0]);
		return Object.fromEntries(sizes);
	});
	say(`${name}: zoomed out, boards hold a copy of their picture smaller than the whole`, Object.values(small).some((w) => w > 0), JSON.stringify(small));

	// Zoom in, in steps a pinch would make, staying below the live zoom.
	const steps = [];
	for (let i = 0; i < 10; i++) {
		if (await page.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")) break;
		await zoomStep(page, -30);
		steps.push(Date.now());
		await page.waitForTimeout(60);
	}
	const during = asked.filter((one) => one.w > 192 || one.w === 0).length;
	await settle(page, 2500);
	const after = await page.evaluate(() => Object.fromEntries([...window.__decksRust.picturesAsked.entries()].filter(([key]) => key.startsWith("board:")).map(([key, one]) => [key, one.size ?? 0])));
	const sharper = Object.entries(after).filter(([key, w]) => small[key] && (w === 0 || w > small[key]));
	say(`${name}: zoomed in, boards shown wider than their copy are fetched larger`, sharper.length > 0, JSON.stringify({ zoom: await page.evaluate(() => window.__decksRust.camera.zoom), after }));
	say(`${name}: nothing larger is asked while the zoom is still changing`, during === 0, JSON.stringify(asked.slice(0, 8)));
	const perBoard = new Map();
	for (const one of asked) perBoard.set(one.board, (perBoard.get(one.board) ?? 0) + 1);
	say(`${name}: one larger copy a board, not a request at every step`, [...perBoard.values()].every((n) => n <= 2), JSON.stringify([...perBoard]));

	// Back out: the sharp copy stays.
	for (let i = 0; i < 4; i++) {
		await zoomStep(page, 80);
		await settle(page, 120);
	}
	await settle(page, 1200);
	const out = await page.evaluate(() => Object.fromEntries([...window.__decksRust.picturesAsked.entries()].filter(([key]) => key.startsWith("board:")).map(([key, one]) => [key, one.size ?? 0])));
	say(`${name}: zooming back out keeps the sharper copy`, sharper.every(([key, w]) => out[key] === w), JSON.stringify(out));
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
