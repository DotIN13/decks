/**
 * Pictures of a drag in flight, for looking at: a sleeping card dragged by its bar at 30%, a running
 * app and a sleeping app dragged by their bars at 60%. `AWAKE_SHOTS=<folder>` keeps the pictures.
 */
import { canvasFrame, deckState, open, say, socket } from "../harness.mjs";
import { writeAwakeCanvas } from "../awake-canvas.mjs";

const CANVAS = "awake-drag";
const shots = process.env.AWAKE_SHOTS ?? "/tmp/awake-shots";
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve().then(test).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};
setTimeout(() => {
	say("the drag pictures finished within 90 s", false);
	process.exit(1);
}, 90_000).unref();

const deck = await deckState();
writeAwakeCanvas(deck.path, { cards: 16, apps: 3, documents: 1, name: CANVAS, prefix: "drag" });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const { page } = await open({ width: 1400, height: 900, cards: false, edit: process.env.AWAKE_EDIT === "1", ...(process.env.AWAKE_DPR ? { dpr: Number(process.env.AWAKE_DPR) } : {}) });
link.send({ type: "agent.stage", id: agentId, stage: CANVAS });
setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1000);
await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === CANVAS), 20000);
await page.reload({ waitUntil: "domcontentloaded" });
const canvas = await canvasFrame(page);
await canvas.waitForFunction(() => (globalThis.__decksProbes?.cards?.().length ?? 0) >= 20 && !!globalThis.__decksProbes?.rust?.camera, undefined, { timeout: 30000 });
await canvas.evaluate(() => {
	const stage = () => document.querySelector(".stage");
	const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
	const wheel = (deltaX, deltaY, ctrlKey) => {
		const r = stage().getBoundingClientRect();
		stage().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
	};
	globalThis.__t = {
		async zoomTo(zoom) {
			for (let i = 0; i < 200; i++) {
				const now = globalThis.__decksProbes.rust.camera.zoom;
				const ln = Math.log(zoom / now);
				if (Math.abs(ln) < 1e-6) return;
				wheel(0, -64 * Math.max(-Math.log(1.29), Math.min(Math.log(1.29), ln)), true);
				await raf();
			}
		},
		async panTo(x, y) {
			for (let i = 0; i < 40; i++) {
				const c = globalThis.__decksProbes.rust.camera;
				const dx = (x - c.x) * c.zoom;
				const dy = (y - c.y) * c.zoom;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
				wheel(Math.max(-3000, Math.min(3000, dx)), Math.max(-3000, Math.min(3000, dy)), false);
				await raf();
				await raf();
			}
		},
	};
});
const rest = () => page.waitForTimeout(1200);
/** Centre the camera on an item at `zoom`, from its screen rect. */
const centreOn = async (path, zoom) => {
	await canvas.evaluate((z) => globalThis.__t.zoomTo(z), zoom);
	await rest();
	const at = await canvas.evaluate((path) => {
		const c = globalThis.__decksProbes.cards().find((one) => one.path === path);
		const cam = globalThis.__decksProbes.rust.camera;
		const r = document.querySelector(".stage").getBoundingClientRect();
		return { x: cam.x + (c.rect.left - r.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - r.top + c.rect.height / 2) / cam.zoom };
	}, path);
	// The item's middle at x 820 on the screen, clear of the tool column at the frame's left edge.
	await canvas.evaluate(({ x, y, z }) => globalThis.__t.panTo(x - 820 / z, y - 900 / 2 / z), { ...at, z: zoom });
	await rest();
};
/** The item's rect on screen, and its bar's if its node has one. */
const rects = (path) =>
	canvas.evaluate((path) => {
		const c = globalThis.__decksProbes.cards().find((one) => one.path === path);
		const node = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path);
		// A card's bar above its box, or an app's grip over the window bar the engine paints.
		const bar = node?.querySelector(".plain-card-bar, .app-grip")?.getBoundingClientRect();
		return { item: c && [c.rect.x, c.rect.y, c.rect.width, c.rect.height].map(Math.round), state: node?.dataset.state, bar: bar && [bar.x, bar.y, bar.width, bar.height].map(Math.round) };
	}, path);
/** Hover the item so its node and bar appear, press the bar, move 320 px right and 120 down, picture it, let go. */
const drag = async (path, label) => {
	let r = await rects(path);
	await page.mouse.move(r.item[0] + r.item[2] / 2, r.item[1] + r.item[3] / 2);
	await page.waitForTimeout(400);
	r = await rects(path);
	const probe = await canvas.evaluate(({ x, y }) => ({ under: globalThis.__decksProbes?.pictureAt?.(x, y), nodes: [...document.querySelectorAll(".world .card-node")].map((n) => `${n.dataset.path}:${n.dataset.state}`), mode: document.querySelector(".stage")?.dataset.mode }), { x: r.item[0] + r.item[2] / 2, y: r.item[1] + r.item[3] / 2 });
	say(`${label}: hovered, its node is there with a bar`, !!r.bar, `${JSON.stringify(r)} ${JSON.stringify(probe)}`);
	const steady = await canvas.evaluate(async (path) => {
		const seen = [];
		for (let i = 0; i < 20; i++) {
			seen.push([...document.querySelectorAll(".world .card-node")].some((n) => n.dataset.path === path) ? 1 : 0);
			await new Promise((done) => setTimeout(done, 30));
		}
		return seen.join("");
	}, path);
	say(`${label}: the hovered node stays while the pointer rests`, !steady.includes("0"), steady);
	if (!r.bar) return;
	await page.mouse.move(r.bar[0] + Math.min(60, r.bar[2] / 2), r.bar[1] + r.bar[3] / 2);
	await page.mouse.down();
	await page.waitForTimeout(80);
	const pressed = await canvas.evaluate(() => ({ selected: [...document.querySelectorAll('.card-node[data-selected="true"]')].map((n) => n.dataset.path), awake: globalThis.__decksProbes?.awake?.(), nodes: [...document.querySelectorAll(".world .card-node")].map((n) => `${n.dataset.path.split("/").pop()}:${n.dataset.state}`), stage: Object.entries(document.querySelector(".stage")?.dataset ?? {}).filter(([k, v]) => v === "true").map(([k]) => k) }));
	say(`${label}: pressed on the bar`, true, JSON.stringify(pressed));
	for (let i = 1; i <= 16; i++) {
		await page.mouse.move(r.bar[0] + 60 + 20 * i, r.bar[1] + r.bar[3] / 2 + 7.5 * i);
		await page.waitForTimeout(30);
	}
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${shots}/drag-${label}.png` });
	const mid = await rects(path);
	const midNodes = await canvas.evaluate(() => [...document.querySelectorAll(".world .card-node")].map((n) => `${n.dataset.path.split("/").pop()}:${n.dataset.state}${n.dataset.carried !== undefined ? ":carried" : ""}`));
	say(`${label}: mid-drag nodes`, true, midNodes.join(" "));
	await page.mouse.up();
	await rest();
	const after = await rects(path);
	say(`${label}: moved`, after.item[0] > r.item[0] + 200, `before ${JSON.stringify(r.item)} mid ${JSON.stringify(mid.item)} after ${JSON.stringify(after.item)}`);
};
const items = await canvas.evaluate(() => globalThis.__decksProbes.cards().map((c) => c.path));
const apps = items.filter((p) => /^item:aa/.test(p));

// A card asleep at 30%, hovered so its bar appears, and dragged by the bar.
await centreOn(items.find((p) => /cards\//.test(p)), 0.3);
await drag(items.find((p) => /cards\//.test(p)), "sleeping-card-30-bar");

// Another card asleep at 30%, pressed on its picture and dragged: the press selects it, and the drag carries its picture.
// The last card, far from the first one, whose selection pill would sit over a neighbour's picture.
const card = items.filter((p) => /cards\//.test(p)).at(-1);
await centreOn(card, 0.3);
{
	const r = await rects(card);
	const from = { x: r.item[0] + r.item[2] / 2, y: r.item[1] + r.item[3] / 2 };
	await page.mouse.move(from.x, from.y);
	await page.waitForTimeout(300);
	const hovered = await canvas.evaluate(({ x, y }) => ({ awake: globalThis.__decksProbes?.awake?.(), under: globalThis.__decksProbes?.pictureAt?.(x, y), el: (() => { const e = document.elementFromPoint(x, y); return `${e?.tagName}.${e?.className?.toString().slice(0, 30)}`; })() }), from);
	say("pictured-card-30: hovered over its picture", true, JSON.stringify(hovered));
	await page.mouse.down();
	await page.waitForTimeout(80);
	const down = await canvas.evaluate(() => ({ awake: globalThis.__decksProbes?.awake?.() }));
	say("pictured-card-30: pressed", true, JSON.stringify(down));
	for (let i = 1; i <= 16; i++) {
		await page.mouse.move(from.x + 20 * i, from.y + 7.5 * i);
		await page.waitForTimeout(30);
	}
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${shots}/drag-pictured-card-30.png` });
	const mid = await rects(card);
	await page.mouse.up();
	await rest();
	await page.screenshot({ path: `${shots}/drag-pictured-card-30-after.png` });
	const after = await rects(card);
	say("pictured-card-30: pressed on its picture and dragged, it moved", after.item[0] > r.item[0] + 200, `before ${JSON.stringify(r)} mid ${JSON.stringify(mid)} after ${JSON.stringify(after)}`);
}
await centreOn(apps[0], 0.6);
await until(async () => canvas.evaluate(() => document.querySelectorAll('.card-node[data-state="live"] .app-surface[data-live]').length >= 1), 8000);
await drag(apps[0], "running-app-60");
await centreOn(apps[2], 0.6);
await rest();
await drag(apps[2], "sleeping-app-60");
await page.close().catch(() => {});
process.exit(0);
