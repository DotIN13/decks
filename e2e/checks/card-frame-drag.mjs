/**
 * Dragging a framed card costs what dragging a plain one does, and its frame goes with it.
 *
 * A card's outline and shadow are painted with the drawing (`paint`'s `browser_frame`), into the
 * worker's tiles. A drag could have repainted the tiles under the card at every step; it should not:
 * the card is carried as its picture and the drawing is put back once, when it lands. Here: a plain
 * card and one with a square corner, an outer red outline 16 wide and a blue shadow spread 30, each
 * dragged 40 steps by its bar. For each: the tiles the worker sent while the pointer moved, the frames
 * the page drew and the slowest of them; and a picture mid-drag (`FRAME_SHOTS=<folder>`). The framed
 * card's drag may cost no more than a few tiles over the plain one's, and both send none mid-drag.
 * Named: run with `node e2e/run.mjs card-frame-drag`.
 */
import { API, asPerson, canvasFrame, flyToCard, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const html = `<style>:host { background: #000 }</style><div class="doc"><p style="margin:0;padding:20px;color:#fff;font-size:18px">A card</p></div>`;
const plain = await call("canvas.insert", [{ type: "card", title: "Plain", html, width: 400, height: 240 }, { at: { x1: -3000, y1: -3000 } }]);
const framed = await call("canvas.insert", [{ type: "card", title: "Framed", html, width: 400, height: 240 }, { at: { x1: -2500, y1: -3000 } }]);
await call("canvas.update", [framed.value?.id, { set: { cornerRadius: 0, stroke: "#ff0000", strokeWidth: 16, strokeAlignment: "outer", effect: { type: "shadow", offset: { x: 0, y: 0 }, blur: 0, spread: 30, color: "#0000ff" } } }]);
const A = plain.value.card;
const B = framed.value.card;

// Every tile the render worker hands the page, counted as it arrives.
const init = () => {
	const Real = globalThis.Worker;
	if (!Real) return;
	globalThis.__tilesIn = 0;
	globalThis.Worker = class extends Real {
		constructor(...args) {
			super(...args);
			this.addEventListener("message", (event) => {
				if (event.data?.type === "tiles") globalThis.__tilesIn += event.data.tiles?.length ?? 0;
			});
		}
	};
};
const { browser, page, errors } = await open({ width: 1400, height: 900, scheme: "dark", init });
const canvas = await canvasFrame(page);
const rect = (path) =>
	canvas.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === wanted);
		const c = (globalThis.__decksProbes?.cards?.() ?? []).find((one) => one.path === wanted);
		const bar = node?.querySelector(".plain-card-bar")?.getBoundingClientRect();
		return c ? { x: c.rect.x, y: c.rect.y, w: c.rect.width, h: c.rect.height, bar: bar ? { x: bar.x, y: bar.y, w: bar.width, h: bar.height } : null } : null;
	}, path);
const onScreen = (r) => r && r.x > 420 && r.y > 120 && r.x + r.w < 1100 && r.y + r.h < 700;

await flyToCard(page, B);
await page.mouse.move(1300, 450);
for (let i = 0; i < 12 && !(onScreen(await rect(A)) && onScreen(await rect(B))); i++) {
	await page.keyboard.press("ControlOrMeta+Minus");
	await settle(page, 300);
}
await settle(page, 2500);

const drag = async (path, label) => {
	const r = await rect(path);
	await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
	await page.waitForTimeout(400);
	const { bar } = (await rect(path)) ?? {};
	if (!bar) {
		say(`${label}: its bar is there to drag by`, false, JSON.stringify(r));
		return null;
	}
	const from = { x: bar.x + Math.min(40, bar.w / 2), y: bar.y + bar.h / 2 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.waitForTimeout(150);
	// Frames drawn from here, and tiles sent, while the pointer moves.
	await canvas.evaluate(() => {
		globalThis.__frames = [];
		globalThis.__tilesAt = globalThis.__tilesIn ?? 0;
		const tick = (t) => {
			globalThis.__frames.push(t);
			if (globalThis.__frames.length < 2000 && !globalThis.__stop) requestAnimationFrame(tick);
		};
		globalThis.__stop = false;
		requestAnimationFrame(tick);
	});
	for (let i = 1; i <= 40; i++) {
		await page.mouse.move(from.x + 6 * i, from.y + 3 * i);
		await page.waitForTimeout(16);
	}
	const moving = await canvas.evaluate(() => {
		globalThis.__stop = true;
		const f = globalThis.__frames;
		const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
		return { tiles: (globalThis.__tilesIn ?? 0) - globalThis.__tilesAt, frames: f.length, slowest: Math.round(gaps.at(-1) ?? 0), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), counting: globalThis.__tilesIn !== undefined };
	});
	await page.waitForTimeout(300);
	if (process.env.FRAME_SHOTS) await page.screenshot({ path: `${process.env.FRAME_SHOTS}/drag-${label}.png` });
	// Where the drag has it (its node goes with it, unseen; the drag snaps it a few pixels), and where it was: just outside each left edge, a quarter down.
	const z = r.w / 400;
	const now = await canvas.evaluate((wanted) => [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === wanted)?.getBoundingClientRect().toJSON(), path);
	const [carriedEdge, leftBehind] = await sample([[now.x - 10 * z, now.y + now.height / 4], [r.x - 10 * z, r.y + r.h / 4]]);
	const landedAt = await canvas.evaluate(() => globalThis.__tilesIn ?? 0);
	await page.mouse.up();
	await settle(page, 2000);
	const landing = (await canvas.evaluate(() => globalThis.__tilesIn ?? 0)) - landedAt;
	const after = await rect(path);
	say(`${label}: moved by the drag`, after && after.x > r.x + 150, JSON.stringify({ before: r.x, after: after?.x }));
	return { ...moving, landing, carriedEdge, leftBehind };
};

const sample = async (points) => {
	const out = [];
	for (const [x, y] of points) {
		const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
		out.push(await page.evaluate(async (data) => {
			const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
			const g = new OffscreenCanvas(image.width, image.height).getContext("2d");
			g.drawImage(image, 0, 0);
			return [...g.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data.slice(0, 3)];
		}, shot.toString("base64")));
	}
	return out;
};
const red = (c) => c[0] > 140 && c[1] < 80 && c[0] > c[2];

const p = await drag(A, "plain");
const f = await drag(B, "framed");
if (process.env.FRAME_SHOTS) (await import("node:fs")).writeFileSync(`${process.env.FRAME_SHOTS}/numbers.json`, JSON.stringify({ plain: p, framed: f }, null, 1));
say("the worker's tiles are counted", !!p?.counting, JSON.stringify(p));
say("dragging the plain card: no tiles while it moves", p?.tiles === 0, JSON.stringify(p));
say("mid-drag, the framed card's red outline goes with it", !!f && red(f.carriedEdge), JSON.stringify(f?.carriedEdge));
say("…and none is left where it was", !!f && !red(f.leftBehind), JSON.stringify(f?.leftBehind));
say("dragging the framed card: only the tiles that take it out, a few, while it moves", !!f && f.tiles <= 8, JSON.stringify(f));
say("…its slowest frame no slower than the plain card's, give or take 20 ms", !!p && !!f && f.slowest <= p.slowest + 20, `plain ${JSON.stringify(p)} · framed ${JSON.stringify(f)}`);
say("…and the drawing put back once it lands, in a few tiles more than the plain card's at most", !!p && !!f && f.landing <= p.landing + 8, `plain ${p?.landing} · framed ${f?.landing} tiles on landing`);
say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
