/**
 * The camera fly, frame by frame: where the travel is, and where the frames go missing.
 *
 * Samples the world's own transform on every animation frame through a glide, so the
 * reading is the pixels rather than what the app says the camera is.
 */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const RENDERER = process.argv[2] ?? "dom";
const CSS = process.argv[3] ?? "";

const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(([c]) => { try { localStorage.setItem("decks.renderer", c); } catch {} }, [RENDERER]);
await page.addInitScript(() => {
	window.__long = [];
	try {
		new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) }); })
			.observe({ entryTypes: ["longtask"] });
	} catch {}
	window.__loads = [];
	window.addEventListener("load", (e) => { if (e.target?.tagName === "IFRAME") window.__loads.push({ t: Math.round(performance.now()), path: e.target.dataset?.path ?? "?" }); }, true);
});
await page.reload();
await resetStage(page);
await settle(page, 8000);
if (CSS) await page.addStyleTag({ content: CSS });

const fly = (index) => page.evaluate(async (index) => {
	const world = document.querySelector(".world");
	const stage = document.querySelector(".stage");
	const read = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(world.style.transform);
		return m ? { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) } : null;
	};
	const rows = [...document.querySelectorAll(".board-row")];
	const before = read();
	const samples = [];
	const mountsBefore = document.querySelectorAll(".board-node iframe, .darkroom iframe").length;
	window.__long.length = 0;
	window.__loads.length = 0;
	const start = performance.now();
	rows[index]?.click();
	while (performance.now() - start < 1100) {
		const at = read();
		samples.push({ t: +(performance.now() - start).toFixed(1), gliding: stage.dataset.gliding === "true", scaling: stage.dataset.scaling === "true", ...at });
		await new Promise((r) => requestAnimationFrame(r));
	}
	return { before, samples, longtasks: window.__long.slice(), loads: window.__loads.slice(),
		mountsBefore, mountsAfter: document.querySelectorAll(".board-node iframe, .darkroom iframe").length };
}, index);

const report = (name, r) => {
	const s = r.samples;
	const gaps = s.slice(1).map((x, i) => +(x.t - s[i].t).toFixed(1));
	const during = s.filter((x) => x.gliding);
	const travel = (a, b) => Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
	const total = travel(r.before, s.at(-1));
	// per-frame progress while gliding, as a fraction of the whole move
	const steps = during.slice(1).map((x, i) => ({ t: x.t, dt: +(x.t - during[i].t).toFixed(1), moved: +(travel(during[i], x) / (total || 1)).toFixed(3), zoom: x.zoom }));
	const sorted = [...gaps].sort((a, b) => a - b);
	console.log(`\n== ${name}`);
	console.log(` frames ${s.length}, gliding frames ${during.length}, glide spans ${during.length ? during.at(-1).t - during[0].t : 0} ms`);
	console.log(` frame gap median ${sorted[Math.floor(sorted.length / 2)]} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]} ms, max ${sorted.at(-1)} ms`);
	console.log(` gaps over 25 ms: ${gaps.filter((g) => g > 25).length} -> ${gaps.filter((g) => g > 25).slice(0, 12).join(", ")}`);
	console.log(` long tasks: ${r.longtasks.length} -> ${r.longtasks.slice(0, 8).map((l) => l.ms + "ms").join(", ")}`);
	console.log(` documents loaded during the fly: ${r.loads.length}; frames mounted ${r.mountsBefore} -> ${r.mountsAfter}`);
	console.log(" per-frame travel while gliding (dt ms / share of the move):");
	console.log("  " + steps.map((x) => `${x.dt}/${x.moved}`).join("  "));
};

report(`${RENDERER} fly to the last row${CSS ? " [css: " + CSS.slice(0, 40) + "]" : ""}`, await fly(15));
await settle(page, 1500);
report(`${RENDERER} fly back to the first row`, await fly(0));
console.log("errors", errors.slice(0, 3));
await browser.close();
