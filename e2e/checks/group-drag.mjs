/**
 * Two cards selected together (a click and a Shift-click, or a box drawn round them) and dragged by one of them both move, by the same amount, and stay
 * where they were dropped: neither is drawn back where it was picked up while the server answers,
 * nor goes back and forth after. The person's report: "when multiple cards are selected, and I try
 * to move the group, it won't move, or it goes back and forth".
 *
 * Cards are pictures at this zoom, as when a person sees a few of them at once. The canvas frame's
 * writes are held back 400 ms, a far network's round trip, so a wrong frame lasts long enough to see.
 */
import { zoomStep } from "../backends-kit.mjs";
import { cardEdge, canvasFrame, editMode, onCanvasAt, open, resetStage, rest, say, settle } from "../harness.mjs";

const lag = { ms: 0 };

/** Zoomed out until at least two cards are pictures, clear of the chrome. */
async function twoPictures(page) {
	const canvas = await canvasFrame(page);
	const clear = () =>
		canvas.evaluate(() => {
			const pictured = new Set(JSON.parse(globalThis.__decksProbes.rust.cardLayer.picturedKey || "[]"));
			return window.__decksProbes
				.cards()
				.filter((one) => pictured.has(one.path) && one.rect.width > 40 && one.rect.x > 300 && one.rect.y > 60 && one.rect.right < innerWidth - 200 && one.rect.bottom < innerHeight - 160)
				.map((one) => ({ path: one.path, rect: one.rect.toJSON ? one.rect.toJSON() : one.rect }));
		});
	await page.mouse.move(700, 450);
	for (let i = 0; i < 24; i++) {
		if ((await clear()).length >= 2) break;
		await zoomStep(page, 60);
		await settle(page, 350);
	}
	await settle(page, 600);
	return clear();
}

/** A point on a card's picture that the press reaches: the card, not something over it, not the chrome. */
async function gripOf(page, path) {
	const canvas = await canvasFrame(page);
	const grip = await canvas.evaluate((path) => {
		const at = (x, y) => window.__decksProbes.pictureAt(x, y) === path || document.elementFromPoint(x, y)?.closest(".card-node")?.dataset.path === path;
		const r = window.__decksProbes.cards().find((one) => one.path === path).rect;
		for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.2], [0.3, 0.3], [0.7, 0.6], [0.2, 0.8]]) {
			const x = r.x + r.width * fx;
			const y = r.y + r.height * fy;
			if (at(x, y) && !document.elementFromPoint(x, y)?.closest("iframe, a, button, .pen-hit")) return { x, y };
		}
		return null;
	}, path);
	return grip && (await onCanvasAt(page, grip.x, grip.y)) ? grip : null;
}

const placed = (canvas, paths) =>
	canvas.evaluate((paths) => {
		const cards = globalThis.__decksProbes.rust.cardLayer.placedCards;
		return Object.fromEntries(paths.map((path) => {
			const one = cards.find((card) => card.path === path);
			return [path, one ? { x: one.x, y: one.y } : null];
		}));
	}, paths);

/**
 * Two cards picked, then dragged by the one `by` names. Picked as `how` says: "shift", a press on the
 * first and Shift and a press on the second; or "marquee", a box drawn round both from bare canvas.
 */
async function groupDrag(page, label, by, how = "shift") {
	const canvas = await canvasFrame(page);
	await editMode(page, true);
	const cards = await twoPictures(page);
	const grips = [];
	for (const card of cards) {
		const grip = await gripOf(page, card.path);
		if (grip) grips.push({ path: card.path, grip });
		if (grips.length === 2) break;
	}
	if (grips.length < 2) return say(`${label}: two cards on screen to pick up`, false, JSON.stringify(cards));
	const [a, b] = grips;
	const paths = [a.path, b.path];
	await page.keyboard.press("Escape");
	await editMode(page, true);
	if (how === "marquee") {
		const rects = cards.filter((card) => paths.includes(card.path)).map((card) => card.rect);
		const box = { x1: Math.min(...rects.map((r) => r.x)) - 24, y1: Math.min(...rects.map((r) => r.y)) - 24, x2: Math.max(...rects.map((r) => r.x + r.width)) + 24, y2: Math.max(...rects.map((r) => r.y + r.height)) + 24 };
		// From bare canvas: nothing drawn and no card under the press.
		const bare = await canvas.evaluate(({ x, y }) => !window.__decksProbes.pictureAt(x, y) && !document.elementFromPoint(x, y)?.closest(".card-node, .pen-hit, iframe, a, button"), { x: box.x1, y: box.y1 });
		if (!bare || !(await onCanvasAt(page, box.x1, box.y1))) return say(`${label}: bare canvas to start the box from`, false, JSON.stringify(box));
		await page.mouse.move(box.x1, box.y1);
		await page.mouse.down();
		await page.mouse.move(box.x2, box.y2, { steps: 12 });
		await page.mouse.up();
	} else {
		await page.mouse.click(a.grip.x, a.grip.y);
		await settle(page, 200);
		await page.keyboard.down("Shift");
		await page.mouse.click(b.grip.x, b.grip.y);
		await page.keyboard.up("Shift");
	}
	await settle(page, 300);
	const picks = await canvas.evaluate(() => [...document.querySelectorAll(".card-node")].filter((n) => n.dataset.selected === "true").map((n) => n.dataset.path));
	const from = await placed(canvas, paths);
	// Every frame from the press: where the engine draws each card (its box plus the carried offset while carried).
	await canvas.evaluate((paths) => {
		const engine = globalThis.__decksProbes.rust;
		globalThis.__groupFrames = [];
		globalThis.__groupSampling = true;
		const sample = () => {
			const carried = engine.cardLayer.carriedCount > 0;
			const by = carried ? engine.cardLayer.carriedBy : { dx: 0, dy: 0 };
			const carriedPaths = new Set(engine.cardLayer.carriedPaths ?? []);
			const frame = { t: performance.now() };
			for (const path of paths) {
				const box = engine.cardLayer.placedCards.find((one) => one.path === path);
				const on = carried && (carriedPaths.size === 0 || carriedPaths.has(path));
				frame[path] = box ? [box.x + (on ? by.dx : 0), box.y + (on ? by.dy : 0)] : null;
			}
			globalThis.__groupFrames.push(frame);
			if (globalThis.__groupSampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}, paths);
	const zoom = await canvas.evaluate(() => globalThis.__decksProbes.rust.camera.zoom);
	// Held by the first card or the second; an awake card by its edge band or its bar, a picture anywhere on it.
	const held = by === "second" ? b : a;
	const live = (await canvas.locator(`.card-node[data-path="${held.path}"] .card-host`).count()) > 0;
	const bar = async () => {
		const box = await canvas.locator(`.card-node[data-path="${held.path}"] .plain-card-bar`).boundingBox().catch(() => null);
		return box && (await onCanvasAt(page, box.x + box.width / 2, box.y + box.height / 2)) ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
	};
	const start = live ? ((await cardEdge(page, held.path)) ?? (await bar())) : held.grip;
	if (!start) return say(`${label}: a place to hold the ${by} card by`, false, held.path);
	const step = { x: 14, y: 8 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) {
		await page.mouse.move(start.x + i * step.x, start.y + i * step.y);
		await page.waitForTimeout(25);
	}
	await page.waitForTimeout(150);
	lag.ms = 400;
	const dropAt = await canvas.evaluate(() => performance.now());
	await page.mouse.up();
	await page.waitForTimeout(2500);
	lag.ms = 0;
	const frames = await canvas.evaluate(() => {
		globalThis.__groupSampling = false;
		return globalThis.__groupFrames;
	});
	const to = await placed(canvas, paths);
	const want = { dx: (12 * step.x) / zoom, dy: (12 * step.y) / zoom };
	for (const path of paths) {
		const dx = to[path].x - from[path].x;
		const dy = to[path].y - from[path].y;
		// Snapping may pull it a little; the offset the hand made, give or take 12 screen px.
		const near = Math.abs(dx - want.dx) <= 12 / zoom && Math.abs(dy - want.dy) <= 12 / zoom;
		say(`${label}: ${path === held.path ? "the card held" : "the other card"} moved with the hand`, near, JSON.stringify({ from: from[path], to: to[path], want, picks }));
	}
	say(`${label}: both moved by the same amount`, Math.abs(to[a.path].x - from[a.path].x - (to[b.path].x - from[b.path].x)) <= 1 && Math.abs(to[a.path].y - from[a.path].y - (to[b.path].y - from[b.path].y)) <= 1, JSON.stringify({ from, to }));
	const after = frames.filter((f) => f.t > dropAt);
	const back = (at, x, y) => at && Math.hypot(at[0] - x[0], at[1] - x[1]) < Math.hypot(at[0] - y[0], at[1] - y[1]);
	for (const path of paths) {
		const drawnBack = after.filter((f) => back(f[path], [from[path].x, from[path].y], [to[path].x, to[path].y]));
		say(`${label}: ${path === held.path ? "the card held" : "the other card"} is never drawn back where it was picked up after the drop`, after.length > 20 && drawnBack.length === 0, `${drawnBack.length} of ${after.length} frames, first ${JSON.stringify(drawnBack[0])}`);
	}
	await settle(page, 300);
}

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await page.route(/\/api\/v1\/canvas\./, async (route) => {
	const ms = lag.ms;
	if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
	await route.continue();
});
await rest(page, { start: 0 });
await groupDrag(page, "Chromium, held by the first card", "first");
await groupDrag(page, "Chromium, held by the second card", "second");
await groupDrag(page, "Chromium, boxed, held by the first card", "first", "marquee");
await groupDrag(page, "Chromium, boxed, held by the second card", "second", "marquee");
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
