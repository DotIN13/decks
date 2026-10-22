/**
 * What the stage costs, on a big canvas: ten numbers, each the median of `RENDER_PERF_RUNS` (5) runs
 * (9 for the two per-frame times, see `WIDE`).
 *
 * Not a pass/fail check: it measures, and says only that each number could be measured. The canvas
 * is `perf` (`e2e/perf-canvas.mjs`: 2,000 items and 100 boards), written into this check's deck.
 * Run it with `node scripts/render-perf.mjs`, which prints the numbers as one JSON object.
 *
 * - tilesAtLoad, firstSharpMs: the page opened afresh on the canvas, each run; tiles painted until
 *   none have come for 2 s, and the first sharp frame (`sharpAt`, `stage/engine.ts`).
 * - tilesAfterZoom: at rest at 100% on a busy cell, one pinch step of 3% (then 3% again from there,
 *   for each run, so no run finds the last one's tiles kept), tiles painted until quiet.
 * - zoomDraws: page draws per frame over 40 frames of pinch, one CDP wheel event (⌃ held) a frame.
 * - panFrameMs: main-thread time (CDP `TaskDuration`) per frame over 240 frames of two-finger pan at 50%.
 * - dragStepMs: main-thread time per step of a note dragged (browse mode moves the drawing) at 50%, one pointer move a
 *   frame (CDP mouse events), the first five steps left out.
 * - editToFrameMs: an agent's insert (`stage.pen.edit` over the wire) to the first frame drawn with
 *   a tile painted after the note is in the layout.
 * - strokeEndMs: main-thread time per frame over the last 60 of 600 pointer moves (10 s at 60 Hz) of a
 *   pen stroke, one CDP mouse move a frame.
 * - imageLoadMs: main-thread time while 24 image fills arrive and are painted (see "image fills arriving").
 * - fillAfterPanMs: the end of a fast pan at 50% onto drawing not yet painted to the first frame with
 *   every tile of the window there at its resting scale (see "a fast pan filled in").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WEB, deckState, open, say, socket } from "../harness.mjs";
import { PERF_CANVAS, writePerfCanvas } from "../perf-canvas.mjs";

const RUNS = Math.max(1, Number(process.env.RENDER_PERF_RUNS ?? 5));
/** Only these measures (`RENDER_PERF_ONLY=drag,edit`), and a canvas of this many items (`RENDER_PERF_ITEMS`, 2,000). */
const ONLY = process.env.RENDER_PERF_ONLY ? new Set(process.env.RENDER_PERF_ONLY.split(",")) : undefined;
const want = (name) => !ONLY || ONLY.has(name);
const ITEMS = Number(process.env.RENDER_PERF_ITEMS ?? 2000);
/** CPU profiles of the drags, the edits and the pictures (`RENDER_PERF_PROFILE=<prefix>`: `<prefix>.drag.cpuprofile`, `<prefix>.edit.cpuprofile`, `<prefix>.images.cpuprofile`), for finding where the time goes. */
const PROFILE = process.env.RENDER_PERF_PROFILE;
/** A page flag to measure with and without, alternating (`RENDER_PERF_AB=<name>`, see the drag and the edit). */
const AB = process.env.RENDER_PERF_AB;
/**
 * Font files served this many ms late (`RENDER_PERF_FONT_MS=400`): a first visit, with fonts not yet
 * in the browser's cache, for the open-to-rest numbers. Each file is fetched once and kept.
 */
const FONT_MS = Number(process.env.RENDER_PERF_FONT_MS ?? 0);
/*
 * The two main-thread times per frame are about a millisecond, and on a Mac other work shares, a run
 * wanders by more than 10%: they take a run first that is not counted (it paints what the rest find
 * painted), then 2 × RUNS − 1 runs.
 */
const WIDE = RUNS * 2 - 1;
const OUT = process.env.RENDER_PERF_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.cache/decks-e2e/render-perf.json");
const W = 1500;
const H = 950;
const DPR = 2;

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((done) => setTimeout(done, 150));
	}
};
const median = (values) => {
	const s = [...values].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ms = (v) => Math.round(v * 10) / 10;
/** A `width` by `height` PNG of soft colour bands and a checker, the same every time. */
const perfPicture = (width, height) => {
	const rows = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width * 3 + 1);
		for (let x = 0; x < width; x++) {
			const checker = ((x >> 5) + (y >> 5)) % 2 ? 24 : 0;
			rows[row + 1 + x * 3] = (x * 255) / width;
			rows[row + 2 + x * 3] = (y * 255) / height;
			rows[row + 3 + x * 3] = 128 + checker;
		}
	}
	const chunk = (type, data) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(data.length);
		head.write(type, 4, "latin1");
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
		return Buffer.concat([head, data, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
};

// --- the canvas, and the agent on it ------------------------------------------------------------------
const deck = await deckState();
const made = writePerfCanvas(deck.path, { items: ITEMS });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);
link.send({ type: "agent.stage", id: agentId, stage: PERF_CANVAS });
// Asked for as well: an agent already on the canvas is sent nothing new.
setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1500);
const onPerf = await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === PERF_CANVAS && m.doc.children.length >= Math.min(1000, ITEMS / 2)), 20000);
say("the agent is on the perf canvas", !!onPerf, `${made.items} items, ${made.boards} boards`);

const { browser, page, context, errors } = await open({ width: W, height: H, dpr: DPR, boards: false });
const cdp = await context.newCDPSession(page);
if (FONT_MS > 0) {
	const kept = new Map();
	await context.route(/\.ttf(\?|$)/, async (route) => {
		const url = route.request().url();
		if (!kept.has(url)) {
			const response = await route.fetch();
			kept.set(url, { status: response.status(), body: await response.body() });
		}
		await new Promise((done) => setTimeout(done, FONT_MS));
		const { status, body } = kept.get(url);
		await route.fulfill({ status, body, headers: { "content-type": "font/ttf", "access-control-allow-origin": "*", "cache-control": "no-store" } });
	});
}
await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
const taskSeconds = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;

/** Until no tile has come for `quietMs` and the camera is still; false if that never happened within `cap`. */
const quiet = (quietMs = 1500, cap = 30000) =>
	page.evaluate(
		async ({ quietMs, cap }) => {
			const t0 = performance.now();
			let last = globalThis.__decksSheet?.tiles ?? 0;
			let at = performance.now();
			while (performance.now() - t0 < cap) {
				await new Promise((done) => setTimeout(done, 100));
				const n = globalThis.__decksSheet?.tiles ?? 0;
				const d = document.querySelector(".stage")?.dataset;
				if (n !== last || d?.moving === "true" || d?.gliding === "true") {
					last = n;
					at = performance.now();
				} else if (performance.now() - at >= quietMs) return true;
			}
			return false;
		},
		{ quietMs, cap },
	);
const profileStart = async () => {
	if (!PROFILE) return;
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
	await cdp.send("Profiler.start");
};
const profileStop = async (name) => {
	if (PROFILE) writeFileSync(`${PROFILE}.${name}.cpuprofile`, JSON.stringify((await cdp.send("Profiler.stop")).profile));
};
const frame = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));

/** Put helpers in the page: the camera, wheel events on the stage, one a frame. */
const helpers = () =>
	page.evaluate(() => {
		const stage = () => document.querySelector(".stage");
		const centre = () => {
			const r = stage().getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		};
		const wheel = (deltaX, deltaY, ctrlKey) => {
			const c = centre();
			stage().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: c.x, clientY: c.y, bubbles: true, cancelable: true }));
		};
		const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
		globalThis.__perf = {
			camera: () => ({ ...globalThis.__decksRust.camera }),
			wheel,
			raf,
			/** Pinch to `zoom` exactly: 64 scroll units per e-fold (`Stage.tsx`, `PINCH_TRAVEL`), at most ×1.3 a step. */
			async zoomTo(zoom) {
				for (let i = 0; i < 200; i++) {
					const now = globalThis.__decksRust.camera.zoom;
					const ln = Math.log(zoom / now);
					if (Math.abs(ln) < 1e-6) return;
					wheel(0, -64 * Math.max(-Math.log(1.29), Math.min(Math.log(1.29), ln)), true);
					await raf();
				}
			},
			async panTo(x, y) {
				for (let i = 0; i < 20; i++) {
					const c = globalThis.__decksRust.camera;
					const dx = (x - c.x) * c.zoom;
					const dy = (y - c.y) * c.zoom;
					if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
					wheel(dx, dy, false);
					await raf();
					await raf();
				}
			},
			/** `frames` frames of wheel events, one each, going back the other way halfway. */
			async loop(frames, dx, dy, ctrlKey) {
				for (let i = 0; i < frames; i++) {
					const back = i >= frames / 2 ? -1 : 1;
					wheel(dx * back, dy * back, ctrlKey);
					await raf();
				}
			},
		};
	});

const result = { runs: {} };
const keep = (key, values, round) => {
	result.runs[key] = values.map(round);
	result[key] = round(median(values));
	say(`${key} measured`, values.length >= RUNS && values.every(Number.isFinite), JSON.stringify(result.runs[key]));
};

// --- open to rest: tiles painted, and the first sharp frame -------------------------------------------
{
	const tiles = [];
	const sharp = [];
	// One open more than the runs, the first left out: it compiles the engine and lays the canvas
	// out for the first time, which no later open of the page does.
	for (let run = -1; run < (want("load") ? RUNS : 0); run++) {
		if (run > -1) await page.goto(`${WEB}/`, { waitUntil: "load" });
		await page.waitForFunction((n) => (globalThis.__decksRust?.placed?.size ?? 0) >= n, Math.min(1000, ITEMS / 2), { timeout: 30000 });
		await page.waitForFunction(() => globalThis.__decksSheet?.sharpAt !== undefined, null, { timeout: 30000 }).catch(() => {});
		await quiet(2000, 40000);
		const stats = await page.evaluate(() => ({ tiles: globalThis.__decksSheet.tiles, sharpAt: globalThis.__decksSheet.sharpAt }));
		if (run < 0) continue;
		tiles.push(stats.tiles);
		sharp.push(stats.sharpAt ?? NaN);
	}
	if (want("load")) {
		keep("tilesAtLoad", tiles, Math.round);
		keep("firstSharpMs", sharp, ms);
	}
}

await helpers();
// Where the canvas opens: the corner of cells 44, 45, 54 and 55.
const HOME = { x: 0, y: 0 };
await page.mouse.move(W / 2, H / 2);
await page.evaluate(({ x, y }) => globalThis.__perf.panTo(x, y), HOME);
await page.evaluate(() => globalThis.__perf.zoomTo(1));
await quiet();

// --- a small zoom: 100% → 103%, and 3% on from there for each run -------------------------------------
if (want("zoom")) {
	const tiles = [];
	for (let run = 0; run < RUNS; run++) {
		const before = await page.evaluate(() => globalThis.__decksSheet.tiles);
		await page.evaluate(() => globalThis.__perf.wheel(0, -64 * Math.log(1.03), true));
		await quiet(1500);
		tiles.push((await page.evaluate(() => globalThis.__decksSheet.tiles)) - before);
	}
	keep("tilesAfterZoom", tiles, Math.round);
}

// --- page draws per zoom frame ------------------------------------------------------------------------
if (want("draws")) {
	const draws = [];
	const FRAMES = 40;
	for (let run = 0; run < RUNS; run++) {
		const before = await page.evaluate(() => globalThis.__decksSheet.shown);
		// Real wheel input (CDP), ⌃ held as a pinch has it, one event a frame.
		for (let i = 0; i < FRAMES; i++) {
			await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: W / 2, y: H / 2, deltaX: 0, deltaY: i < FRAMES / 2 ? -2 : 2, modifiers: 2 });
			await frame();
		}
		draws.push(((await page.evaluate(() => globalThis.__decksSheet.shown)) - before) / FRAMES);
		await quiet(800);
	}
	// A ratio, not a count: to 0.1.
	keep("zoomDraws", draws, ms);
}

// --- a fast pan filled in -----------------------------------------------------------------------------
/*
 * From the end of a fast pan at 50% (a fling: 3 frames of 1,500 px, each a window onto drawing not yet
 * painted, along a row of cells of its own each run) to the first frame drawn with no tile of the
 * window missing or at another scale than at rest (`settledAt`, `stage/engine.ts`). A slower pan is
 * filled as it goes: the worker paints a tile in about half a millisecond.
 */
if (want("fill")) {
	await page.evaluate(() => globalThis.__perf.zoomTo(0.5));
	const fill = [];
	for (let run = -1; run < RUNS; run++) {
		await page.evaluate(({ x, y }) => globalThis.__perf.panTo(x, y), { x: -6400, y: -5000 + (run + 1) * 2000 });
		await quiet(1500);
		const t = await page.evaluate(async () => {
			const p = globalThis.__perf;
			let end = 0;
			for (let i = 0; i < 3; i++) {
				p.wheel(1500, 0, false);
				end = performance.now();
				await p.raf();
			}
			while (performance.now() < end + 10000) {
				const settled = globalThis.__decksSheet?.settledAt ?? 0;
				if (settled > end) return settled - end;
				await new Promise((done) => setTimeout(done, 4));
			}
			return NaN;
		});
		if (run >= 0) fill.push(t);
		await quiet(1000);
	}
	keep("fillAfterPanMs", fill, ms);
}

// --- main-thread time per pan frame at 50% ------------------------------------------------------------
if (want("pan")) {
	await page.evaluate(() => globalThis.__perf.zoomTo(0.5));
	await quiet();
	const per = [];
	const FRAMES = 240;
	for (let run = -1; run < WIDE; run++) {
		const before = await taskSeconds();
		await page.evaluate((frames) => globalThis.__perf.loop(frames, 12, 5, false), FRAMES);
		if (run >= 0) per.push(((await taskSeconds()) - before) * 1000 / FRAMES);
		await quiet(1000);
	}
	keep("panFrameMs", per, ms);
}

// --- main-thread time per drag step -------------------------------------------------------------------
if (want("drag")) {
	await page.evaluate(() => globalThis.__perf.zoomTo(0.5));
	await page.evaluate(({ x, y }) => globalThis.__perf.panTo(x, y), HOME);
	await quiet();
	// Top-level notes whole on screen, clear of the side panel, the toolbars and the composer, pressed
	// where no board is. A press that lifts nothing (another item over the note) is let go and the next
	// note tried; only drags that lifted their note are timed.
	const notes = await page.evaluate(({ W, H }) => {
		const out = [];
		for (const [id, placed] of globalThis.__decksRust.placed) {
			if (placed.node.type !== "note" || placed.parent) continue;
			const r = globalThis.__decksPenBox?.(id);
			if (!r || r.left < 330 || r.top < 70 || r.right > W - 20 || r.bottom > H - 150) continue;
			const at = { x: r.left + r.width / 2, y: r.top + Math.min(20, r.height / 2) };
			if (globalThis.__decksPictureAt?.(at.x, at.y)) continue;
			out.push({ id, ...at });
		}
		return out;
	}, { W, H });
	say("there are notes on screen to drag", notes.length >= RUNS, `${notes.length}`);
	const per = [];
	let tried = 0;
	const STEPS = 60;
	await profileStart();
	/** Drag a note 60 steps, one a frame: main-thread ms per step after the first five, or undefined when the press lifted nothing. */
	const dragOnce = async ({ x, y }) => {
		await page.mouse.move(x, y);
		await frame();
		await page.mouse.down();
		let before = 0;
		let held = true;
		for (let s = 1; s <= STEPS; s++) {
			if (s === 6) {
				held = await page.evaluate(() => globalThis.__decksRust.lifted.size > 0);
				if (!held) break;
				before = await taskSeconds();
			}
			await page.mouse.move(x + s * 3, y + s * 1.5);
			await frame();
		}
		const step = held ? ((await taskSeconds()) - before) * 1000 / (STEPS - 5) : undefined;
		await page.mouse.up();
		await until(async () => (await page.evaluate(() => globalThis.__decksRust.lifted.size)) === 0, 5000);
		await page.keyboard.press("Escape");
		await quiet(1000);
		return step;
	};
	for (const note of notes) {
		if (per.length >= RUNS) break;
		tried++;
		const step = await dragOnce(note);
		if (step !== undefined) per.push(step);
	}
	await profileStop("drag");
	say("drags lifted their note", per.length === RUNS, `${per.length} timed of ${tried} tried`);
	keep("dragStepMs", per, ms);
	/*
	 * `RENDER_PERF_AB=<name>`: the same drags again with `globalThis[name]` set and not, alternating in
	 * this one page (each note dragged once each way, which goes first taking turns), for a change
	 * that keeps its old way behind that flag while it is proved. The note is found where the last drag left it.
	 */
	if (AB) {
		const on = [];
		const off = [];
		for (const [at, { id }] of notes.entries()) {
			if (on.length >= WIDE && off.length >= WIDE) break;
			for (const flag of at % 2 ? [true, false] : [false, true]) {
				await page.evaluate(({ AB, flag }) => (globalThis[AB] = flag), { AB, flag });
				const r = await page.evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id);
				const step = r ? await dragOnce({ x: r.x + r.width / 2, y: r.y + Math.min(20, r.height / 2) }) : undefined;
				if (step !== undefined) (flag ? on : off).push(step);
			}
		}
		await page.evaluate((AB) => delete globalThis[AB], AB);
		keep("dragStepMsFlagOn", on, ms);
		keep("dragStepMsFlagOff", off, ms);
	}
	await page.keyboard.press("Escape");
	await quiet(800);
}

// --- an agent's edit to the frame that shows it -------------------------------------------------------
if (want("edit")) {
	await page.evaluate(() => {
		const engine = globalThis.__decksRust;
		const before = engine.presented;
		globalThis.__perfPresented = [];
		engine.presented = () => {
			before?.();
			for (const f of globalThis.__perfPresented) f();
		};
		// When the drawing with the edit reaches the stage's engine: the server's part of the time.
		const setDoc = engine.setDoc.bind(engine);
		engine.setDoc = (...args) => {
			globalThis.__perfDocAt = Date.now();
			// The tiles in when the drawing came: a frame with more shows the edit. Taken here, not at the
			// first frame after it, which since the page draws once a frame may already have taken them.
			globalThis.__perfTilesAtDoc = globalThis.__decksSheet.tiles;
			return setDoc(...args);
		};
	});
	/** An agent's insert, `n`th: ms from sending it to the frame that shows it, and the page's main-thread ms in between. */
	const editOnce = async (n) => {
		const id = `perf-edit-${n}`;
		const cam = await page.evaluate(() => globalThis.__perf.camera());
		const seen = page.evaluate(
			(id) =>
				new Promise((done) => {
					const engine = globalThis.__decksRust;
					const check = () => {
						if (!engine.placed.has(id)) return;
						if (globalThis.__decksSheet.tiles > globalThis.__perfTilesAtDoc) {
							globalThis.__perfPresented = globalThis.__perfPresented.filter((f) => f !== check);
							done(Date.now());
						}
					};
					globalThis.__perfPresented.push(check);
					setTimeout(() => done(NaN), 10000);
				}),
			id,
		);
		await frame();
		const before = await taskSeconds();
		const sent = Date.now();
		const x1 = Math.round(cam.x - 300 + (n % 5) * 130);
		const y1 = Math.round(cam.y + 150 + Math.floor(n / 5) * 40);
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id, metadata: { type: "decks.markdown" }, content: `An agent's note, number ${n}`, width: 120 }, box: { x1, y1 } }] });
		const at = await seen;
		const task = ((await taskSeconds()) - before) * 1000;
		const arrived = await page.evaluate(() => globalThis.__perfDocAt);
		await quiet(1000);
		return { ms: at - sent, task, server: arrived - sent };
	};
	const times = [];
	const tasks = [];
	const server = [];
	let made = 0;
	await profileStart();
	for (let run = 0; run < RUNS; run++) {
		const { ms: t, task, server: s } = await editOnce(made++);
		times.push(t);
		tasks.push(task);
		server.push(s);
	}
	await profileStop("edit");
	keep("editToFrameMs", times, ms);
	keep("editTaskMs", tasks, ms);
	keep("editServerMs", server, ms);
	if (AB) {
		const on = { ms: [], task: [] };
		const off = { ms: [], task: [] };
		for (let pair = 0; pair < WIDE; pair++) {
			for (const flag of pair % 2 ? [true, false] : [false, true]) {
				await page.evaluate(({ AB, flag }) => (globalThis[AB] = flag), { AB, flag });
				const { ms: t, task } = await editOnce(made++);
				(flag ? on : off).ms.push(t);
				(flag ? on : off).task.push(task);
			}
		}
		await page.evaluate((AB) => delete globalThis[AB], AB);
		keep("editToFrameMsFlagOn", on.ms, ms);
		keep("editToFrameMsFlagOff", off.ms, ms);
		keep("editTaskMsFlagOn", on.task, ms);
		keep("editTaskMsFlagOff", off.task, ms);
	}
}

// --- tiles painted after a change inside a frame -----------------------------------------------------
/*
 * Not one of the eight: the tiles the worker paints again when an agent changes one note's words inside
 * a big frame, at 50%. The frame (2,400 by 1,500, 24 notes placed where they say) is the agent's own,
 * put at the window's middle first: the perf canvas's columns are a tile or two big, too small to tell.
 */
if (want("frameEdit")) {
	await page.evaluate(() => globalThis.__perf.zoomTo(0.5));
	await page.evaluate(({ x, y }) => globalThis.__perf.panTo(x, y), HOME);
	const notes = Array.from({ length: 24 }, (_, i) => ({ type: "note", id: `perf-big-${i}`, metadata: { type: "decks.markdown" }, content: `Note ${i} in the big frame`, width: 220, x: 40 + (i % 6) * 390, y: 40 + Math.floor(i / 6) * 360 }));
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "frame", id: "perf-big", name: "Big frame", layout: "none", fill: "#f3f4f6", width: 2400, height: 1500, children: notes }, box: { x1: HOME.x - 1200, y1: HOME.y - 750 } }] });
	await until(() => page.evaluate(() => globalThis.__decksRust.placed.has("perf-big-23")), 10000);
	await quiet();
	const tiles = [];
	for (let run = 0; run < RUNS; run++) {
		const before = await page.evaluate(() => globalThis.__decksSheet.tiles);
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "update", id: "perf-big-8", set: { content: `Note 8, said again ${run}` } }] });
		await until(() => page.evaluate((run) => String(globalThis.__decksRust.placed.get("perf-big-8")?.node.content).endsWith(` ${run}`), run), 5000);
		await quiet(1000);
		tiles.push((await page.evaluate(() => globalThis.__decksSheet.tiles)) - before);
	}
	keep("frameEditTiles", tiles, Math.round);
}

// --- image fills arriving ----------------------------------------------------------------------------
/*
 * imageLoadMs: the page's main-thread time from an agent's insert of 24 rectangles filled with
 * pictures (each its own address, a 1600 by 1200 PNG) at 50% on the window to the stage at rest with
 * every picture in and painted. Each run's pictures are new to the page (the address's query differs),
 * and they are taken off again after it. With `RENDER_PERF_AB`, runs alternate with the flag set and not.
 */
if (want("images")) {
	const folder = join(deck.path, "canvases", PERF_CANVAS);
	writeFileSync(join(folder, "perf-picture.png"), perfPicture(1600, 1200));
	await page.evaluate(() => globalThis.__perf.zoomTo(0.5));
	await page.evaluate(({ x, y }) => globalThis.__perf.panTo(x, y), HOME);
	await quiet();
	const N = 24;
	let made = 0;
	let tilesPainted = [];
	const fillOnce = async () => {
		const run = made++;
		const ids = Array.from({ length: N }, (_, i) => `perf-picture-${run}-${i}`);
		const ops = ids.map((id, i) => ({ op: "insert", node: { type: "rectangle", id, width: 400, height: 300, fill: { type: "image", url: `perf-picture.png?run=${run}&n=${i}`, mode: "fill" } }, box: { x1: HOME.x - 1370 + (i % 6) * 460, y1: HOME.y - 690 + Math.floor(i / 6) * 350 } }));
		const had = await page.evaluate(() => globalThis.__decksEngine.stats().pictures);
		const tilesBefore = await page.evaluate(() => globalThis.__decksSheet.tiles);
		await frame();
		const before = await taskSeconds();
		link.send({ type: "stage.pen.edit", agentId, ops });
		const all = await until(() => page.evaluate((want) => globalThis.__decksEngine.stats().pictures >= want, had + N), 20000);
		await quiet(1000);
		const task = ((await taskSeconds()) - before) * 1000;
		tilesPainted.push((await page.evaluate(() => globalThis.__decksSheet.tiles)) - tilesBefore);
		link.send({ type: "stage.pen.edit", agentId, ops: ids.map((id) => ({ op: "delete", id })) });
		await until(() => page.evaluate((id) => !globalThis.__decksRust.placed.has(id), ids[0]), 10000);
		await quiet(1000);
		return all ? task : NaN;
	};
	await fillOnce();
	const tasks = [];
	tilesPainted = [];
	await profileStart();
	for (let run = 0; run < RUNS; run++) tasks.push(await fillOnce());
	await profileStop("images");
	keep("imageLoadMs", tasks, ms);
	// Not one of the numbers: the tiles painted while they came.
	keep("imageLoadTiles", tilesPainted, Math.round);
	if (AB) {
		const on = [];
		const off = [];
		for (let pair = 0; pair < RUNS; pair++) {
			for (const flag of pair % 2 ? [true, false] : [false, true]) {
				await page.evaluate(({ AB, flag }) => (globalThis[AB] = flag), { AB, flag });
				(flag ? on : off).push(await fillOnce());
			}
		}
		await page.evaluate((AB) => delete globalThis[AB], AB);
		keep("imageLoadMsFlagOn", on, ms);
		keep("imageLoadMsFlagOff", off, ms);
	}
}

// --- a long pen stroke --------------------------------------------------------------------------------
if (want("stroke")) {
	await page.locator('[aria-label="Draw on the canvas"]:visible').click();
	await page.waitForTimeout(300);
	const per = [];
	const inkBefore = await page.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => p.node?.metadata?.type === "decks.ink").length);
	// Ten seconds at 60 a second: 600 pointer moves, one a frame, the same path each run, so every
	// stroke has as many points however fast the frames come; the last 60 are timed.
	const STEPS = 600;
	const TIMED = 60;
	for (let run = -1; run < WIDE; run++) {
		const cx = W / 2;
		const cy = H / 2;
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		let before = 0;
		const frames = TIMED;
		for (let i = 1; i <= STEPS; i++) {
			if (i === STEPS - TIMED + 1) before = await taskSeconds();
			const t = i / 60;
			await page.mouse.move(cx + Math.sin(t * 1.3) * 420, cy + Math.sin(t * 2.1) * 260);
			await frame();
		}
		if (run >= 0) per.push(((await taskSeconds()) - before) * 1000 / frames);
		await page.mouse.up();
		await quiet(1500);
	}
	const inkAfter = await page.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => p.node?.metadata?.type === "decks.ink").length);
	say("each stroke was drawn as ink", inkAfter - inkBefore === per.length + 1, `${inkAfter - inkBefore} of ${per.length + 1}`);
	keep("strokeEndMs", per, ms);
	await page.keyboard.press("Escape");
}

say("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
const metrics = Object.fromEntries(["zoomDraws", "panFrameMs", "dragStepMs", "editToFrameMs", "tilesAfterZoom", "tilesAtLoad", "firstSharpMs", "strokeEndMs", "fillAfterPanMs", "imageLoadMs"].map((k) => [k, result[k]]));
const extra = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "runs" && !(k in metrics)));
const report = { ...metrics, ...extra, runs: result.runs, setup: { items: made.items, boards: made.boards, width: W, height: H, dpr: DPR, runs: RUNS, ...(AB ? { ab: AB } : {}) } };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, "\t")}\n`);
console.log(`METRICS ${JSON.stringify(report)}`);
link.close();
await browser.close();
