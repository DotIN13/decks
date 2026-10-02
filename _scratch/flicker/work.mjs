/**
 * How much main-thread *work* one fly costs, by category — the metric that survives a
 * busy machine, where frame counts do not.
 */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const LABEL = process.argv[2] ?? "build";
const { browser, page } = await open({ width: 1500, height: 1000, boards: false });
await page.reload();
await resetStage(page);
await settle(page, 9000);

const client = await page.context().newCDPSession(page);
const WANTED = ["Layout", "UpdateLayoutTree", "Paint", "FunctionCall", "FireAnimationFrame", "ParseHTML", "Layerize", "PrePaint"];
const runs = [];
for (let i = 0; i < 5; i++) {
	const events = [];
	const collect = ({ value }) => events.push(...value);
	client.on("Tracing.dataCollected", collect);
	await client.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline"] } });
	await page.evaluate(async (row) => {
		[...document.querySelectorAll(".board-row")][row]?.click();
		await new Promise((r) => setTimeout(r, 800));
	}, i % 2 === 0 ? 15 : 0);
	const done = new Promise((r) => client.once("Tracing.tracingComplete", r));
	await client.send("Tracing.end");
	await done;
	client.off("Tracing.dataCollected", collect);
	const sum = {};
	for (const e of events) if (e.ph === "X" && WANTED.includes(e.name)) sum[e.name] = (sum[e.name] ?? 0) + (e.dur ?? 0) / 1000;
	sum.total = WANTED.reduce((t, k) => t + (sum[k] ?? 0), 0);
	runs.push(sum);
	await settle(page, 3000);
}
const kept = runs.slice(1);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`\n${LABEL} — main-thread work per fly, median of ${kept.length} (ms)`);
for (const name of [...WANTED, "total"]) console.log(` ${name.padEnd(20)} ${median(kept.map((r) => r[name] ?? 0)).toFixed(1)}`);
await browser.close();
