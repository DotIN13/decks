/** One fly, traced: where the main thread's time goes, by event name. */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const RENDERER = process.argv[2] ?? "dom";
const { browser, page } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(([c]) => { try { localStorage.setItem("decks.renderer", c); } catch {} }, [RENDERER]);
await page.reload();
await resetStage(page);
await settle(page, 9000);
const FIRST = process.argv[3] === "first";
if (!FIRST) {
	await page.evaluate(() => [...document.querySelectorAll(".board-row")].at(-1)?.click());
	await settle(page, 2500);
}

const events = [];
const client = await page.context().newCDPSession(page);
client.on("Tracing.dataCollected", ({ value }) => events.push(...value));
await client.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] } });
await page.evaluate((row) => { window.__row = row; }, FIRST ? 15 : 0);
await page.evaluate(async () => {
	[...document.querySelectorAll(".board-row")][window.__row ?? 0]?.click();
	await new Promise((r) => setTimeout(r, 900));
});
const done = new Promise((r) => client.once("Tracing.tracingComplete", r));
await client.send("Tracing.end");
await done;

// Self time per event name on the renderer main thread.
const byName = new Map();
const stack = [];
const ordered = events.filter((e) => e.ph === "X" || e.ph === "B" || e.ph === "E").sort((a, b) => a.ts - b.ts);
for (const e of ordered) {
	if (e.ph === "X") {
		const dur = (e.dur ?? 0) / 1000;
		byName.set(e.name, (byName.get(e.name) ?? 0) + dur);
		const parent = stack.at(-1);
		if (parent) parent.child += dur;
	}
}
const rows = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
console.log(`traced events ${events.length}`);
for (const [name, ms] of rows) console.log(` ${name.padEnd(34)} ${ms.toFixed(1)} ms`);
const paints = events.filter((e) => e.name === "Paint").length;
const frames = events.filter((e) => e.name === "DrawFrame" || e.name === "Commit").length;
console.log(` Paint events ${paints}, frames committed ${frames}`);
await browser.close();
