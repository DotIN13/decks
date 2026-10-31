/**
 * The arrow keys, pressed fast and held, on drawn items and on boards, with the server's answers
 * held back: every press moves what is selected one step at once, and the server ends where the
 * presses add up to.
 *
 * The page's socket is routed and every message from the server held back `lag` ms, and the
 * answer to each `canvas.batch` call (how the page sends a person's edit) as long. For each case a
 * key is held for `REPEATS` repeats `GAP` ms apart (the page sees one keydown, then repeats, as a
 * held key gives), and every animation frame it is written down where the selection is drawn (the
 * engine's laid-out box for an item, its board box and page for a board). After each keydown the
 * drawing must show the step within `WITHIN` frames, never stand still for more than that while
 * presses are owed, and once everything has landed the server's drawing (read over a socket of
 * the check's own) must have each moved by the sum of the presses; nothing may be drawn going back
 * from the first press until a while after the last answer landed.
 * Cases: one board selected by a press on its picture (held, and with Shift for steps of 10), two
 * boards, one item (held, pressed, Shift), two items, and two items with a board picked beside them.
 *
 * The canvas is in its frame (`canvasFrame`), which sends the person's edits itself (`canvas.batch`,
 * held back here) and follows the drawing on a stream of its own, which is not held back.
 *
 *   node e2e/run.mjs nudge
 *   NUDGE_ENGINES=chromium NUDGE_LAGS=400 node e2e/run.mjs nudge
 */
import { API, asPerson, canvasFrame, liveZoom, onCanvasAt, open, rest, resetStage, say, settle, socket } from "../harness.mjs";

const REPEATS = 30;
const GAP = 30;
/** Frames a step may take to be drawn after its keydown. */
const WITHIN = 2;

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const lag = { ms: 0, queued: 0 };
async function lagged(page) {
	/*
	 * A far network's latency, not its bandwidth: each message reaches the page `ms` after the server
	 * sent it, in order (never before the one before it), however many come at once.
	 */
	let last = 0;
	const later = (ms, deliver) => {
		lag.queued++;
		const at = Math.max(Date.now() + ms, last);
		last = at;
		setTimeout(() => {
			lag.queued--;
			deliver();
		}, at - Date.now());
	};
	await page.routeWebSocket(/\/ws/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => server.send(message));
		server.onMessage((message) => later(lag.ms, () => ws.send(message)));
	});
	// The answer to an edit sent over HTTP held back as long (its request goes at once).
	await page.route(/\/api\/v1\/canvas\.batch/, async (route) => {
		const ms = lag.ms;
		lag.queued++;
		try {
			const response = await route.fetch();
			if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
			await route.fulfill({ response });
		} catch {
			await route.abort().catch(() => {});
		} finally {
			lag.queued--;
		}
	});
	await page.reload({ waitUntil: "load" });
	await rest(page, { start: 300 });
}

/** In the page: every frame, where each probed thing is drawn; every keydown's time. */
const SAMPLER = () => {
	const r = (n) => Math.round(n);
	const nd = {
		frames: [],
		keys: [],
		on: false,
		where(probe) {
			const e = globalThis.__decksRust;
			const out = {};
			if (!e) return out;
			const shown = e.shown ? new Map(JSON.parse(e.shown)) : undefined;
			for (const id of probe.items ?? []) {
				const p = e.placed.get(id);
				if (!p) continue;
				const preview = e.lifted?.has(id) ? shown?.get(id) : undefined;
				const moveOnly = preview && preview.w === undefined && preview.h === undefined && preview.radius === undefined && !(preview.set && Object.keys(preview.set).length);
				out[id] = [r(p.box.x + (moveOnly ? (preview.dx ?? 0) : 0)), r(p.box.y + (moveOnly ? (preview.dy ?? 0) : 0))];
			}
			const carrying = e.carriedCount > 0 ? e.carriedBy : { dx: 0, dy: 0 };
			for (const path of probe.boards ?? []) {
				const b = e.placedCards.find((one) => one.path === path);
				if (b) out[path] = [r(b.x + carrying.dx), r(b.y + carrying.dy)];
			}
			return out;
		},
		start(probe) {
			nd.frames = [];
			nd.keys = [];
			nd.on = true;
			const tick = () => {
				if (!nd.on) return;
				nd.frames.push({ t: performance.now(), s: nd.where(probe) });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		stop() {
			nd.on = false;
			return { frames: nd.frames, keys: nd.keys };
		},
	};
	addEventListener("keydown", (event) => nd.on && event.key.startsWith("Arrow") && nd.keys.push(performance.now()), true);
	globalThis.__nd = nd;
};

async function run(engine, lags) {
	const { browser, page, errors } = await open({ width: 1400, height: 900, ...(engine === "webkit" ? { engine: "webkit" } : {}) });
	await page.addInitScript(SAMPLER);
	await rest(page, { start: 0 });
	await lagged(page);
	await liveZoom(page);
	/** The canvas frame, where the stage, its engine and the sampler are. */
	const cv = () => canvasFrame(page);
	const link = await socket();
	const agentId = await until(() => link.last("agents")?.focused);
	const send = (ops) => link.send({ type: "stage.pen.edit", agentId, ops });
	// The server's drawing on this socket from the start, to read where things are.
	link.send({ type: "stage.pen.get", agentId });
	await until(() => link.last("stage.pen"), 4000);
	/** The server's drawing, as the check's own socket last had it. */
	const serverNode = (id) => {
		const doc = link.last("stage.pen")?.doc;
		const find = (nodes) => {
			for (const node of nodes ?? []) {
				if (node.id === id) return node;
				const inner = find(node.children);
				if (inner) return inner;
			}
		};
		return find(doc?.children);
	};

	/**
	 * One case: what is selected held on `key` for `REPEATS` repeats (`shift` for the bigger step).
	 * `things` are what moves: `{ id }` an item, `{ path }` a board, each with where it starts.
	 */
	const hold = async (name, probe, key, step, { shift = false, pressBy = "hold" } = {}) => {
		if (process.env.NUDGE_ONLY && !`${name} ${pressBy}${shift ? " shift" : ""}`.includes(process.env.NUDGE_ONLY)) return;
		for (const ms of lags) {
			const label = `${engine}: ${name}, ${pressBy === "hold" ? "held" : "pressed"} ${REPEATS} times${shift ? " with Shift" : ""}, answers ${ms} ms away`;
			await settle(page, 300);
			const start = await (await cv()).evaluate((probe) => globalThis.__nd.where(probe), probe);
			const startServer = Object.fromEntries((probe.items ?? []).map((id) => [id, [serverNode(id)?.x, serverNode(id)?.y]]));
			const startBoards = await serverBoards();
			lag.ms = ms;
			await (await cv()).evaluate((probe) => globalThis.__nd.start(probe), probe);
			if (shift) await page.keyboard.down("Shift");
			if (pressBy === "hold") {
				for (let i = 0; i < REPEATS; i++) {
					await page.keyboard.down(key);
					await page.waitForTimeout(GAP);
				}
				await page.keyboard.up(key);
			} else
				for (let i = 0; i < REPEATS; i++) {
					await page.keyboard.press(key);
					await page.waitForTimeout(GAP);
				}
			if (shift) await page.keyboard.up("Shift");
			// Sampled on until every answer has landed and a while after: what lands must not take a step back.
			lag.ms = 0;
			await page.waitForTimeout(ms + 200);
			await until(() => lag.queued === 0, 20000);
			await settle(page, 800);
			const { frames, keys } = await (await cv()).evaluate(() => globalThis.__nd.stop());
			const [dx, dy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
			const total = keys.length * step;
			const ids = Object.keys(start);
			// Each keydown drawn within WITHIN frames: the n-th press's position reached by the frame WITHIN after it.
			const late = [];
			const along = (s, id) => (dx ? s[id]?.[0] - start[id][0] : s[id]?.[1] - start[id][1]) * (dx || dy);
			keys.forEach((t, n) => {
				const after = frames.filter((f) => f.t > t);
				const by = after[WITHIN];
				if (!by) return;
				for (const id of ids) if (!(along(by.s, id) >= (n + 1) * step)) late.push({ press: n + 1, id, drawn: along(by.s, id), frame: after.findIndex((f) => along(f.s, id) >= (n + 1) * step) });
			});
			const backwards = [];
			for (let i = 1; i < frames.length; i++) for (const id of ids) if (along(frames[i].s, id) < along(frames[i - 1].s, id)) backwards.push({ frame: i, id, from: along(frames[i - 1].s, id), to: along(frames[i].s, id) });
			const end = await (await cv()).evaluate((probe) => globalThis.__nd.where(probe), probe);
			const endBoards = await serverBoards();
			const server = {};
			for (const id of probe.items ?? []) server[id] = (dx ? serverNode(id)?.x - startServer[id][0] : serverNode(id)?.y - startServer[id][1]) * (dx || dy);
			for (const path of probe.boards ?? []) server[path] = endBoards[path] && startBoards[path] ? (dx ? endBoards[path].x - startBoards[path].x : endBoards[path].y - startBoards[path].y) * (dx || dy) : undefined;
			const drawnEnd = Object.fromEntries(ids.map((id) => [id, along(end, id)]));
			say(`${label}: each press is drawn within ${WITHIN} frames`, keys.length === REPEATS && late.length === 0, `${keys.length} keydowns; late ${late.length}: ${JSON.stringify(late.slice(0, 6))}`);
			say(`${label}: nothing is drawn going back`, backwards.length === 0, JSON.stringify(backwards.slice(0, 6)));
			say(`${label}: drawn and on the server ${total} along at the end`, ids.every((id) => drawnEnd[id] === total && server[id] === total), JSON.stringify({ total, drawnEnd, server }));
			// Back where it started, untimed, for the next lag.
			const back = { ArrowRight: "ArrowLeft", ArrowLeft: "ArrowRight", ArrowDown: "ArrowUp", ArrowUp: "ArrowDown" }[key];
			for (let i = 0; i < keys.length; i++) {
				if (shift) await page.keyboard.down("Shift");
				await page.keyboard.press(back);
				if (shift) await page.keyboard.up("Shift");
			}
			await settle(page, 600);
		}
	};
	const person = await asPerson();
	const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) })).json();
	/** The boards as the server's drawing has them (its `decks.board` items), by path. */
	const serverBoards = async () => {
		const out = {};
		for (const node of link.last("stage.pen")?.doc?.children ?? []) if (node.type === "browser" && node.metadata?.type === "decks.board") out[String(node.metadata.path ?? node.id)] = { x: node.x, y: node.y };
		return out;
	};

	// Two boards on screen, picked by a press on their pictures (the second with Shift): the whole canvas framed first.
	await (await cv()).locator("[aria-label='Fit everything on the canvas']").first().click();
	await rest(page);
	const onScreen = await until(
		async () =>
			(await cv()).evaluate(() =>
				window
					.__decksCards()
					.filter((one) => one.rect.width >= 40 && one.rect.x >= 120 && one.rect.y >= 60 && one.rect.right <= innerWidth - 140 && one.rect.bottom <= innerHeight - 120)
					.map((one) => one.path),
			),
		6000,
	);
	/** A point on a board's picture that is the canvas's, not the page's chrome over it. */
	const pictureSpot = async (path) => {
		const points = await (await cv()).evaluate((wanted) => {
			const r = window.__decksCards?.().find((one) => one.path === wanted)?.rect;
			const out = [];
			if (!r) return out;
			for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fx of [0.5, 0.3, 0.7]) {
				const x = r.x + r.width * fx;
				const y = r.y + r.height * fy;
				if (window.__decksPictureAt?.(x, y) === wanted) out.push({ x, y });
			}
			// The stage may not name the picture under a point while items are selected: its middle, then.
			if (!out.length) out.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
			return out;
		}, path);
		for (const at of points) if (await onCanvasAt(page, at.x, at.y)) return at;
		return null;
	};
	const pickBoard = async (path, shift) => {
		const grip = await pictureSpot(path);
		if (!grip) return false;
		if (shift) await page.keyboard.down("Shift");
		await page.mouse.click(grip.x, grip.y);
		if (shift) await page.keyboard.up("Shift");
		return true;
	};
	const boardsHere = [];
	for (const path of onScreen ?? []) if (boardsHere.length < 2 && (await pictureSpot(path))) boardsHere.push(path);
	if (process.env.NUDGE_BOARDS !== "0" && boardsHere.length) {
		await pickBoard(boardsHere[0], false);
		await hold("one board", { boards: [boardsHere[0]] }, "ArrowRight", 1);
		await hold("one board", { boards: [boardsHere[0]] }, "ArrowDown", 10, { shift: true });
		if (boardsHere[1]) {
			await pickBoard(boardsHere[1], true);
			await hold("two boards", { boards: boardsHere }, "ArrowRight", 1, { pressBy: "press" });
		}
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
	} else say(`${engine}: boards on screen to nudge`, false, JSON.stringify(onScreen));

	// Items, on bare canvas right of the boards at 100%.
	const spot = await (await cv()).evaluate(() => ({ x: Math.max(...globalThis.__decksRust.placedCards.map((b) => b.x + b.w), 0) + 4000, y: 0 }));
	let there = false;
	for (let i = 0; i < 4 && !there; i++) {
		await call("view.move", [{ x: spot.x, y: spot.y, zoom: 1 }]);
		there = !!(await until(async () => (await cv()).evaluate((x) => Math.abs(globalThis.__decksRust.camera.zoom - 1) < 0.01 && Math.abs(globalThis.__decksRust.camera.x - x) < 2000, spot.x), 4000));
	}
	say(`${engine}: the camera is on bare canvas at 100%`, there);
	await settle(page, 600);
	const cam = await (await cv()).evaluate(() => globalThis.__decksRust.camera);
	const at = (dx, dy, w, h) => ({ x1: Math.round(cam.x + dx), y1: Math.round(cam.y + dy), x2: Math.round(cam.x + dx + w), y2: Math.round(cam.y + dy + h) });
	send([
		{ op: "insert", node: { type: "rectangle", id: "nd-a", fill: "#4c8bf5" }, box: at(-300, -150, 120, 80) },
		{ op: "insert", node: { type: "rectangle", id: "nd-b", fill: "#f5a04c" }, box: at(-300, 50, 120, 80) },
	]);
	await until(async () => (await cv()).evaluate(() => ["nd-a", "nd-b"].every((id) => globalThis.__decksRust.placed.has(id))), 6000);
	await settle(page, 400);
	const centre = async (id) => {
		const b = await until(async () => (await cv()).evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id), 4000);
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};
	const a = await centre("nd-a");
	await page.mouse.click(a.x, a.y);
	await hold("one item", { items: ["nd-a"] }, "ArrowRight", 1);
	await hold("one item", { items: ["nd-a"] }, "ArrowRight", 1, { pressBy: "press" });
	await hold("one item", { items: ["nd-a"] }, "ArrowUp", 10, { shift: true });
	const b = await centre("nd-b");
	await page.keyboard.down("Shift");
	await page.mouse.click(b.x, b.y);
	await page.keyboard.up("Shift");
	await hold("two items", { items: ["nd-a", "nd-b"] }, "ArrowLeft", 1);
	// A board and items together: the first board picked with Shift beside the two items, at a zoom that shows it.
	if (process.env.NUDGE_BOARDS !== "0" && boardsHere.length) {
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		const board = await (await cv()).evaluate((path) => globalThis.__decksRust.placedCards.find((one) => one.path === path), boardsHere[0]);
		send([
			{ op: "update", id: "nd-a", set: { x: Math.round(board.x + board.w + 80), y: Math.round(board.y) } },
			{ op: "update", id: "nd-b", set: { x: Math.round(board.x + board.w + 80), y: Math.round(board.y + 200) } },
		]);
		const to = { x: Math.round(board.x + board.w / 2 + 150), y: Math.round(board.y + 150), zoom: 0.5 };
		let moved = false;
		for (let i = 0; i < 4 && !moved; i++) {
			await call("view.move", [to]);
			moved = !!(await until(async () => (await cv()).evaluate((to) => Math.abs(globalThis.__decksRust.camera.zoom - to.zoom) < 0.01 && Math.abs(globalThis.__decksRust.camera.x - to.x) < 50, to), 4000));
		}
		say(`${engine}: the camera shows the board and the items at 50%`, moved);
		await settle(page, 800);
		const ca = await centre("nd-a");
		await page.mouse.click(ca.x, ca.y);
		const cb = await centre("nd-b");
		await page.keyboard.down("Shift");
		await page.mouse.click(cb.x, cb.y);
		await page.keyboard.up("Shift");
		await pickBoard(boardsHere[0], true);
		await settle(page, 200);
		await hold("a board and two items", { items: ["nd-a", "nd-b"], boards: [boardsHere[0]] }, "ArrowDown", 1);
	}
	send([{ op: "delete", id: "nd-a" }, { op: "delete", id: "nd-b" }]);
	say(`${engine}: no errors on the page`, errors.length === 0, errors.join(" | "));
	link.close?.();
	await browser.close();
}

const engines = (process.env.NUDGE_ENGINES ?? "chromium,webkit").split(",");
const lags = (process.env.NUDGE_LAGS ?? "0,100,400").split(",").map(Number);
for (const engine of engines) {
	await resetStage();
	await run(engine, lags);
}
await resetStage();
