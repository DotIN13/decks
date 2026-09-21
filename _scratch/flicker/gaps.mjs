/**
 * How long a board's picture is blank: from the clear that a resize does to the next
 * successful draw into the same canvas. Boards are flown away from, let go, and flown
 * back to — the case where a board that was on screen a moment ago has to be drawn again.
 */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");

const instrument = () => {
	window.__fl = { events: [], on: false };
	const f = window.__fl;
	const where = (canvas) => canvas.closest?.(".board-node")?.dataset?.path ?? canvas.className;
	const proto = CanvasRenderingContext2D.prototype;
	const orig = proto.drawElementImage;
	if (orig) proto.drawElementImage = function (el, dx, dy) {
		const at = { t: Math.round(performance.now()), path: where(this.canvas), kind: "draw" };
		try { const r = orig.call(this, el, dx, dy); if (f.on) f.events.push(at); return r; }
		catch (e) { at.kind = "draw-failed"; if (f.on) f.events.push(at); throw e; }
	};
	const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
	Object.defineProperty(HTMLCanvasElement.prototype, "width", {
		configurable: true, enumerable: desc.enumerable, get: desc.get,
		set(v) { if (f.on && v !== desc.get.call(this)) f.events.push({ t: Math.round(performance.now()), path: where(this), kind: "clear", v }); desc.set.call(this, v); },
	});
	window.addEventListener("load", (e) => {
		if (f.on && e.target?.tagName === "IFRAME") f.events.push({ t: Math.round(performance.now()), path: e.target.dataset?.path ?? "?", kind: "load" });
	}, true);
	window.__on = () => { f.on = true; };
	window.__events = () => f.events;
};

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(() => { try { localStorage.setItem("decks.renderer", "canvas-per-board"); } catch {} });
await page.addInitScript(instrument);
await page.reload();
await resetStage(page);
await settle(page, 8000);

const rows = await page.evaluate(() => [...document.querySelectorAll(".board-row")].map((r) => r.textContent?.trim()).slice(0, 30));
await page.evaluate(() => window.__on());
// Fly to the far end of the deck and stay there long enough for the documents behind to go.
await page.evaluate(() => [...document.querySelectorAll(".board-row")].at(-1)?.click());
await settle(page, 7000);
// And fly back.
await page.evaluate(() => [...document.querySelectorAll(".board-row")][0]?.click());
await settle(page, 4000);

const events = await page.evaluate(() => window.__events());
const byPath = new Map();
for (const e of events) {
	if (!byPath.has(e.path)) byPath.set(e.path, []);
	byPath.get(e.path).push(e);
}
const blanks = [];
for (const [path, list] of byPath) {
	let clearedAt;
	for (const e of list) {
		if (e.kind === "clear") clearedAt = clearedAt ?? e.t;
		if (e.kind === "draw" && clearedAt !== undefined) { blanks.push({ path, ms: e.t - clearedAt }); clearedAt = undefined; }
	}
	if (clearedAt !== undefined) blanks.push({ path, ms: null, note: "never redrawn" });
}
console.log(JSON.stringify({
	rows: rows.length,
	tally: events.reduce((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {}),
	blanks: blanks.sort((a, b) => (b.ms ?? 1e9) - (a.ms ?? 1e9)).slice(0, 20),
	timeline: events.slice(0, 60),
}, null, 1));
console.log("errors", errors.slice(0, 3));
await browser.close();
