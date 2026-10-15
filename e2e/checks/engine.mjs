/**
 * The C++ stage engine (`packages/engine`, `canvas/engine-stage.ts`), switched on: boards zoomed out
 * are drawn by it under their pages, and the worker's sheet, with no drawing to paint, stays hidden.
 *
 * Headless Chromium here has no WebGPU adapter without extra flags, so this runs the WebGL 2 path;
 * `packages/engine/test/run.mjs` checks both backends' pixels on their own.
 */
import { open, resetStage, say, settle, socket } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open();
try {
	const url = new URL(page.url());
	url.searchParams.set("engine", "on");
	await page.goto(url.href);
	await settle(page, 2500);
	const link = await socket();
	const boards = ["plan.html", "notes.html", "risks.html", "sources.html"];
	for (const path of boards) link.send({ type: "board.play", path: `boards/${path}` });
	await settle(page, 1500);
	say("the engine's canvas is under the world", await page.evaluate(() => {
		const canvas = document.querySelector(".stage-engine");
		const world = document.querySelector(".world");
		return !!canvas && !!world && !!(canvas.compareDocumentPosition(world) & Node.DOCUMENT_POSITION_FOLLOWING);
	}));

	// Out to where the boards are pictures, not pages.
	await page.mouse.move(800, 450);
	await page.keyboard.down("Control");
	for (let i = 0; i < 10; i++) {
		await page.mouse.wheel(0, 120);
		await settle(page, 100);
	}
	await page.keyboard.up("Control");
	const until = async (test, ms = 10000) => {
		const end = Date.now() + ms;
		for (;;) {
			const value = await test();
			if (value || Date.now() > end) return value;
			await settle(page, 200);
		}
	};
	/*
	 * Pictures come from the server's screenshot queue, which on a fresh fixture is still making them:
	 * waited for longer than a frame needs, and one is enough to show the path works.
	 */
	const stats = await until(() => page.evaluate(() => {
		const s = globalThis.__decksEngine?.stats();
		return s && s.pictures >= 1 && s.drawn[0] >= 3 ? s : undefined;
	}), 20000);
	say("the engine started on a backend", !!stats?.backend, JSON.stringify(stats));
	say("it fetched the boards' pictures", (stats?.pictures ?? 0) >= 1, JSON.stringify(stats));
	say("and drew them", (stats?.drawn?.[0] ?? 0) >= 3, JSON.stringify(stats?.drawn));
	say("each at the size it shows, not whole", (stats?.bytes ?? Infinity) < 16 * 1024 * 1024, `${Math.round((stats?.bytes ?? 0) / 1024)} KB`);
	say(
		"the worker's sheet stays hidden, with only boards on the stage",
		await page.evaluate(() => document.querySelector(".stage-sheet")?.hidden === true && globalThis.__decksSheet?.ck !== true),
		String(JSON.stringify(await page.evaluate(() => globalThis.__decksSheet ?? null))).slice(0, 200),
	);
	link.close();
	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
