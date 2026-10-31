/**
 * A dragged item is put down after its drop. While held it is lifted: drawn by the page each frame,
 * left out of the worker's tiles, and the worker paints only the screen. Once the drawing that answers
 * the drop arrives it goes back into the tiles (`engine.ts`, `settle`), so the page stops drawing it
 * and the worker paints the margin and the overview again.
 *
 * Dropped into a slot of a frame that arranges its children, it glides from where it was let go to
 * where it lands, and the siblings that make room glide too (`editor/core/glide.ts`). Its outline
 * glides with it, frame by frame, rather than jumping ahead to where it lands.
 *
 * A board dragged and let go stays where it was dropped until the server's answer has it there
 * (`editor/core/gesture.ts`, `holdBoards`): the engine's picture of it, sampled every frame with the
 * canvas frame's writes held back 400 ms, never goes back to where it was picked up. A board is only
 * ever its picture; in Chromium and in WebKit.
 *
 * The canvas runs in its frame (`canvasFrame`), which reads and writes the canvas on its own line to
 * the harness: the stage is read there, and its writes are what is held back.
 */
import { zoomStep } from "../backends-kit.mjs";
import { cardEdge, canvasFrame, editMode, onCanvasAt, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

/**
 * The canvas frame's writes to the canvas held back while `lag.ms` is set: a round trip as slow as a
 * far network's, so what the stage shows between a drop and its answer lasts long enough to see. The
 * frame sends an edit as a verb call (`/api/v1/canvas.…`) and hears it back on its own stream, so a
 * write held back is an answer held back.
 */
const lag = { ms: 0 };
async function laggedSocket(page) {
	await page.route(/\/api\/v1\/canvas\./, async (route) => {
		const ms = lag.ms;
		if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
		await route.continue();
	});
}

/**
 * A board dragged by its edge (live) or its picture, let go, and where it is drawn every frame for
 * 1.5 s after: its node's box on screen and the engine's box for its picture (the board's box plus
 * the carried offset while carried). None may be back at the box it was picked up from.
 */
async function boardStaysDropped(page, label, { picture }) {
	const canvas = await canvasFrame(page);
	// The server draws the pictures, and a busy machine takes a while: wait for one on screen before looking.
	if (picture) await canvas.waitForFunction(() => JSON.parse(globalThis.__decksRust?.picturedKey || "[]").length > 0, null, { timeout: 15000 }).catch(() => {});
	const candidates = await canvas.evaluate((picture) => {
		const pictured = new Set(JSON.parse(globalThis.__decksRust.picturedKey || "[]"));
		return window.__decksCards()
			.filter((one) => {
				const r = one.rect;
				return pictured.has(one.path) === picture && r.width >= 40 && r.x >= 300 && r.y >= 60 && r.right <= innerWidth - 200 && r.bottom <= innerHeight - 160;
			})
			.map((one) => one.path);
	}, picture);
	let pick;
	let grip;
	for (const path of candidates) {
		// A board shown as a picture has no node, so no edge band to hold: it is picked up by its picture.
		const hasNode = (await canvas.locator(`.card-node[data-path="${path}"]`).count()) > 0;
		grip = hasNode ? await cardEdge(page, path) : null;
		grip ??= await canvas.evaluate((path) => {
			const at = (x, y) => window.__decksPictureAt(x, y) === path || document.elementFromPoint(x, y)?.closest(".card-node")?.dataset.path === path;
			const r = window.__decksCards().find((one) => one.path === path).rect;
			for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.3], [0.7, 0.5], [0.5, 0.5], [0.2, 0.8]]) {
				const x = r.x + r.width * fx;
				const y = r.y + r.height * fy;
				// Not where something drawn lies over it (the check's own note, say): a press there is the drawing's.
				if (at(x, y) && !document.elementFromPoint(x, y)?.closest("iframe, a, button, .pen-hit")) return { x, y };
			}
			return null;
		}, path);
		// And not under the page's side panel, bars or composer, which the frame cannot see.
		if (grip && !(await onCanvasAt(page, grip.x, grip.y))) grip = null;
		if (grip) {
			pick = { path };
			break;
		}
	}
	if (!pick) return say(`${label}: a board on screen to pick up`, false, JSON.stringify(await canvas.evaluate(() => ({ zoom: globalThis.__decksRust.camera.zoom, pictured: globalThis.__decksRust.picturedKey, boards: window.__decksCards().map((b) => [Math.round(b.rect.x), Math.round(b.rect.y), Math.round(b.rect.width)]) }))));
	const from = await canvas.evaluate((path) => {
		const board = globalThis.__decksRust.placedCards.find((one) => one.path === path);
		return { x: board.x, y: board.y };
	}, pick.path);
	await canvas.evaluate((path) => {
		const engine = globalThis.__decksRust;
		globalThis.__boardFrames = [];
		globalThis.__boardSampling = true;
		const sample = () => {
			const node = document.querySelector(`.card-node[data-path="${CSS.escape(path)}"]`);
			const box = engine.placedCards.find((one) => one.path === path);
			const carried = engine.carriedCount > 0;
			globalThis.__boardFrames.push({
				t: performance.now(),
				node: node ? [node.getBoundingClientRect().x, node.getBoundingClientRect().y] : null,
				drawn: box ? [box.x + (carried ? engine.carriedBy.dx : 0), box.y + (carried ? engine.carriedBy.dy : 0)] : null,
			});
			if (globalThis.__boardSampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}, pick.path);
	const startNode = await canvas.evaluate((path) => document.querySelector(`.card-node[data-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().toJSON(), pick.path);
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) {
		await page.mouse.move(grip.x + i * 12, grip.y + i * 6);
		await page.waitForTimeout(25);
	}
	await page.waitForTimeout(100);
	lag.ms = 400;
	const dropAt = await canvas.evaluate(() => performance.now());
	await page.mouse.up();
	await page.waitForTimeout(1500);
	lag.ms = 0;
	const frames = await canvas.evaluate(() => {
		globalThis.__boardSampling = false;
		return globalThis.__boardFrames;
	});
	const after = frames.filter((f) => f.t > dropAt);
	const to = await canvas.evaluate((path) => {
		const board = globalThis.__decksRust.placedCards.find((one) => one.path === path);
		return { x: board.x, y: board.y };
	}, pick.path);
	say(`${label}: the board moved`, Math.abs(to.x - from.x) > 20 && Math.abs(to.y - from.y) > 10, JSON.stringify({ from, to }));
	// Nearer where it was picked up than where it was dropped: drawn back at the old place.
	const back = (at, a, b) => at && Math.hypot(at[0] - a[0], at[1] - a[1]) < Math.hypot(at[0] - b[0], at[1] - b[1]);
	const drawnBack = after.filter((f) => back(f.drawn, [from.x, from.y], [to.x, to.y]));
	say(`${label}: the engine never draws it back where it was picked up after the drop`, after.length > 20 && drawnBack.length === 0, `${drawnBack.length} of ${after.length} frames, first ${JSON.stringify(drawnBack[0])}, ${JSON.stringify({ from, to })}`);
	if (startNode) {
		const endNode = after.at(-1)?.node;
		const nodeBack = after.filter((f) => endNode && back(f.node, [startNode.x, startNode.y], endNode));
		say(`${label}: …nor its page`, !!endNode && nodeBack.length === 0, `${nodeBack.length} of ${after.length} frames, first ${JSON.stringify(nodeBack[0])}, picked up at ${[startNode.x, startNode.y]}, landed at ${endNode}`);
	}
	await settle(page, 300);
}

/** Zoomed out until the boards are pictures, not pages. */
async function zoomToPictures(page) {
	const canvas = await canvasFrame(page);
	for (let i = 0; i < 16; i++) {
		if (await canvas.evaluate(() => window.__decksCards().some((one) => JSON.parse(globalThis.__decksRust.picturedKey || "[]").includes(one.path) && one.rect.width > 40 && one.rect.x > 300 && one.rect.y > 60 && one.rect.right < innerWidth - 200 && one.rect.bottom < innerHeight - 160))) break;
		await zoomStep(page, 60);
		await settle(page, 350);
	}
	await settle(page, 600);
}

/**
 * Live, and small enough that a whole board fits between the chrome: just over the live zoom (50%),
 * with the narrowest board in the middle of the candidates' box (x 300..width-200, y 60..height-160).
 * Moved with the mouse as a person would: the pan while every board is still a picture (a wheel over
 * a live page scrolls the page), then a pinch (Control and the wheel) about that middle, which keeps
 * the board where it is.
 */
async function liveAndSmall(page) {
	const view = page.viewportSize();
	const canvas = await canvasFrame(page);
	const zoom = () => canvas.evaluate(() => globalThis.__decksRust.camera.zoom);
	const middle = { x: (300 + view.width - 200) / 2, y: (60 + view.height - 160) / 2 };
	await page.mouse.move(middle.x, middle.y);
	const pinch = async (dy) => {
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, dy);
		await page.keyboard.up("Control");
		await settle(page, 120);
	};
	for (let i = 0; i < 40 && (await zoom()) > 0.45; i++) await pinch(40);
	await rest(page).catch(() => {});
	const off = await canvas.evaluate((middle) => {
		const narrowest = window.__decksCards().sort((a, b) => a.rect.width - b.rect.width)[0];
		if (!narrowest) return null;
		const r = narrowest.rect;
		return { dx: r.x + r.width / 2 - middle.x, dy: r.y + r.height / 2 - middle.y };
	}, middle);
	if (off) await page.mouse.wheel(off.dx, off.dy);
	await rest(page).catch(() => {});
	for (let i = 0; i < 40 && (await zoom()) < 0.52; i++) await pinch(-10);
	await rest(page).catch(() => {});
	await settle(page, 600);
}

async function boardDrops(page, engine) {
	await laggedSocket(page);
	await editMode(page, true);
	// A board is never live now, only its picture: small enough that a whole board fits between the chrome.
	await liveAndSmall(page);
	await zoomToPictures(page);
	await boardStaysDropped(page, `${engine}, a board shown as a picture`, { picture: true });
}

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const canvas = await canvasFrame(page);
/*
 * The check draws round the middle of the window, so the view is moved first onto bare canvas right
 * of the fixture's cards (stacked, their right-hand edges at x 1600): what it draws then lies over no
 * card, and the cards are left clear for the drops at the end.
 */
{
	const opening = await canvas.evaluate(() => globalThis.__decksRust.camera);
	await page.mouse.move(700, 450);
	await page.mouse.wheel((2900 - opening.x) * opening.zoom, 0);
	await rest(page).catch(() => {});
	await settle(page, 300);
}
const cam = await canvas.evaluate(() => globalThis.__decksRust.camera);
const r = await canvas.evaluate(() => document.querySelector(".stage").getBoundingClientRect().toJSON());
// The engine's camera is the stage point at the middle of the window: a box there.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "lift-a", fill: "#4c8bf5" }, box: { x1: cam.x - 60 / cam.zoom, y1: cam.y - 40 / cam.zoom, x2: cam.x + 60 / cam.zoom, y2: cam.y + 40 / cam.zoom } }] });
say("the box is drawn", !!(await until(() => canvas.evaluate(() => globalThis.__decksRust?.placed.get("lift-a")))));
await editMode(page, true);
const x = r.left + r.width / 2;
const y = r.top + r.height / 2;
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
	await page.mouse.move(x + i * 10, y + i * 5);
	await page.waitForTimeout(30);
}
const during = await canvas.evaluate(() => [...globalThis.__decksRust.lifted]);
say("dragged, the box is lifted", during.includes("lift-a"), JSON.stringify(during));
const before = await canvas.evaluate(() => globalThis.__decksRust.placed.get("lift-a").box);
await page.mouse.up();
const down = await until(async () => (await canvas.evaluate(() => globalThis.__decksRust.lifted.size)) === 0, 4000);
say("dropped, it is put down once the saved drawing has come", down);
const moved = await canvas.evaluate(() => globalThis.__decksRust.placed.get("lift-a").box);
say("…where it was dropped", moved.x > before.x && moved.y > before.y, JSON.stringify({ before, moved }));

// Into a column's slot: the outline rides the glide.
{
	const z = cam.zoom;
	const rect = (id, fill) => ({ type: "rectangle", id, fill, width: 160, height: 50 });
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: [
			{ op: "insert", node: { type: "frame", id: "lift-col", name: "Column", layout: "vertical", gap: 10, padding: 12, fill: "#eeeeee", children: [rect("lift-r1", "#88aaff"), rect("lift-r2", "#88ffaa"), rect("lift-r3", "#ffcc88")] }, box: { x1: cam.x + 260 / z, y1: cam.y - 260 / z, x2: cam.x + 444 / z, y2: cam.y - 60 / z } },
			// Clear of the side panel (360px since the redesign): at -420 its middle was under it, and the press picked nothing.
			{ op: "insert", node: { type: "rectangle", id: "lift-b", fill: "#ff3355" }, box: { x1: cam.x - 300 / z, y1: cam.y + 120 / z, x2: cam.x - 200 / z, y2: cam.y + 180 / z } },
		],
	});
	const box = (id) => canvas.evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id);
	await until(async () => (await box("lift-r3")) && (await box("lift-b")));
	await settle(page, 600);
	await page.keyboard.press("Escape");
	const b = await box("lift-b");
	const r1 = await box("lift-r1");
	const r2 = await box("lift-r2");
	await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
	await settle(page, 300);
	// Every frame from here: the selection's outline, and where the engine last said the item glides from.
	await canvas.evaluate(() => {
		const engine = globalThis.__decksRust;
		const own = engine.onGlide;
		engine.onGlide = (shifts) => {
			globalThis.__lastGlide = shifts;
			own?.(shifts);
		};
		globalThis.__frames = [];
		globalThis.__sampling = true;
		const sample = () => {
			const outline = document.querySelector(".pen-selection")?.getBoundingClientRect();
			const drawn = globalThis.__decksPenBox?.("lift-b");
			const shift = globalThis.__lastGlide?.get("lift-b");
			if (shift && outline && drawn) {
				const zoom = engine.camera.zoom;
				globalThis.__frames.push({ outline: [outline.x, outline.y], item: [drawn.x + shift.dx * zoom, drawn.y + shift.dy * zoom], shift: [shift.dx, shift.dy] });
			}
			if (globalThis.__sampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	const sx = b.x + b.width / 2;
	const sy = b.y + b.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx + 20, sy - 20, { steps: 3 });
	await page.mouse.move(r1.x + 60, (r1.y + r1.height + r2.y) / 2, { steps: 20 });
	await settle(page, 200);
	await page.mouse.up();
	const joined = await until(async () => (await canvas.evaluate(() => globalThis.__decksRust.placed.get("lift-b")?.parent)) === "lift-col", 4000);
	await settle(page, 400);
	const frames = await canvas.evaluate(() => {
		globalThis.__sampling = false;
		return globalThis.__frames;
	});
	say("dropped into the column's slot, the item joins it", joined);
	const moving = frames.filter((f) => Math.abs(f.shift[0]) > 0.5 || Math.abs(f.shift[1]) > 0.5);
	say("…and glides there over several frames", moving.length >= 3, `${moving.length} gliding frames`);
	const off = frames.filter((f) => Math.abs(f.outline[0] - f.item[0]) > 1 || Math.abs(f.outline[1] - f.item[1]) > 1);
	say("…its outline riding with it on every frame of the glide", frames.length > 0 && off.length === 0, JSON.stringify(off.slice(0, 3)));
	link.send({ type: "stage.pen.edit", agentId, ops: ["lift-col", "lift-b"].map((id) => ({ op: "delete", id })) });
	await settle(page, 300);
}

link.close?.();
await boardDrops(page, "Chromium");
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();

{
	const { browser, page, errors } = await open({ width: 1400, height: 900, engine: "webkit" });
	await rest(page, { start: 0 });
	await boardDrops(page, "WebKit");
	say("no errors on the page in WebKit", errors.length === 0, errors.join(" | "));
	await browser.close();
}
