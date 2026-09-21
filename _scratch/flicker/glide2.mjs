/** Eight flies, medians, so one noisy run cannot decide anything. */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const LABEL = process.argv[2] ?? "build";
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.reload();
await resetStage(page);
await settle(page, 9000);

const fly = (row) => page.evaluate(async (row) => {
	const world = document.querySelector(".world");
	const stage = document.querySelector(".stage");
	const read = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(world.style.transform);
		return m ? Number(m[3]) : 0;
	};
	const samples = [];
	const start = performance.now();
	[...document.querySelectorAll(".board-row")][row]?.click();
	while (performance.now() - start < 900) {
		samples.push({ t: performance.now() - start, gliding: stage.dataset.gliding === "true", zoom: read() });
		await new Promise((r) => requestAnimationFrame(r));
	}
	const during = samples.filter((s) => s.gliding);
	const gaps = during.slice(1).map((s, i) => s.t - during[i].t).sort((a, b) => a - b);
	return { drawn: during.length, p90: +(gaps[Math.floor(gaps.length * 0.9)] ?? 0).toFixed(1), max: +(gaps.at(-1) ?? 0).toFixed(1) };
}, row);

const runs = [];
for (let i = 0; i < 9; i++) {
	runs.push(await fly(i % 2 === 0 ? 15 : 0));
	await settle(page, 1400);
}
const kept = runs.slice(1);                       // the first fly after a load is its own thing
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`${LABEL}: frames drawn per fly ${kept.map((r) => r.drawn).join(" ")}  median ${median(kept.map((r) => r.drawn))}`);
console.log(`${LABEL}: p90 frame gap ${kept.map((r) => r.p90).join(" ")}  median ${median(kept.map((r) => r.p90))} ms`);
console.log(`${LABEL}: worst gap ${kept.map((r) => r.max).join(" ")}  median ${median(kept.map((r) => r.max))} ms`);
console.log("errors", errors.slice(0, 2));
await browser.close();
