/**
 * A note's edge lies between the paper around it and the note itself, under WebGPU and WebGL 2.
 *
 * Notes are drawn into tiles in the render worker, sent to the page as `ImageBitmap`s (a WebGL 2 or
 * WebGPU `OffscreenCanvas`'s `transferToImageBitmap`) and copied into the page's textures (`putTile`,
 * `copy_in` in `crates/web/src/bind.rs`). WebKit's WebGL 2 hands such a bitmap over with straight
 * (not premultiplied) colour, which the premultiplied blend drew too bright wherever a tile is
 * partly clear: on an iPhone every note had a pale rim (its antialiased edge). The goldens
 * (`stage-goldens.mjs`) draw straight onto the page canvas and never take this path.
 *
 * Chromium with WebGPU, Chromium with `navigator.gpu` taken away (WebGL 2) and WebKit as an iPhone
 * (WebGL 2): a note is put on the stage, the page screenshotted, and the row through the note's
 * middle read from inside the note across its right edge onto the paper. Every channel of every pixel there must be
 * within `SLACK` above the brighter of the paper and the note's fill and `SHADE` below the darker
 * (a shadow may darken a little, nothing may brighten; Playwright's WebKit showed the fault as
 * wild colours, (0,234,143) (58,37,213), an iPhone as a pale rim); and Chromium's WebGL 2 row must
 * match its WebGPU row.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps a crop of each edge.
 */
import { canvasFrame, open, say, settle, socket } from "../harness.mjs";
import { TARGETS, noGpu } from "../backends-kit.mjs";

/** Levels a channel may stand above both sides: rounding, not a halo (the halo was 40 to 60). */
const SLACK = 6;
/** Levels a channel may fall below both sides: the note's shadow (about 30), not a broken colour. */
const SHADE = 60;

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const RUNS = [
	{ label: "Chromium · WebGPU", slug: "chromium-webgpu", open: TARGETS[0].open, init: undefined, want: "webgpu" },
	{ label: "Chromium · WebGL 2", slug: "chromium-webgl2", open: TARGETS[0].open, init: noGpu, want: "webgl2" },
	{ label: "WebKit iPhone 15 Pro · WebGL 2", slug: "webkit-iphone-webgl2", open: TARGETS[1].open, init: noGpu, want: "webgl2" },
];

/** In the page: the screenshot's row through the note's middle, from `inside` pixels left of its right edge to `out` right of it, on the paper. */
async function edgeRow([png, box, dpr, out, inside]) {
	const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
	const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d");
	context.drawImage(bitmap, 0, 0);
	const y = Math.round((box.y + box.height / 2) * dpr);
	const edge = Math.round((box.x + box.width) * dpr);
	const x0 = edge - inside;
	const data = context.getImageData(x0, y, out + inside, 1).data;
	const row = [];
	for (let i = 0; i < data.length; i += 4) row.push([data[i], data[i + 1], data[i + 2]]);
	return { row, x0, y, edge };
}

let noteId = "";
const rows = {};
for (const run of RUNS) {
	const { browser, page, errors } = await open({ ...run.open, scheme: "light", boards: false, init: run.init });
	/** The canvas frame: the stage and its engine are there (the screenshot and its reading stay the page's). */
	const canvas = await canvasFrame(page);
	const opened = await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).then(() => true, () => false);
	const stats = await canvas.evaluate(() => window.__decksEngine?.stats?.());
	say(`${run.label}: the stage draws with ${run.want}`, opened && stats?.backend === run.want && stats?.workerBackend === run.want, JSON.stringify(stats));
	// The camera opens at the origin and, a couple of seconds later, goes to what the agent has up:
	// wait for it to get there and stay, or the note is placed (and later sought) in a view that is gone.
	await canvas.waitForFunction(() => (window.__decksBoards?.().length ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
	for (let last = "", since = Date.now(), end = Date.now() + 15000; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) {
		const now = await canvas.evaluate(() => globalThis.__decksCameraTransform?.() ?? "");
		if (now !== last) [last, since] = [now, Date.now()];
		else if (Date.now() - since > 1500 && !now.includes("scale(1) translate(0px, 0px)")) break;
	}
	await settle(page, 300);

	if (!noteId) {
		// One note, on empty paper in the first page's view (no board under it), on a stage the later pages open too.
		const at = await canvas.evaluate(() => {
			const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(globalThis.__decksCameraTransform?.() ?? "");
			if (!m) return null;
			const stage = document.querySelector(".stage");
			const rect = stage.getBoundingClientRect();
			const zoom = Number(m[3]);
			const boards = (window.__decksBoards?.() ?? []).map((b) => b.rect);
			const free = (x, y) => boards.every((r) => x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 4);
			// The free spot nearest the middle (clear of the panels at the sides): room for the note and paper to its left.
			const spots = [];
			for (let y = rect.top + 160; y < rect.bottom - 160; y += 20) {
				for (let x = rect.left + rect.width * 0.3; x < rect.right - rect.width * 0.3; x += 20) {
					if ([-60, 0, 60, 120].every((dx) => [-40, 0, 40].every((dy) => free(x + dx, y + dy)))) spots.push({ x, y });
				}
			}
			const mid = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
			spots.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
			if (spots[0]) return { x: (spots[0].x - rect.left - rect.width / 2) / zoom - Number(m[4]), y: (spots[0].y - rect.top - rect.height / 2) / zoom - Number(m[5]) };
			return { x: -Number(m[4]), y: -Number(m[5]) };
		});
		const link = await socket();
		const agentId = await until(() => link.last("agents")?.focused);
		noteId = `edge-note-${Date.now()}`;
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: noteId, content: "the edge of a note" }, box: { x1: Math.round(at?.x ?? 0), y1: Math.round(at?.y ?? 0) } }] });
		await until(() => link.received.some((m) => m.type === "stage.pen" && m.doc?.children?.some((n) => n.id === noteId)));
		link.close();
	}
	const boxOf = () => canvas.evaluate((id) => {
		const r = window.__decksPenBox?.(id);
		return r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
	}, noteId);
	// Zoomed in about the note until it is a few hundred pixels wide: its edge many pixels across.
	for (let i = 0; i < 40; i++) {
		const b = await until(boxOf, 8000);
		const wide = await canvas.evaluate(() => Math.min(360, innerWidth * 0.45));
		if (!b || b.width >= wide) break;
		await canvas.evaluate((b) => {
			const stage = document.querySelector(".stage");
			stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -60, ctrlKey: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, bubbles: true, cancelable: true }));
		}, b);
		await settle(page, 120);
	}
	await settle(page, 600);
	const box = await until(() => canvas.evaluate((id) => {
		const r = window.__decksPenBox?.(id);
		return r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
	}, noteId));
	say(`${run.label}: the note is on the stage`, !!box, JSON.stringify(box));
	if (!box) {
		await browser.close();
		continue;
	}
	// Painted into tiles and put on the page.
	await canvas.waitForFunction(() => (window.__decksEngine.stats().tiles ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
	await settle(page, 2500);
	const dpr = await page.evaluate(() => devicePixelRatio);
	const png = (await page.screenshot()).toString("base64");
	const out = Math.round(14 * dpr);
	const inside = Math.round(10 * dpr);
	const { row, x0, y } = await page.evaluate(edgeRow, [png, box, dpr, out, inside]);
	rows[run.slug] = { row, dpr };
	const fill = row[0];
	const paper = row[row.length - 1];
	let worst = { over: -Infinity, at: -1, px: null };
	let darkest = { under: -Infinity, at: -1, px: null };
	for (let i = 0; i < row.length; i++) {
		const over = Math.max(...[0, 1, 2].map((c) => row[i][c] - Math.max(paper[c], fill[c])));
		if (over > worst.over) worst = { over, at: x0 + i, px: row[i] };
		const under = Math.max(...[0, 1, 2].map((c) => Math.min(paper[c], fill[c]) - row[i][c]));
		if (under > darkest.under) darkest = { under, at: x0 + i, px: row[i] };
	}
	const shown = row.slice(Math.max(0, inside - 3 * dpr), inside + 4 * dpr).map((p) => `(${p.join(",")})`).join(" ");
	say(
		`${run.label}: the note's edge is between the paper and the note (no more than ${SLACK} brighter, ${SHADE} darker)`,
		worst.over <= SLACK && darkest.under <= SHADE && fill[2] < paper[2] - 40,
		`paper (${paper}) fill (${fill}) brightest +${worst.over} at x=${worst.at} (${worst.px}), darkest -${darkest.under} at x=${darkest.at} (${darkest.px}), y=${y}; across the edge: ${shown}`,
	);
	const dir = process.env.DECKS_E2E_SHOTS;
	if (dir) {
		const clip = { x: box.x + box.width - 80, y: box.y + box.height / 2 - 30, width: 120, height: 60 };
		await page.screenshot({ path: `${dir}/note-edge-${run.slug}.png`, clip });
	}
	say(`${run.label}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}

// The same browser, the same screen: WebGL 2's edge is WebGPU's.
const a = rows["chromium-webgpu"]?.row;
const b = rows["chromium-webgl2"]?.row;
if (a && b) {
	const most = Math.max(...a.map((p, i) => Math.max(...[0, 1, 2].map((c) => Math.abs(p[c] - (b[i]?.[c] ?? 0))))));
	say("Chromium: the note's edge under WebGL 2 is the edge under WebGPU (within 4)", most <= 4, `largest difference ${most}`);
}
