/**
 * A picture of the stage (`stage.screenshot`, the drawing's Export: `server/stage/shots.ts`) has
 * every drawn item in it, where the canvas itself draws it.
 *
 * The server takes the picture on `shot.html`, a page of its own that has to place the engine's
 * canvas exactly as the canvas does (`StageEngine.place`, `Stage.tsx`). When the two disagreed the
 * drawing came out shifted and scaled by 1/zoom, and blank at zoom 1 (any item alone, any short
 * list): the boards were right, so nothing else noticed.
 *
 * A text item and a rectangle are put on empty paper to the right of the fixture's boards, and the
 * server's picture is taken of a box, of each item alone, of a list of both, and of the whole
 * stage, at zoom 1 and below it. The canvas is screenshotted at about zoom 1 and about zoom 0.5 on
 * the same items. In each picture each item's ink (its pixels unlike the paper) is found around
 * where it should be, and its edges, turned back into stage units, must be within `NEAR` picture
 * pixels of the canvas's own; the rectangle's fill must be the canvas's colour, and the paper
 * the canvas's paper.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps every picture and the two canvas screenshots.
 */
import { existsSync, writeFileSync } from "node:fs";
import { API, deckState, open, say, settle, socket } from "../harness.mjs";

/** Picture pixels an edge may be off by: antialiasing and the canvas's own zoom not being exactly the picture's. */
const NEAR = 2;
/** How far from the paper a channel must be to count as ink. */
const INK = 48;

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const keep = process.env.DECKS_E2E_SHOTS;
const { browser, page, errors } = await open({ width: 1600, height: 1000, scheme: "light", boards: true });
await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});

// Empty paper to the right of every board, so the items' surroundings are paper.
const deck = await deckState();
const placed = deck.boards.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
const right = Math.max(0, ...placed.map((b) => b.x + (b.w ?? 0)));
const top = Math.min(...placed.map((b) => b.y));
const X = Math.round(right + 400);
const Y = Math.round((Number.isFinite(top) ? top : 0) + 120);
const TEXT = "shot-text";
const RECT = "shot-rect";
const FILL = "#2563eb";

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{ op: "insert", node: { type: "text", id: TEXT, content: "Shot text 12", fontSize: 32, fill: "#1f2328" }, box: { x1: X, y1: Y } },
		{ op: "insert", node: { type: "rectangle", id: RECT, width: 180, height: 96, fill: FILL, stroke: "#1f2328", strokeWidth: 2 }, box: { x1: X, y1: Y + 110, x2: X + 180, y2: Y + 206 } },
	],
});
const landed = await until(() => link.received.some((m) => m.type === "stage.pen" && [TEXT, RECT].every((id) => m.doc?.children?.some((n) => n.id === id))));
say("the text item and the rectangle are on the stage", !!landed);

/** The canvas's camera: `translate(a, b) scale(z) translate(c, d)` on the world, inside the stage's box. */
const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(document.querySelector(".world")?.style.transform ?? "");
		const rect = document.querySelector(".stage").getBoundingClientRect();
		return m ? { left: rect.left + Number(m[1]), top: rect.top + Number(m[2]), zoom: Number(m[3]), cx: Number(m[4]), cy: Number(m[5]), dpr: devicePixelRatio, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } } : null;
	});
const itemBox = (id) => page.evaluate((id) => {
	const r = window.__decksPenBox?.(id);
	return r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}, id);
const toScreen = (cam, x, y) => ({ x: cam.left + cam.zoom * (x + cam.cx), y: cam.top + cam.zoom * (y + cam.cy) });

/** Zoom the canvas about the items until its zoom is past `want` (in or out), then let it rest. */
async function zoomTo(want) {
	for (let i = 0; i < 80; i++) {
		const cam = await camera();
		if (!cam) break;
		if (want >= 1 ? cam.zoom >= want : cam.zoom <= want) break;
		const at = toScreen(cam, X + 120, Y + 100);
		await page.evaluate(([at, dy]) => {
			const stage = document.querySelector(".stage");
			stage.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
		}, [at, want >= 1 ? -12 : 12]);
		await settle(page, 60);
	}
	// The items in the middle of the window, where no panel is.
	for (let i = 0; i < 10; i++) {
		const cam = await camera();
		const at = toScreen(cam, X + 120, Y + 100);
		const mid = { x: (cam.rect.left + cam.rect.right) / 2, y: (cam.rect.top + cam.rect.bottom) / 2 };
		const dx = at.x - mid.x;
		const dy = at.y - mid.y;
		if (Math.abs(dx) < 4 && Math.abs(dy) < 4) break;
		await page.evaluate(([dx, dy, mid]) => {
			document.querySelector(".stage").dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, clientX: mid.x, clientY: mid.y, bubbles: true, cancelable: true }));
		}, [dx, dy, mid]);
		await settle(page, 120);
	}
	await page.waitForFunction(() => (window.__decksEngine.stats().tiles ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
	await settle(page, 1800);
	return camera();
}

/**
 * In the page: each region's ink, in the picture's pixels, against the paper at the region's edge;
 * and the colour in the middle of one region, and the paper's.
 */
async function inkOf([png, regions, ink]) {
	const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
	const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	context.drawImage(bitmap, 0, 0);
	const out = {};
	for (const [name, r] of Object.entries(regions)) {
		const x0 = Math.max(0, Math.floor(r.x1));
		const y0 = Math.max(0, Math.floor(r.y1));
		const x1 = Math.min(bitmap.width, Math.ceil(r.x2));
		const y1 = Math.min(bitmap.height, Math.ceil(r.y2));
		if (x1 - x0 < 2 || y1 - y0 < 2) {
			out[name] = { size: [bitmap.width, bitmap.height], none: "outside the picture" };
			continue;
		}
		const data = context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
		const w = x1 - x0;
		const h = y1 - y0;
		const paper = [data[0], data[1], data[2]];
		let box = null;
		let count = 0;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				if (Math.max(Math.abs(data[i] - paper[0]), Math.abs(data[i + 1] - paper[1]), Math.abs(data[i + 2] - paper[2])) <= ink) continue;
				count++;
				if (!box) box = { x1: x, y1: y, x2: x + 1, y2: y + 1 };
				else {
					box.x1 = Math.min(box.x1, x);
					box.y1 = Math.min(box.y1, y);
					box.x2 = Math.max(box.x2, x + 1);
					box.y2 = Math.max(box.y2, y + 1);
				}
			}
		}
		const mid = context.getImageData(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2), 1, 1).data;
		out[name] = { size: [bitmap.width, bitmap.height], paper, count, mid: [mid[0], mid[1], mid[2]], box: box && { x1: box.x1 + x0, y1: box.y1 + y0, x2: box.x2 + x0, y2: box.y2 + y0 } };
	}
	return out;
}

// Where each item is on the stage, in stage units: the canvas's own boxes for them, turned back.
const cam1 = await zoomTo(1);
const worldOf = async (id) => {
	const cam = await camera();
	const r = await until(() => itemBox(id), 8000);
	if (!r) return null;
	return { x1: (r.x - cam.left) / cam.zoom - cam.cx, y1: (r.y - cam.top) / cam.zoom - cam.cy, x2: (r.x + r.width - cam.left) / cam.zoom - cam.cx, y2: (r.y + r.height - cam.top) / cam.zoom - cam.cy };
};
const items = { [TEXT]: await worldOf(TEXT), [RECT]: await worldOf(RECT) };
say("the canvas has a box for each item", !!items[TEXT] && !!items[RECT], JSON.stringify(items));

/** Search regions for the items: their boxes and a margin, in stage units. */
const PAD = 12;
const regionsWorld = Object.fromEntries(Object.entries(items).map(([id, b]) => [id, { x1: b.x1 - PAD, y1: b.y1 - PAD, x2: b.x2 + PAD, y2: b.y2 + PAD }]));

/** The canvas, screenshotted, and each item's ink there in stage units. */
async function canvasInk(label) {
	const cam = await camera();
	const png = await page.screenshot({ type: "png" });
	if (keep) writeFileSync(`${keep}/stage-shot-canvas-${label}.png`, png);
	const s = cam.dpr * cam.zoom;
	const regions = Object.fromEntries(Object.entries(regionsWorld).map(([id, r]) => [id, { x1: (cam.left + cam.zoom * (r.x1 + cam.cx)) * cam.dpr, y1: (cam.top + cam.zoom * (r.y1 + cam.cy)) * cam.dpr, x2: (cam.left + cam.zoom * (r.x2 + cam.cx)) * cam.dpr, y2: (cam.top + cam.zoom * (r.y2 + cam.cy)) * cam.dpr }]));
	const found = await page.evaluate(inkOf, [png.toString("base64"), regions, INK]);
	const back = (px, py) => ({ x: px / s - cam.left / cam.zoom - cam.cx, y: py / s - cam.top / cam.zoom - cam.cy });
	const out = {};
	for (const [id, f] of Object.entries(found)) {
		if (!f.box) {
			out[id] = { ...f, world: null };
			continue;
		}
		const a = back(f.box.x1, f.box.y1);
		const b = back(f.box.x2, f.box.y2);
		out[id] = { ...f, world: { x1: a.x, y1: a.y, x2: b.x, y2: b.y } };
	}
	return { zoom: cam.zoom, ink: out };
}

const near1 = await canvasInk("zoom1");
say("the canvas draws both items at about zoom 1", Object.values(near1.ink).every((i) => i.world) && Math.abs(near1.zoom - 1) < 0.2, `zoom ${near1.zoom.toFixed(3)} ${JSON.stringify(Object.fromEntries(Object.entries(near1.ink).map(([id, i]) => [id, i.world])))}`);
await zoomTo(0.55);
const below1 = await canvasInk("zoom-below-1");
say("the canvas draws both items below zoom 1", Object.values(below1.ink).every((i) => i.world) && below1.zoom < 0.8, `zoom ${below1.zoom.toFixed(3)}`);

/** The server's picture: `of` an item list, a box, or nothing; its bytes and the box it took. */
async function shot(query) {
	const params = new URLSearchParams({ agent: agentId, scale: "1", scheme: "light", ...query });
	const started = Date.now();
	const response = await fetch(`${API}/api/stage-shot?${params}`);
	const ms = Date.now() - started;
	if (!response.ok) return { error: `${response.status} ${await response.text()}`, ms };
	const box = JSON.parse(response.headers.get("x-shot-box") ?? "null");
	return { png: Buffer.from(await response.arrayBuffer()), box, ms, how: decodeURIComponent(response.headers.get("x-shot-how") ?? "") };
}

const all = Object.values(items);
const both = { x1: Math.min(...all.map((b) => b.x1)), y1: Math.min(...all.map((b) => b.y1)), x2: Math.max(...all.map((b) => b.x2)), y2: Math.max(...all.map((b) => b.y2)) };
const CASES = [
	{ name: "a box round both items (zoom 1)", query: { box: [both.x1 - 60, both.y1 - 60, both.x2 + 60, both.y2 + 60].map(Math.round).join(",") }, ids: [TEXT, RECT] },
	{ name: "the text item alone (zoom 1)", query: { of: TEXT }, ids: [TEXT] },
	{ name: "the rectangle alone (zoom 1)", query: { of: RECT }, ids: [RECT] },
	{ name: "a list of both (zoom 1)", query: { of: `${TEXT},${RECT}` }, ids: [TEXT, RECT] },
	{ name: "a wide box (below zoom 1)", boards: true, query: { box: [both.x1 - 1500, both.y1 - 300, both.x2 + 1500, both.y2 + 300].map(Math.round).join(",") }, ids: [TEXT, RECT] },
	{ name: "the whole stage (below zoom 1)", boards: true, query: {}, ids: [TEXT, RECT] },
];

/*
 * Each case both ways: as the server takes it by default (drawn natively when it can be,
 * `native-shots.ts`) and in the browser with live boards (`live=1`, `shot.html`). `how` says which
 * it was; the drawing-only boxes must be native when the native renderer is built.
 */
const PATHS = [
	{ label: "", extra: {} },
	{ label: " [browser]", extra: { live: "1" } },
];
const nativeBuilt = existsSync(new URL("../../packages/stage/target/release/stage-shot", import.meta.url));
for (const path of PATHS)
for (const raw of CASES) {
	const c = { ...raw, name: `${raw.name}${path.label}`, query: { ...raw.query, ...path.extra } };
	const taken = await shot(c.query);
	if (!path.label && nativeBuilt && !raw.boards) say(`${c.name}: drawn natively`, taken.how === "native", taken.how);
	if (path.label) say(`${c.name}: taken in the browser`, taken.how.startsWith("chromium"), taken.how);
	if (taken.error) {
		say(`${c.name}: the server takes the picture`, false, taken.error);
		continue;
	}
	const { png, box } = taken;
	const width = png.readUInt32BE(16);
	const zoom = width / (box.x2 - box.x1);
	if (keep) writeFileSync(`${keep}/stage-shot-${c.name.replace(/[^a-z0-9]+/gi, "-")}.png`, png);
	const regions = Object.fromEntries(c.ids.map((id) => [id, { x1: (regionsWorld[id].x1 - box.x1) * zoom, y1: (regionsWorld[id].y1 - box.y1) * zoom, x2: (regionsWorld[id].x2 - box.x1) * zoom, y2: (regionsWorld[id].y2 - box.y1) * zoom }]));
	const found = await page.evaluate(inkOf, [png.toString("base64"), regions, INK]);
	const reference = zoom >= 0.99 ? near1 : below1;
	for (const id of c.ids) {
		const f = found[id];
		const want = reference.ink[id]?.world;
		if (!f?.box || !want) {
			say(`${c.name}: ${id} is in the picture`, false, f?.none ?? `no ink where the canvas draws it (${width}×${png.readUInt32BE(20)} at zoom ${zoom.toFixed(3)}, ${taken.ms} ms)`);
			continue;
		}
		const got = { x1: f.box.x1 / zoom + box.x1, y1: f.box.y1 / zoom + box.y1, x2: f.box.x2 / zoom + box.x1, y2: f.box.y2 / zoom + box.y1 };
		const off = Math.max(...["x1", "y1", "x2", "y2"].map((k) => Math.abs(got[k] - want[k]) * zoom));
		say(`${c.name}: ${id} is in the picture within ${NEAR} px of where the canvas draws it`, off <= NEAR, `off by ${off.toFixed(2)} px at zoom ${zoom.toFixed(3)}; picture ${JSON.stringify(roundBox(got))} canvas ${JSON.stringify(roundBox(want))}; ${taken.ms} ms${taken.how ? ` (${taken.how})` : ""}`);
		if (id === RECT) {
			const canvasMid = reference.ink[id].mid;
			const diff = Math.max(...[0, 1, 2].map((k) => Math.abs(f.mid[k] - canvasMid[k])));
			say(`${c.name}: the rectangle's fill is the canvas's`, diff <= 12, `picture (${f.mid}) canvas (${canvasMid})`);
		}
	}
	const paper = found[c.ids[0]].paper;
	const canvasPaper = reference.ink[c.ids[0]].paper;
	const diff = Math.max(...[0, 1, 2].map((k) => Math.abs(paper[k] - canvasPaper[k])));
	say(`${c.name}: the paper is the canvas's paper`, diff <= 3, `picture (${paper}) canvas (${canvasPaper})`);
}

// Dark: the stage's dark colour (`--stage` in index.css), not a colour of the picture page's own.
{
	const dark = await shot({ of: TEXT, scheme: "dark" });
	const found = dark.png ? await page.evaluate(inkOf, [dark.png.toString("base64"), { corner: { x1: 0, y1: 0, x2: 4, y2: 4 } }, INK]) : undefined;
	const paper = found?.corner?.paper;
	say("dark: the paper is the stage's dark paper (#101010)", !!paper && paper.every((v) => Math.abs(v - 16) <= 3), dark.error ?? `(${paper})`);
}

function roundBox(b) {
	return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 10) / 10]));
}

link.send({ type: "stage.pen.edit", agentId, ops: [TEXT, RECT].map((id) => ({ op: "delete", id })) });
link.close();
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
void cam1;
