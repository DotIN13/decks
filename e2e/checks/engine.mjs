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
	link.close();
	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
