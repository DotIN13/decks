/**
 * A WebGL 2 context lost and given back (`WEBGL_lose_context`): the stage stops drawing while it is
 * gone and starts its engine again on the same canvas when it is back (`stage/backends/webgl.ts`),
 * and draws the boards again. In Chromium and in WebKit as an iPhone, both without WebGPU.
 */
import { open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, canvasDraws, noGpu, outOfLive } from "../backends-kit.mjs";

for (const target of TARGETS) {
	const name = target.label;
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, boards: false, init: noGpu });
	const stats = () => page.evaluate(() => window.__decksEngine?.stats?.());
	await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend === "webgl2", null, { timeout: 30000 }).catch(() => {});
	await outOfLive(page);
	await page.waitForFunction(() => (window.__decksEngine.stats().pictures ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
	await settle(page, 1000);
	const before = await stats();
	say(`${name}: the stage draws with WebGL 2 before`, before?.backend === "webgl2" && before.pictures > 0, JSON.stringify(before));

	const lost = await page.evaluate(() => {
		const canvas = document.querySelector("canvas.stage-engine-over");
		const gl = canvas.getContext("webgl2");
		const ext = gl?.getExtension("WEBGL_lose_context");
		if (!ext) return false;
		window.__loseContext = ext;
		ext.loseContext();
		return true;
	});
	say(`${name}: the canvas's context can be lost`, lost);
	const paused = await page.waitForFunction(() => window.__decksEngine.stats().paused === true, null, { timeout: 5000 }).then(() => true, () => false);
	say(`${name}: while it is lost the engine draws nothing`, paused, JSON.stringify(await stats()));

	const shownBefore = await page.evaluate(() => window.__decksSheet?.shown ?? 0);
	await page.evaluate(() => window.__loseContext.restoreContext());
	const back = await page
		.waitForFunction(() => {
			const s = window.__decksEngine.stats();
			return s.restarts === 1 && !s.paused && s.workerBackend === "webgl2" && s.pictures > 0;
		}, null, { timeout: 20000 })
		.then(() => true, () => false);
	const after = await stats();
	say(`${name}: given back, the engine starts again on the same canvas`, back && after.backend === "webgl2", JSON.stringify(after));
	await settle(page, 1500);
	const shownAfter = await page.evaluate(() => window.__decksSheet?.shown ?? 0);
	const draws = await canvasDraws(page);
	say(`${name}: and draws the boards again`, shownAfter > shownBefore && draws.changed > 0.01, JSON.stringify({ frames: shownAfter - shownBefore, ...draws }));
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
