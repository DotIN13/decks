/**
 * Pictures of words at rest, for judging text sharpness by eye: not a pass/fail check.
 *
 * A canvas `text-shots` of Latin and Chinese words at a few sizes (text and notes), opened at a 2×
 * screen, shown at each zoom in `TEXT_SHOTS_ZOOMS` (103, 112, 61 by default, in %), and a PNG of the
 * words taken at each, once no tile has come for a while:
 *
 *   TEXT_SHOTS_DIR=<folder> TEXT_SHOTS_TAG=before node e2e/run.mjs text-shots
 *
 * writes `<folder>/<tag>-<zoom>.png`. Run only when named.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canvasFrame, deckState, open, say, socket } from "../harness.mjs";

const DIR = process.env.TEXT_SHOTS_DIR;
const TAG = process.env.TEXT_SHOTS_TAG ?? "shot";
const ZOOMS = (process.env.TEXT_SHOTS_ZOOMS ?? "103,112,61").split(",").map(Number);
const DPR = Number(process.env.TEXT_SHOTS_DPR ?? 2);
const CANVAS = "text-shots";
const W = 1200;
const H = 800;
/** Where the stage's origin is put on screen: right of the side panel, above the message box. */
const ORIGIN = { x: 732, y: 340 };

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((done) => setTimeout(done, 150));
	}
};

// The words: a block 560 × 300 round the origin.
const latin = "The agent keeps a value for each square, 0.75 → 1.00.";
const chinese = "智能体为每个格子记住一个值，然后走向更大的那个。";
const children = [
	{ type: "text", id: "l12", x: -280, y: -150, content: latin, fontSize: 12, fill: "#e5e7eb", textGrowth: "fixed-width", width: 560 },
	{ type: "text", id: "l16", x: -280, y: -128, content: latin, fontSize: 16, fill: "#e5e7eb", textGrowth: "fixed-width", width: 560 },
	{ type: "text", id: "c14", x: -280, y: -100, content: chinese, fontSize: 14, fill: "#e5e7eb", textGrowth: "fixed-width", width: 560 },
	{ type: "text", id: "c20", x: -280, y: -74, content: chinese, fontSize: 20, fill: "#e5e7eb", textGrowth: "fixed-width", width: 560 },
	{ type: "note", id: "n1", x: -280, y: -30, width: 270, metadata: { type: "decks.markdown" }, content: "**Value** for each square, then the larger one: 1, 2, 3." },
	{ type: "note", id: "n2", x: 10, y: -30, width: 270, metadata: { type: "decks.markdown" }, content: "**价值** 每个格子一个值，走向更大的那个：一、二、三。" },
];

const deck = await deckState();
const folder = join(deck.path, "canvases", CANVAS);
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "canvas.json"), `${JSON.stringify({ title: CANVAS })}\n`);
writeFileSync(join(folder, "canvas.pen"), JSON.stringify({ version: "2.14", children }));

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
link.send({ type: "agent.stage", id: agentId, stage: CANVAS });
setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1500);
const on = await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === CANVAS), 20000);
say("the agent is on the text canvas", !!on);

const { browser, page } = await open({ width: W, height: H, dpr: DPR, cards: false });
// The stage and its engine are in the canvas frame.
const canvas = await canvasFrame(page);
await canvas.waitForFunction(() => (globalThis.__decksRust?.placed?.size ?? 0) >= 6, null, { timeout: 30000 });
await canvas.waitForFunction(() => globalThis.__decksSheet?.sharpAt !== undefined, null, { timeout: 30000 }).catch(() => {});

const quiet = () =>
	canvas.evaluate(async () => {
		let last = -1;
		let at = performance.now();
		const t0 = at;
		while (performance.now() - t0 < 20000) {
			await new Promise((done) => setTimeout(done, 100));
			const n = globalThis.__decksSheet?.tiles ?? 0;
			if (n !== last || document.querySelector(".stage")?.dataset.moving === "true") {
				last = n;
				at = performance.now();
			} else if (performance.now() - at >= 1500) return;
		}
	});

/** Pinch to `zoom` (64 scroll units per e-fold, as `render-perf.mjs`), then put the origin at `ORIGIN`. */
const show = (zoom) =>
	canvas.evaluate(
		async ({ zoom, W, H, ORIGIN }) => {
			const stage = document.querySelector(".stage");
			const r = stage.getBoundingClientRect();
			const wheel = (deltaX, deltaY, ctrlKey) => stage.dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
			const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
			for (let i = 0; i < 200; i++) {
				const ln = Math.log(zoom / globalThis.__decksRust.camera.zoom);
				if (Math.abs(ln) < 1e-6) break;
				wheel(0, -64 * Math.max(-Math.log(1.29), Math.min(Math.log(1.29), ln)), true);
				await raf();
			}
			for (let i = 0; i < 20; i++) {
				const c = globalThis.__decksRust.camera;
				// The camera is the stage point in the middle of the window; the origin goes to ORIGIN.
				const dx = (-(ORIGIN.x - r.width / 2) / c.zoom - c.x) * c.zoom;
				const dy = (-(ORIGIN.y - r.height / 2) / c.zoom - c.y) * c.zoom;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
				wheel(dx, dy, false);
				await raf();
				await raf();
			}
			return { ...globalThis.__decksRust.camera, W, H };
		},
		{ zoom, W, H, ORIGIN },
	);

if (DIR) mkdirSync(DIR, { recursive: true });
for (const z of ZOOMS) {
	const camera = await show(z / 100);
	await quiet();
	const box = await canvas.evaluate(() => {
		const r = document.querySelector(".stage").getBoundingClientRect();
		return { x: r.left, y: r.top, width: r.width, height: r.height };
	});
	// The words' block on screen, with a margin.
	const k = camera.zoom;
	const clip = { x: box.x + ORIGIN.x - 300 * k, y: box.y + ORIGIN.y - 160 * k, width: 600 * k, height: 250 * k };
	const png = await page.screenshot({ clip });
	if (DIR) writeFileSync(join(DIR, `${TAG}-${z}.png`), png);
	say(`words shot at ${z}%`, png.length > 1000, `zoom ${camera.zoom.toFixed(4)}, ${png.length} bytes`);
}
await browser.close();
link.close?.();
