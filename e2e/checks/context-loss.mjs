/**
 * A WebGL 2 context lost and given back (`WEBGL_lose_context`): the stage stops drawing while it is
 * gone and starts its engine again on the same canvas when it is back (`stage/backends/webgl.ts`),
 * and draws the boards again. In Chromium and in WebKit as an iPhone, both without WebGPU.
 */
import { canvasFrame, open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, canvasDraws, noGpu, outOfLive } from "../backends-kit.mjs";

for (const target of TARGETS) {
	const name = target.label;
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, boards: false, init: noGpu });
	// The stage and its engine are in the canvas frame.
	const canvas = await canvasFrame(page);
	const stats = () => canvas.evaluate(() => window.__decksEngine?.stats?.());
	await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend === "webgl2", null, { timeout: 30000 }).catch(() => {});
	await outOfLive(page);
	await canvas.waitForFunction(() => (window.__decksEngine.stats().pictures ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
	await settle(page, 1000);
	const before = await stats();
	say(`${name}: the stage draws with WebGL 2 before`, before?.backend === "webgl2" && before.pictures > 0, JSON.stringify(before));
	/*
	 * How much of the screen the canvas covers before, which is what "draws the boards again" is
	 * held to: a correct redraw covers about as much as the first drawing did. (A fixed share of the
	 * screen was wrong — the fixture's boards cover about 1%, so a correct redraw scored just under it.)
	 */
	const drawnBefore = await canvasDraws(page);

	const lost = await canvas.evaluate(() => {
		const canvas = document.querySelector("canvas.stage-engine-over");
		const gl = canvas.getContext("webgl2");
		const ext = gl?.getExtension("WEBGL_lose_context");
		if (!ext) return false;
		window.__loseContext = ext;
		ext.loseContext();
		return true;
	});
	say(`${name}: the canvas's context can be lost`, lost);
	const paused = await canvas.waitForFunction(() => window.__decksEngine.stats().paused === true, null, { timeout: 5000 }).then(() => true, () => false);
	say(`${name}: while it is lost the engine draws nothing`, paused, JSON.stringify(await stats()));

	const shownBefore = await canvas.evaluate(() => window.__decksSheet?.shown ?? 0);
	await canvas.evaluate(() => window.__loseContext.restoreContext());
	const back = await page
		.waitForFunction(() => {
			const s = window.__decksEngine.stats();
			return s.restarts === 1 && !s.paused && s.workerBackend === "webgl2" && s.pictures > 0;
		}, null, { timeout: 20000 })
		.then(() => true, () => false);
	const after = await stats();
	say(`${name}: given back, the engine starts again on the same canvas`, back && after.backend === "webgl2", JSON.stringify(after));
	let draws = await canvasDraws(page);
	for (let waited = 0; waited < 5000 && draws.changed < 0.8 * drawnBefore.changed; waited += 500) {
		await settle(page, 500);
		draws = await canvasDraws(page);
	}
	const shownAfter = await canvas.evaluate(() => window.__decksSheet?.shown ?? 0);
	say(
		`${name}: and draws the boards again`,
		shownAfter > shownBefore && drawnBefore.changed > 0.002 && draws.changed >= 0.8 * drawnBefore.changed,
		JSON.stringify({ frames: shownAfter - shownBefore, before: drawnBefore.changed, ...draws }),
	);
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
