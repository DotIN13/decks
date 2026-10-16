/**
 * The C++ stage engine (`packages/engine`, `canvas/engine-stage.ts`), switched on: boards zoomed out
 * are drawn by it under their pages, and the worker's sheet, with no drawing to paint, stays hidden.
 *
 * Headless Chromium here has no WebGPU adapter without extra flags, so this runs the WebGL 2 path;
 * `packages/engine/test/run.mjs` checks both backends' pixels on their own.
 */
import { open, resetStage, say, settle, socket } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open();
try {
	const url = new URL(page.url());
	url.searchParams.set("engine", "on");
	await page.goto(url.href);
	await settle(page, 2500);
	const link = await socket();
	const boards = ["plan.html", "notes.html", "risks.html", "sources.html"];
	for (const path of boards) link.send({ type: "board.play", path: `boards/${path}` });
	await settle(page, 1500);
	say("the engine's canvas is under the world", await page.evaluate(() => {
		const canvas = document.querySelector(".stage-engine");
		const world = document.querySelector(".world");
		return !!canvas && !!world && !!(canvas.compareDocumentPosition(world) & Node.DOCUMENT_POSITION_FOLLOWING);
	}));

	// Out to where the boards are pictures, not pages.
	await page.mouse.move(800, 450);
	await page.keyboard.down("Control");
	for (let i = 0; i < 10; i++) {
		await page.mouse.wheel(0, 120);
		await settle(page, 100);
	}
	await page.keyboard.up("Control");
	const until = async (test, ms = 10000) => {
		const end = Date.now() + ms;
		for (;;) {
			const value = await test();
			if (value || Date.now() > end) return value;
			await settle(page, 200);
		}
	};
	/*
	 * Pictures come from the server's screenshot queue, which on a fresh fixture is still making them:
	 * waited for longer than a frame needs, and one is enough to show the path works.
	 */
	const stats = await until(() => page.evaluate(() => {
		const s = globalThis.__decksEngine?.stats();
		return s && s.pictures >= 1 && s.drawn[0] >= 3 ? s : undefined;
	}), 20000);
	say("the engine started on a backend", !!stats?.backend, JSON.stringify(stats));
	say("it fetched the boards' pictures", (stats?.pictures ?? 0) >= 1, JSON.stringify(stats));
	say("and drew them", (stats?.drawn?.[0] ?? 0) >= 3, JSON.stringify(stats?.drawn));
	say("each at the size it shows, not whole", (stats?.bytes ?? Infinity) < 16 * 1024 * 1024, `${Math.round((stats?.bytes ?? 0) / 1024)} KB`);
	say(
		"the worker's sheet stays hidden, with only boards on the stage",
		await page.evaluate(() => document.querySelector(".stage-sheet")?.hidden === true && globalThis.__decksSheet?.ck !== true),
		String(JSON.stringify(await page.evaluate(() => globalThis.__decksSheet ?? null))).slice(0, 200),
	);
	/*
	 * Picking by the C++ scene: a press on a drawn square selects it, and a press inside a diagonal
	 * line's box but well off the line does not, as the browser's own path test answered before.
	 */
	const agentId = await until(() => link.last("agents")?.focused);
	const at = await page.evaluate(() => {
		const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
		const toStage = (x, y) => ({ x: (x - m.e) / m.a, y: (y - m.f) / m.a });
		return { zoom: m.a, square: toStage(500, 300), line: toStage(900, 300) };
	});
	const side = Math.round(120 / at.zoom);
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: [
			{ op: "insert", node: { type: "rectangle", id: "e2e-pick-square", fill: "#bfdbfe" }, box: { x1: Math.round(at.square.x), y1: Math.round(at.square.y), x2: Math.round(at.square.x) + side, y2: Math.round(at.square.y) + side } },
			{ op: "insert", node: { type: "path", id: "e2e-pick-line", geometry: "M0 0 L100 100", stroke: "#333", strokeWidth: 2 }, box: { x1: Math.round(at.line.x), y1: Math.round(at.line.y), x2: Math.round(at.line.x) + side * 2, y2: Math.round(at.line.y) + side * 2 } },
		],
	});
	await until(() => page.evaluate(() => (globalThis.__decksEngine?.stats().tiles ?? 0) > 0));
	await settle(page, 600);
	const handles = () => page.evaluate(() => document.querySelectorAll('.pen-handle:not([data-handle="radius"])').length);
	// Off the line, in the empty corner of its box: nothing.
	await page.mouse.click(900 + 200, 300 + 30);
	await settle(page, 400);
	say("a press in a line's box but off the line selects nothing", (await handles()) === 0, String(await handles()));
	await page.mouse.click(560, 360);
	const picked = await until(() => handles().then((n) => n === 8));
	say("a press on a drawn square selects it", !!picked, String(await handles()));
	const picking = await page.evaluate(() => globalThis.__decksSheet?.picking);
	say("and the C++ scene answered it", typeof picking === "string" && picking.startsWith("c++"), String(picking));
	/*
	 * Delete takes it off the screen at once, with the camera still: it used to stay drawn until the
	 * next pan or zoom. Read off a screenshot, since the engine's canvas keeps no buffer to read.
	 */
	const blueAt = async (x, y) => {
		const png = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString("base64");
		const [r, g, b] = await page.evaluate(async (data) => {
			const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
			const canvas = new OffscreenCanvas(1, 1);
			const context = canvas.getContext("2d");
			context.drawImage(bitmap, 0, 0);
			return [...context.getImageData(0, 0, 1, 1).data];
		}, png);
		return b > 200 && r < 215 && b - r > 25 ? `blue ${r},${g},${b}` : "";
	};
	const before = await blueAt(560, 360);
	await page.keyboard.press("Delete");
	await settle(page, 800);
	const after = await blueAt(560, 360);
	say("Delete takes a drawn square off the screen without a pan", !!before && !after, `before ${before || "not blue"}, after ${after || "gone"}`);
	await page.keyboard.press("Escape");
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "e2e-pick-square" }, { op: "delete", id: "e2e-pick-line" }] });
	await settle(page, 600);

	/*
	 * Boards picked by a box and dragged go with the pointer as pictures: the engine draws them, and a
	 * board mounted only to be dragged had paper of its own over the picture it carried, while the
	 * pictures stayed where the drag began until it let go.
	 */
	const colourAt = async (x, y) => {
		const png = (await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } })).toString("base64");
		return page.evaluate(async (data) => {
			const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
			const context = new OffscreenCanvas(1, 1).getContext("2d");
			context.drawImage(bitmap, 0, 0);
			return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(",");
		}, png);
	};
	// Opened again at this zoom, so the boards are pictures that never had a page, as when a canvas is opened zoomed out.
	await page.reload();
	await settle(page, 3000);
	await page.mouse.move(800, 450);
	await page.keyboard.down("Control");
	for (let i = 0; i < 10; i++) {
		await page.mouse.wheel(0, 120);
		await settle(page, 60);
	}
	await page.keyboard.up("Control");
	await settle(page, 2500);
	const pictured = await page.evaluate(() => window.__decksBoards().map((b) => ({ path: b.path, r: b.rect })).filter((b) => b.r.width > 24 && b.r.x > 340 && b.r.x + b.r.width < 1150 && b.r.y > 100 && b.r.y + b.r.height < 760));
	say("there is a board picture to drag", pictured.length > 0, JSON.stringify(await page.evaluate(() => window.__decksBoards().map((b) => [Math.round(b.rect.x), Math.round(b.rect.y), Math.round(b.rect.width)]))));
	if (pictured.length > 0) {
		const one = pictured[0].r;
		const ground = await colourAt(1250, 760);
		const from = { x: one.x + one.width / 2, y: one.y + one.height / 2 };
		const shift = { x: one.width + 40, y: 0 };
		await page.mouse.move(one.x - 12, one.y - 12);
		await page.mouse.down();
		await page.mouse.move(one.x + one.width + 6, one.y + one.height + 6, { steps: 6 });
		await page.mouse.up();
		await settle(page, 400);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (shift.x * i) / 8, from.y, { steps: 2 });
		await settle(page, 400);
		const left = await colourAt(from.x, from.y);
		const carried = await colourAt(from.x + shift.x, from.y);
		const held = await page.evaluate((path) => {
			const carry = globalThis.__decksEngine?.carried;
			const papers = [...document.querySelectorAll('.board-node[data-dragging="true"] > .surface')].filter((surface) => !surface.querySelector(":scope > iframe")).map((surface) => getComputedStyle(surface).backgroundColor);
			return { carrying: !!carry && carry.paths.has(path) && carry.dx !== 0, papers };
		}, pictured[0].path);
		await page.mouse.up();
		await settle(page, 600);
		say("a box-picked board's picture goes with the drag, and nothing stays where it was", left === ground && carried !== ground, `ground ${ground}, where it was ${left}, where it went ${carried}`);
		say("…the engine carries it, and a dragged board with no page paints no paper over it", held.carrying && held.papers.every((paint) => paint === "rgba(0, 0, 0, 0)"), JSON.stringify(held));
		await page.keyboard.press("Escape");
	}
	link.close();
	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
