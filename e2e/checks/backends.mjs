/**
 * The stage draws on what a browser has (`packages/canvas/src/stage/backends/`): WebGL 2 where there is no
 * WebGPU, in Chromium and in WebKit as an iPhone; and where there is neither, it says so.
 *
 * - `navigator.gpu` taken away: the page and its render worker open WebGL 2 (the `pkg-gl` build),
 *   the canvas draws the boards' pictures (a screenshot with it differs from one without it), and
 *   pictures are put on the engine.
 * - WebGL 2 taken away too: the notice is shown over the stage.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps a screenshot of each.
 */
import { open, resetStage, say, settle } from "../harness.mjs";
import { NOTICE_TEXT, TARGETS, canvasDraws, noGpu, noGpuNoWebgl, outOfLive, shot } from "../backends-kit.mjs";

for (const target of TARGETS) {
	const name = target.label;

	await resetStage();
	{
		const { browser, page, errors } = await open({ ...target.open, boards: false, init: noGpu });
		const stats = () => page.evaluate(() => window.__decksEngine?.stats?.());
		const opened = await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).then(() => true, () => false);
		const at = await stats();
		say(`${name}: no navigator.gpu, the page and the worker draw with WebGL 2`, opened && at?.backend === "webgl2" && at?.workerBackend === "webgl2", JSON.stringify(at));
		await outOfLive(page);
		await page.waitForFunction(() => (window.__decksEngine.stats().pictures ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
		await settle(page, 1500);
		const after = await stats();
		const pictured = await page.evaluate(() => JSON.parse(window.__decksRust?.page?.pictured?.() ?? "[]").length);
		say(`${name}: board pictures are put and drawn as pictures`, after.pictures > 0 && pictured > 0, JSON.stringify({ pictures: after.pictures, pictured, tiles: after.tiles }));
		await shot(page, `step4-${target.slug}-webgl2.png`);
		const draws = await canvasDraws(page);
		say(`${name}: the WebGL 2 canvas is not blank`, draws.changed > 0.01, JSON.stringify(draws));
		say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
		await browser.close();
	}

	await resetStage();
	{
		const { browser, page } = await open({ ...target.open, boards: false, init: noGpuNoWebgl });
		const shown = await page.waitForSelector(".stage-notice", { timeout: 30000 }).then(() => true, () => false);
		const text = shown ? await page.locator(".stage-notice").textContent() : "";
		const visible = shown && (await page.locator(".stage-notice").isVisible());
		say(`${name}: no WebGPU and no WebGL 2, the notice is shown`, visible && text?.trim() === NOTICE_TEXT, JSON.stringify(text));
		await shot(page, `step4-${target.slug}-notice.png`);
		await browser.close();
	}
}
