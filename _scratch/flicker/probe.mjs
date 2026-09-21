/**
 * What each renderer does while the camera moves: draws, canvas clears, document loads.
 *
 * Talks to the fixture server on 4430 only — the ports are set before the harness is
 * imported, and asserted after.
 */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API, WEB } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430" || WEB !== "http://127.0.0.1:4430") throw new Error(`wrong ports: ${WEB} ${API}`);

const RENDERER = process.argv[2] ?? "canvas-per-board";

const instrument = () => {
	window.__fl = { draws: [], fails: 0, clears: [], bitmaps: 0, loads: [], paints: [], frames: 0, mark: "boot" };
	const f = window.__fl;
	const proto = CanvasRenderingContext2D.prototype;
	if (proto.drawElementImage) {
		const orig = proto.drawElementImage;
		proto.drawElementImage = function (el, dx, dy) {
			f.draws.push({ t: Math.round(performance.now()), mark: f.mark, cls: this.canvas.className, path: el?.dataset?.path ?? null });
			try {
				return orig.call(this, el, dx, dy);
			} catch (e) {
				f.fails++;
				throw e;
			}
		};
	}
	const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
	Object.defineProperty(HTMLCanvasElement.prototype, "width", {
		configurable: true,
		enumerable: desc.enumerable,
		get: desc.get,
		set(v) {
			if (v !== desc.get.call(this)) f.clears.push({ t: Math.round(performance.now()), mark: f.mark, cls: this.className, v });
			desc.set.call(this, v);
		},
	});
	const cib = window.createImageBitmap;
	window.createImageBitmap = function (...args) {
		f.bitmaps++;
		return cib.apply(this, args);
	};
	window.addEventListener("load", (e) => {
		if (e.target && e.target.tagName === "IFRAME") f.loads.push({ t: Math.round(performance.now()), mark: f.mark, path: e.target.dataset?.path ?? null });
	}, true);
	window.addEventListener("paint", () => f.paints.push({ t: Math.round(performance.now()), mark: f.mark }), true);
	const tick = () => { f.frames++; requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
	window.__mark = (m) => { f.mark = m; };
	window.__since = (m) => {
		const inMark = (list) => list.filter((x) => x.mark === m);
		return {
			draws: inMark(f.draws).length,
			drawsByClass: inMark(f.draws).reduce((acc, d) => ((acc[d.cls] = (acc[d.cls] ?? 0) + 1), acc), {}),
			clears: inMark(f.clears).length,
			clearsByClass: inMark(f.clears).reduce((acc, d) => ((acc[d.cls] = (acc[d.cls] ?? 0) + 1), acc), {}),
			loads: inMark(f.loads).length,
			paints: inMark(f.paints).length,
			fails: f.fails,
			bitmaps: f.bitmaps,
		};
	};
};

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(([choice]) => {
	try { localStorage.setItem("decks.renderer", choice); } catch {}
}, [RENDERER]);
await page.addInitScript(instrument);
await page.reload();
await resetStage(page);
await settle(page, 1500);
// Everything on the canvas, so there is something to pan over.
await page.evaluate(() => window.__mark("settle"));
await settle(page, 2500);

const running = await page.evaluate(() => ({
	renderer: document.querySelector(".stage")?.dataset.renderer,
	api: "drawElementImage" in CanvasRenderingContext2D.prototype,
	boards: document.querySelectorAll(".board-node").length,
	frames: document.querySelectorAll(".board-node iframe, .darkroom iframe").length,
}));

const phase = async (name, body) => {
	await page.evaluate((m) => window.__mark(m), name);
	const started = Date.now();
	const steps = await body();
	const ms = Date.now() - started;
	await settle(page, 400);
	const counts = await page.evaluate((m) => window.__since(m), name);
	return { name, ms, steps, msPerStep: steps ? +(ms / steps).toFixed(1) : null, ...counts };
};

const out = { renderer: RENDERER, running, phases: [] };

// Sit still: what happens when nothing is asked for.
out.phases.push(await phase("idle", async () => { await settle(page, 1200); return 0; }));

// A wheel pan: 40 steps, no waits, which is how ms/step is the lag the hand feels.
out.phases.push(await phase("pan", async () => {
	await page.mouse.move(750, 500);
	for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 40);
	return 40;
}));

// A wheel zoom (ctrl-wheel): the scale moving.
out.phases.push(await phase("zoom", async () => {
	await page.keyboard.down("Control");
	for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -20);
	await page.keyboard.up("Control");
	return 20;
}));
await settle(page, 1200);

// A camera fly: a row in the boards panel glides the view to that board.
out.phases.push(await phase("fly", async () => {
	const clicked = await page.evaluate(() => {
		const rows = [...document.querySelectorAll(".board-row")];
		const row = rows[rows.length - 1];
		row?.click();
		return Boolean(row);
	});
	if (!clicked) out.flyMissing = true;
	await settle(page, 1400);
	return 1;
}));

out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await browser.close();
