/**
 * A long stroke on the stage: drawn as it grows, it is the stroke shaped whole, and its frames cost
 * no more at its end than at its start.
 *
 * The stroke under the pen is shaped as it grows (`inkShaper`, `@decks/ink`; `StageInk.tsx`),
 * only its new points and its end each frame; `globalThis.__inkWhole` shapes it whole every frame,
 * as before. This draws the same strokes both ways in one page, alternating — a mouse's (a line of
 * one width) and a pencil's (an outline, its pressure moving), 600 and 2,000 points, four samples a
 * frame as a fast pencil gives them — and asks:
 *
 * - the path on the glass is the same text both ways, at the start, halfway and at the end;
 * - the stroke the file gets is the same point list both ways;
 * - shaped as it grows, a frame at the end of a 2,000-point stroke costs the page less than shaped
 *   whole (main-thread time, CDP `TaskDuration`, over the first and the last 30 frames).
 *
 * The pointer events are dispatched in the canvas frame (one `pointermove` a sample), so the times are
 * the stage's and not the harness's; they are the frame's own thread's when it runs in a process of its
 * own (a sandboxed frame may), else the page's. `INK_ROUNDS` (1) pairs are drawn for each kind and length; the
 * times are printed (and written to `INK_OUT`, when set), each the median over the rounds.
 */
import { writeFileSync } from "node:fs";
import { canvasFrame, open, rest, resetStage, say, socket } from "../harness.mjs";

const ROUNDS = Math.max(1, Number(process.env.INK_ROUNDS ?? 1));
const PER_FRAME = 4;
const TIMED = 30;

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const median = (values) => {
	const s = [...values].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r2 = (n) => Math.round(n * 100) / 100;

await resetStage();
const { browser, page, context, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const canvas = await canvasFrame(page);
// The frame's own session when it is out of the page's process, else the page's, which then holds it.
const cdp = await context.newCDPSession(canvas).catch(() => context.newCDPSession(page));
await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
const taskMs = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value * 1000;

await canvas.click('.v3-tool[data-tool="pen"]');
await canvas.waitForSelector(".stage-ink");

await canvas.evaluate(() => {
	/*
	 * The stroke under the pen is drawn by the engine now (`props.layer.ink`, 540345fc), with no SVG
	 * path to read; `__inkOnSvg` puts it back on the glass as an `.ink-live` path, the same shape's
	 * text, which is what is compared here.
	 */
	globalThis.__inkOnSvg = true;
	const sheet = () => document.querySelector(".stage-ink");
	let state;
	const send = (type, x, y, pressure) =>
		sheet().dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: state.pen ? "pen" : "mouse", isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, pressure, clientX: x, clientY: y, bubbles: true, composed: true }));
	const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
	/** The live path on the glass: the newest one, the stroke under the pen. */
	const live = () => [...document.querySelectorAll(".ink-live")].at(-1)?.getAttribute("d") ?? "";
	const at = (i) => {
		const t = i / 240;
		const r = sheet().getBoundingClientRect();
		return { x: r.x + r.width / 2 + Math.sin(t * 1.3) * 420, y: r.y + r.height / 2 + Math.sin(t * 2.1) * 260, p: state.pen ? 0.45 + 0.3 * Math.sin(i / 17) : 0.5 };
	};
	globalThis.__ink = {
		down(pen) {
			state = { pen, i: 0 };
			const p = at(0);
			send("pointerdown", p.x, p.y, p.p);
		},
		/** `frames` frames, `perFrame` samples each; the live path after the last. */
		async moves(frames, perFrame) {
			for (let f = 0; f < frames; f++) {
				await raf();
				for (let k = 0; k < perFrame; k++) {
					const p = at(++state.i);
					send("pointermove", p.x, p.y, p.p);
				}
			}
			await raf();
			await raf();
			return live();
		},
		up() {
			const p = at(state.i);
			send("pointerup", p.x, p.y, 0);
		},
	};
});

const inks = () => canvas.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => p.node?.metadata?.type === "decks.ink").map((p) => ({ id: p.node.id, points: p.node.metadata.points })));

/** One stroke of `points` points, shaped whole (`whole`) or as it grows: its paths, its frame times, and what the file got. */
const stroke = async ({ pen, points, whole }) => {
	await canvas.evaluate((whole) => (globalThis.__inkWhole = whole), whole);
	const had = new Set((await inks()).map((ink) => ink.id));
	const frames = Math.round(points / PER_FRAME);
	await canvas.evaluate((pen) => globalThis.__ink.down(pen), pen);
	let t = await taskMs();
	const atStart = await canvas.evaluate(({ n, k }) => globalThis.__ink.moves(n, k), { n: TIMED, k: PER_FRAME });
	const startMs = ((await taskMs()) - t) / (TIMED + 2);
	const half = Math.round(frames / 2) - TIMED;
	const atHalf = await canvas.evaluate(({ n, k }) => globalThis.__ink.moves(n, k), { n: half, k: PER_FRAME });
	await canvas.evaluate(({ n, k }) => globalThis.__ink.moves(n, k), { n: frames - 2 * TIMED - half, k: PER_FRAME });
	t = await taskMs();
	const atEnd = await canvas.evaluate(({ n, k }) => globalThis.__ink.moves(n, k), { n: TIMED, k: PER_FRAME });
	const endMs = ((await taskMs()) - t) / (TIMED + 2);
	await canvas.evaluate(() => globalThis.__ink.up());
	const made = await until(async () => (await inks()).find((ink) => !had.has(ink.id)), 8000);
	// Off the canvas again, so every stroke is drawn over the same drawing.
	if (made) {
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: made.id }] });
		await until(async () => !(await inks()).some((ink) => ink.id === made.id), 8000);
	}
	await page.waitForTimeout(300);
	return { paths: [atStart, atHalf, atEnd], startMs, endMs, points: made?.points };
};

const report = {};
for (const pen of [false, true]) {
	for (const points of [600, 2000]) {
		const name = `${pen ? "pencil" : "mouse"} ${points}`;
		const times = { whole: { start: [], end: [] }, grown: { start: [], end: [] } };
		let same = true;
		let sameFile = true;
		let detail = "";
		for (let round = 0; round < ROUNDS; round++) {
			const pair = {};
			for (const whole of round % 2 ? [true, false] : [false, true]) {
				const one = await stroke({ pen, points, whole });
				pair[whole ? "whole" : "grown"] = one;
				times[whole ? "whole" : "grown"].start.push(one.startMs);
				times[whole ? "whole" : "grown"].end.push(one.endMs);
			}
			const { whole, grown } = pair;
			for (let i = 0; i < 3; i++) {
				if (whole.paths[i] !== grown.paths[i] || !whole.paths[i]) {
					same = false;
					detail ||= `${["start", "half", "end"][i]}: ${whole.paths[i].length} vs ${grown.paths[i].length} characters`;
				}
			}
			if (!whole.points || JSON.stringify(whole.points) !== JSON.stringify(grown.points)) sameFile = false;
		}
		say(`${name}: the path drawn as the stroke grows is the one shaped whole, at its start, halfway and end`, same, detail || `${ROUNDS} pair(s)`);
		say(`${name}: the file gets the same stroke either way`, sameFile);
		report[name] = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, { startMs: r2(median(v.start)), endMs: r2(median(v.end)) }]));
		console.log(`  ${name}: ${JSON.stringify(report[name])}`);
	}
}
const long = report["pencil 2000"];
say("a frame at the end of a 2,000-point pencil stroke costs less shaped as it grows than shaped whole", long.grown.endMs < long.whole.endMs, JSON.stringify(long));
console.log(`INK ${JSON.stringify(report)}`);
if (process.env.INK_OUT) writeFileSync(process.env.INK_OUT, `${JSON.stringify(report, null, "\t")}\n`);
say("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
