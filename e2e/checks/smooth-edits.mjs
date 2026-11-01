/**
 * Every change of place glides, whoever made it: an agent's `canvas.move` of a note is drawn from where
 * the note was, catching up frame by frame (Pen's exponential smoothing, `camera/glide.ts`), never
 * jumping; an inserted note rises in; a moved card's awake slot glides with its picture.
 */
import { API, asPerson, canvasFrame, card, open, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	const frame = await canvasFrame(page);
	await rest(page);
	/** Sample what glides every frame for `ms`: each frame's shifts, as the engine reports them. */
	const sample = (ms) =>
		frame.evaluate(
			(ms) =>
				new Promise((done) => {
					const frames = [];
					const started = performance.now();
					const tick = () => {
						frames.push({ t: Math.round(performance.now() - started), shifts: typeof __decksGlide === "function" ? __decksGlide() : [] });
						if (performance.now() - started < ms) requestAnimationFrame(tick);
						else done(frames);
					};
					requestAnimationFrame(tick);
				}),
			ms,
		);

	// A note put on the canvas by an agent's call rises in: its shift starts low and transparent and decays.
	const made = await call("canvas.insert", [{ type: "note", content: "glide me", width: 240 }, { at: { x1: 100, y1: 100 } }]);
	say("a note is inserted", made.ok === true, JSON.stringify(made.error ?? ""));
	const id = made.value?.id;
	const rising = await sample(800);
	const seen = rising.filter((f) => f.shifts.some(([one]) => one === id));
	const first = seen[0]?.shifts.find(([one]) => one === id)?.[1];
	say("the inserted note starts low and transparent", !!first && first.dy > 10 && first.fade !== undefined && first.fade > 0.5, JSON.stringify(first));
	say("…and is in place and opaque within 800 ms (a fade takes about 600)", rising.at(-1).shifts.every(([one]) => one !== id), JSON.stringify(rising.at(-1).shifts).slice(0, 120));

	// Moved by 400 px: the shift starts near −400 and shrinks every frame, with no frame moving it more than 30% of what was left.
	const movedCall = call("canvas.move", [id, { at: { x1: 500, y1: 100 } }]);
	const moving = await sample(500);
	await movedCall;
	const path = moving.map((f) => f.shifts.find(([one]) => one === id)?.[1]?.dx).filter((dx) => dx !== undefined && dx !== 0);
	say("the moved note is drawn from where it was, shrinking frame by frame", path.length >= 4 && path[0] < -300 && path.every((dx, i) => i === 0 || Math.abs(dx) <= Math.abs(path[i - 1])), `${path.length} frames: ${path.slice(0, 8).map((n) => Math.round(n)).join(", ")}`);
	const biggestStep = path.reduce((most, dx, i) => (i === 0 ? most : Math.max(most, Math.abs(path[i - 1]) - Math.abs(dx))), 0);
	say("…in steps no bigger than a frame of the glide", biggestStep < 400 * 0.5, `biggest step ${Math.round(biggestStep)} px`);
	say("…and settles", moving.at(-1).shifts.every(([one]) => one !== id), "");

	// A card moved by an agent: its awake slot and its picture go with the glide.
	await selectCard(page, card("plan"));
	await settle(page, 400);
	const planId = await frame.evaluate((path) => [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === path)?.closest(".card-slot")?.dataset.id ?? null, card("plan"));
	const read = await call("canvas.read", [{ depth: 0 }]);
	const plan = (read.value?.items ?? []).find((one) => String(one.card ?? one.board ?? "").endsWith("cards/plan/index.html"));
	say("the plan card is on the canvas", !!plan, JSON.stringify(read.value?.items?.slice(0, 2) ?? read.error).slice(0, 160));
	if (plan) {
		const from = plan.box;
		const slotShifts = frame.evaluate(
			(path) =>
				new Promise((done) => {
					const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === path);
					const seen = [];
					const started = performance.now();
					const tick = () => {
						const m = node ? getComputedStyle(node.parentElement?.classList.contains("card-slot") ? node : node).transform : "";
						seen.push(m);
						if (performance.now() - started < 500) requestAnimationFrame(tick);
						else done(seen);
					};
					requestAnimationFrame(tick);
				}),
			card("plan"),
		);
		const moved = await call("canvas.move", [plan.id ?? card("plan"), { at: { x1: from.x1 + 300, y1: from.y1 } }]);
		const transforms = await slotShifts;
		const distinct = [...new Set(transforms)].filter((t) => t && t !== "none");
		say("the moved card's slot glides: several in-between transforms, not one jump", moved.ok === true && distinct.length >= 3, `${distinct.length} distinct transforms; ${JSON.stringify(moved.error ?? "")}`);
	}
	// What a glide costs: the engine's time per frame and the gaps between frames, for one note and for forty notes moved at once.
	const measure = async (ms) => {
		await frame.evaluate(() => { globalThis.__decksGlideCost = []; });
		const frames = await sample(ms);
		const cost = await frame.evaluate(() => globalThis.__decksGlideCost ?? []);
		const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
		const p = (list, q) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; };
		return { frames: cost.length, costP50: p(cost, 0.5), costP95: p(cost, 0.95), costMax: Math.max(0, ...cost), gapP95: p(gaps, 0.95), gapMax: Math.max(0, ...gaps) };
	};
	const oneMove = call("canvas.move", [id, { at: { x1: 100, y1: 100 } }]);
	const one = await measure(400);
	await oneMove;
	say("one note's glide costs the main thread under 3 ms a frame at the 95th percentile", one.frames >= 4 && one.costP95 < 3, JSON.stringify(one));
	const ops = [...Array(40)].map((_, i) => ({ op: "insert", node: { type: "note", id: `g${i}`, content: `note ${i}`, width: 160 }, box: { x1: 1200 + (i % 8) * 180, y1: 900 + Math.floor(i / 8) * 120 } }));
	const many = await call("canvas.batch", [ops]);
	say("forty notes are inserted at once", many.ok === true, JSON.stringify(many.error ?? ""));
	await sample(800);
	const moveAll = call("canvas.batch", [[...Array(40)].map((_, i) => ({ op: "move", id: `g${i}`, at: { x1: 1200 + (i % 8) * 180 + 300, y1: 900 + Math.floor(i / 8) * 120 } }))]);
	const forty = await measure(500);
	await moveAll;
	say("forty notes gliding at once cost under 8 ms a frame at the 95th percentile, with no frame gap over 40 ms", forty.frames >= 4 && forty.costP95 < 8 && forty.gapMax < 40, JSON.stringify(forty));
	say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
	await browser.close();
}
