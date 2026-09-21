/** Sit completely still and watch what the renderer does anyway. */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const RENDERER = process.argv[2] ?? "one-canvas";

const instrument = () => {
	window.__fl = { draws: [], bitmaps: 0, paints: [], on: false };
	const f = window.__fl;
	const proto = CanvasRenderingContext2D.prototype;
	const orig = proto.drawElementImage;
	if (orig) proto.drawElementImage = function (el, dx, dy) {
		if (f.on) f.draws.push(el?.dataset?.path ?? this.canvas.className);
		try { return orig.call(this, el, dx, dy); } catch (e) { throw e; }
	};
	const cib = window.createImageBitmap;
	window.createImageBitmap = function (...a) { if (f.on) f.bitmaps++; return cib.apply(this, a); };
	window.addEventListener("paint", (e) => {
		if (!f.on) return;
		const changed = e.changedElements;
		f.paints.push({ on: e.target?.className, n: changed ? changed.length : -1, paths: changed ? [...changed].map((x) => x.dataset?.path ?? x.tagName) : null });
	}, true);
	window.__on = () => { f.on = true; };
	window.__read = (seconds) => {
		const tally = (list) => list.reduce((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
		return {
			seconds,
			draws: f.draws.length,
			perPath: tally(f.draws),
			bitmaps: f.bitmaps,
			paints: f.paints.length,
			paintTargets: tally(f.paints.map((p) => `${p.on}:${p.n}`)),
			paintPaths: tally(f.paints.flatMap((p) => p.paths ?? ["(no changedElements)"])),
		};
	};
};

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(([c]) => { try { localStorage.setItem("decks.renderer", c); } catch {} }, [RENDERER]);
await page.addInitScript(instrument);
await page.reload();
await resetStage(page);
await settle(page, 8000);
await page.evaluate(() => window.__on());
await settle(page, 5000);
console.log(JSON.stringify(await page.evaluate(() => window.__read(5)), null, 1));
console.log("errors", errors.slice(0, 3));
await browser.close();
