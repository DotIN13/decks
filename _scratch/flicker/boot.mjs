/** From the moment a board's document loads, how long before its picture exists. */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const instrument = () => {
	window.__fl = { events: [] };
	const f = window.__fl;
	const where = (canvas) => canvas.closest?.(".board-node")?.dataset?.path ?? canvas.className;
	const proto = CanvasRenderingContext2D.prototype;
	const orig = proto.drawElementImage;
	if (orig) proto.drawElementImage = function (el, dx, dy) {
		const at = { t: Math.round(performance.now()), path: where(this.canvas), kind: "draw" };
		try { const r = orig.call(this, el, dx, dy); f.events.push(at); return r; }
		catch (e) { at.kind = "draw-failed"; f.events.push(at); throw e; }
	};
	const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
	Object.defineProperty(HTMLCanvasElement.prototype, "width", { configurable: true, enumerable: desc.enumerable, get: desc.get,
		set(v) { if (v !== desc.get.call(this)) f.events.push({ t: Math.round(performance.now()), path: where(this), kind: "clear" }); desc.set.call(this, v); } });
	window.addEventListener("load", (e) => { if (e.target?.tagName === "IFRAME") f.events.push({ t: Math.round(performance.now()), path: e.target.dataset?.path ?? "?", kind: "load" }); }, true);
	window.__events = () => f.events;
};
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(() => { try { localStorage.setItem("decks.renderer", "canvas-per-board"); } catch {} });
await page.addInitScript(instrument);
await page.reload();
await resetStage(page);
await settle(page, 10000);
const events = await page.evaluate(() => window.__events());
const per = new Map();
for (const e of events) { if (!per.has(e.path)) per.set(e.path, []); per.get(e.path).push(e); }
const rows = [];
for (const [path, list] of per) {
	if (!path.startsWith("boards/")) continue;
	const load = list.find((e) => e.kind === "load");
	const firstDraw = list.find((e) => e.kind === "draw");
	const firstClear = list.find((e) => e.kind === "clear");
	rows.push({ path: path.replace("boards/", ""), loadToPicture: load && firstDraw ? firstDraw.t - load.t : null,
		blankFrom: firstClear && firstDraw ? firstDraw.t - firstClear.t : null,
		failed: list.filter((e) => e.kind === "draw-failed").length, draws: list.filter((e) => e.kind === "draw").length });
}
const drawn = await page.evaluate(() => [...document.querySelectorAll("canvas.picture")].map((c) => {
	const ctx = c.getContext("2d"); const d = ctx.getImageData(0, 0, Math.min(c.width, 40), Math.min(c.height, 40)).data;
	let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
	return { path: c.closest(".board-node")?.dataset.path?.replace("boards/", ""), w: c.width, ink };
}));
console.log(JSON.stringify({ rows: rows.sort((a, b) => (b.loadToPicture ?? 0) - (a.loadToPicture ?? 0)), emptyCanvases: drawn.filter((d) => d.ink === 0) }, null, 1));
console.log("errors", errors.slice(0, 3));
await browser.close();
