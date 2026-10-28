/**
 * A frame marked `placeholder: true` is drawn unfinished: a dashed outline just inside its edge, in
 * the colour of the agent that last wrote the canvas, with that agent's name on a tag in its
 * top-left corner; with no writer known, in the accent and with no name (`placeholder_mark` in
 * `packages/stage/crates/paint/src/painter.rs`).
 *
 * A placeholder frame is put on empty paper by the person (so no agent is the writer), and the
 * canvas is screenshotted at about zoom 1: its edge must be dashed in the accent, with no tag. Then
 * the engine is told a writer (`StageEngine.setWriter`, what the app does with the drawing's `by`):
 * the same edge is dashed in the writer's green, and the tag is there, green with white words. The
 * server's pictures of the frame, native and in the browser, draw the same accent outline.
 *
 * `DECKS_E2E_SHOTS=<dir>` keeps the pictures.
 */
import { writeFileSync } from "node:fs";
import { API, asPerson, deckState, open, say, settle, socket } from "../harness.mjs";

const keep = process.env.DECKS_E2E_SHOTS;
const ID = "ph-frame";
const W = 360;
const H = 200;
const GREEN = [0x2e, 0xaf, 0x5a];

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const { browser, page, errors } = await open({ width: 1400, height: 900, scheme: "light", boards: true });
await page.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});

const deck = await deckState();
const placed = deck.boards.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
const X = Math.round(Math.max(0, ...placed.map((b) => b.x + (b.w ?? 0))) + 400);
const Y = Math.round((placed.length ? Math.min(...placed.map((b) => b.y)) : 0) + 120);

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [{ op: "insert", node: { type: "frame", id: ID, width: W, height: H, layout: "none", placeholder: true, fill: "#ffffff" }, box: { x1: X, y1: Y, x2: X + W, y2: Y + H } }],
});
const landed = await until(() => link.received.some((m) => m.type === "stage.pen" && m.doc?.children?.some((n) => n.id === ID)) || link.received.some((m) => m.type === "stage.pen.delta"));
say("the placeholder frame is on the stage", !!landed);

/** The accent as `[r, g, b]`, as the page resolves `--color-accent` in this scheme. */
const accent = await page.evaluate(() => {
	const c = document.createElement("canvas").getContext("2d");
	c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#3b5cf6";
	c.fillRect(0, 0, 1, 1);
	return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
});

const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(globalThis.__decksCameraTransform?.() ?? "");
		const rect = document.querySelector(".stage").getBoundingClientRect();
		return m ? { left: rect.left + Number(m[1]), top: rect.top + Number(m[2]), zoom: Number(m[3]), cx: Number(m[4]), cy: Number(m[5]), dpr: devicePixelRatio, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } } : null;
	});
const toScreen = (cam, x, y) => ({ x: cam.left + cam.zoom * (x + cam.cx), y: cam.top + cam.zoom * (y + cam.cy) });

/** About zoom 1, the frame in the middle of the window. */
async function zoomToOne() {
	for (let i = 0; i < 80; i++) {
		const cam = await camera();
		if (!cam || Math.abs(cam.zoom - 1) < 0.08) break;
		const at = toScreen(cam, X + W / 2, Y + H / 2);
		await page.evaluate(([at, dy]) => {
			document.querySelector(".stage").dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
		}, [at, cam.zoom < 1 ? -6 : 6]);
		await settle(page, 60);
	}
	for (let i = 0; i < 10; i++) {
		const cam = await camera();
		const at = toScreen(cam, X + W / 2, Y + H / 2);
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
 * In the page: for a picture and the frame's box in its pixels, how many pixels near each colour
 * lie in the band along its edge (2 px either side of the outline), how many times the top edge's
 * line turns from that colour to not (its dashes), and the tag's pixels near the colour and near white.
 */
async function look([png, box, colours, scale]) {
	const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
	const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	context.drawImage(bitmap, 0, 0);
	const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
	const at = (x, y) => {
		const i = (Math.round(y) * bitmap.width + Math.round(x)) * 4;
		return [data[i], data[i + 1], data[i + 2]];
	};
	const near = (p, c, by = 48) => Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - c[k]))) <= by;
	const out = {};
	for (const [name, c] of Object.entries(colours)) {
		let band = 0;
		const inner = 4 * scale;
		for (let y = box.y1 - 2; y <= box.y2 + 2; y++) {
			for (let x = box.x1 - 2; x <= box.x2 + 2; x++) {
				const inside = x > box.x1 + inner && x < box.x2 - inner && y > box.y1 + inner && y < box.y2 - inner;
				if (!inside && near(at(x, y), c)) band++;
			}
		}
		// The line along the top edge, a pixel in from it: its dashes turn on and off.
		let turns = 0;
		let was = false;
		const line = box.y1 + 1 * scale;
		for (let x = box.x1 + 16 * scale; x <= box.x2 - 16 * scale; x++) {
			const on = near(at(x, line), c, 64);
			if (was && !on) turns++;
			was = on;
		}
		let tag = 0;
		let white = 0;
		for (let y = box.y1 + 7 * scale; y <= box.y1 + 22 * scale; y++) {
			for (let x = box.x1 + 7 * scale; x <= box.x1 + 50 * scale; x++) {
				const p = at(x, y);
				if (near(p, c)) tag++;
				if (near(p, [255, 255, 255], 30)) white++;
			}
		}
		out[name] = { band, turns, tag, white };
	}
	return out;
}

const cam = await zoomToOne();
say("the canvas is at about zoom 1 on the frame", !!cam && Math.abs(cam.zoom - 1) < 0.1, `zoom ${cam?.zoom}`);

async function onCanvas(label) {
	const c = await camera();
	const png = await page.screenshot({ type: "png" });
	if (keep) writeFileSync(`${keep}/placeholder-canvas-${label}.png`, png);
	const a = toScreen(c, X, Y);
	const b = toScreen(c, X + W, Y + H);
	const s = c.dpr * c.zoom;
	return page.evaluate(look, [png.toString("base64"), { x1: Math.round(a.x * c.dpr), y1: Math.round(a.y * c.dpr), x2: Math.round(b.x * c.dpr), y2: Math.round(b.y * c.dpr) }, { accent, green: GREEN }, s]);
}

const plain = await onCanvas("no-writer");
say("with no writer the edge is dashed in the accent", plain.accent.band > 400 && plain.accent.turns >= 10, JSON.stringify(plain));
say("with no writer there is no name tag", plain.accent.tag < 40 && plain.green.band < 40, JSON.stringify(plain));

await page.evaluate(() => window.__decksRust.setWriter({ name: "Atelier", color: "#2eaf5a" }));
await settle(page, 1500);
const named = await onCanvas("writer");
say("with a writer the edge is dashed in the writer's colour", named.green.band > 400 && named.green.turns >= 10 && named.accent.band < 40, JSON.stringify(named));
say("with a writer its name is on a tag of its colour in the corner", named.green.tag > 150 && named.green.white > 15, JSON.stringify(named.green));

/** The server's picture of the frame, as `canvas.screenshot` takes it: natively, or in the browser with `live`. */
async function shot(extra) {
	const params = new URLSearchParams({ agent: agentId, scale: "1", scheme: "light", of: ID, ...extra });
	const response = await fetch(`${API}/api/stage-shot?${params}`, { headers: await asPerson() });
	if (!response.ok) return { error: `${response.status} ${await response.text()}` };
	const box = JSON.parse(response.headers.get("x-shot-box") ?? "null");
	return { png: Buffer.from(await response.arrayBuffer()), box, how: decodeURIComponent(response.headers.get("x-shot-how") ?? "") };
}
for (const [label, extra] of [["native", {}], ["browser", { live: "1" }]]) {
	const taken = await shot(extra);
	if (taken.error) {
		say(`the server's picture (${label}) is taken`, false, taken.error);
		continue;
	}
	if (keep) writeFileSync(`${keep}/placeholder-shot-${label}.png`, taken.png);
	const width = taken.png.readUInt32BE(16);
	const zoom = width / (taken.box.x2 - taken.box.x1);
	const box = { x1: Math.round((X - taken.box.x1) * zoom), y1: Math.round((Y - taken.box.y1) * zoom), x2: Math.round((X + W - taken.box.x1) * zoom), y2: Math.round((Y + H - taken.box.y1) * zoom) };
	const found = await page.evaluate(look, [taken.png.toString("base64"), box, { accent }, zoom]);
	say(`the server's picture (${taken.how}) has the frame's edge dashed in the accent, no tag`, found.accent.band > 300 && found.accent.turns >= 10 && found.accent.tag < 40, JSON.stringify(found));
}

say("no page errors", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
