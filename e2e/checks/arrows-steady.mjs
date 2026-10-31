/**
 * Arrows hold still through an edit: on a diagram of cards and boxes joined by arrows, an edit leaves
 * every arrow it does not touch as it was on every frame, and moves the ones it does touch once, to
 * where they end up.
 *
 * The diagram is as an agent draws one: cards (frames of markdown, sized by their words) and boxes,
 * joined by straight and elbow arrows, some kept to a side. Each edit (a nudge, a drag, a resize, a
 * fill colour, words typed in a note, an agent's edit elsewhere) is made with the server's messages
 * and the edit call's answer 0 and 400 ms away (the canvas frame follows the drawing on a stream of
 * its own, which is not held back), and every frame for 1.5 s from the event that makes
 * it it is written down where each arrow is drawn (its box in the engine's layout, which a drag's
 * bend moves too, and its path). A frame is wrong for an arrow when an arrow the edit leaves alone is
 * not where it was, when an arrow the edit moves is neither where it was nor where it ends, or is
 * back where it was after it has been where it ends, or when an arrow is not drawn at all.
 *
 *   node e2e/run.mjs arrows-steady
 *   ARROWS_ENGINES=chromium ARROWS_LAGS=400 node e2e/run.mjs arrows-steady
 */
import { API, asPerson, canvasFrame, liveZoom, open, rest, resetStage, say, settle, socket } from "../harness.mjs";

const WINDOW = 1500;

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 60));
	}
};

/** The server's messages to the page `lag.ms` late, in order, and the answer to an edit call as late (as `nudge.mjs`). */
const lag = { ms: 0, queued: 0 };
async function lagged(page) {
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

/** In the page: where each arrow is drawn, every frame, from the committing event on. */
const SAMPLER = () => {
	const r = (n) => Math.round(n * 2) / 2;
	const as = {
		frames: [],
		on: false,
		armed: false,
		commitAt: Infinity,
		where(ids) {
			const e = globalThis.__decksRust;
			const out = {};
			for (const id of ids) {
				const p = e?.placed.get(id);
				if (!p) {
					out[id] = "absent";
					continue;
				}
				// A lifted arrow (a drag's bend) is drawn from its laid-out box, not the drawing's path.
				const path = e.lifted?.has(id) ? "" : ` ${p.node.geometry}`;
				out[id] = `${r(p.box.x)},${r(p.box.y)},${r(p.box.w)},${r(p.box.h)}${path}`;
			}
			return out;
		},
		start(ids) {
			as.frames = [];
			as.on = true;
			const tick = () => {
				if (!as.on) return;
				as.frames.push({ t: performance.now(), s: as.where(ids) });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		arm() {
			as.commitAt = Infinity;
			as.armed = true;
		},
		now() {
			as.commitAt = performance.now();
			as.armed = false;
		},
		stop() {
			as.on = false;
			return { frames: as.frames, commitAt: as.commitAt };
		},
	};
	for (const type of ["pointerup", "keydown", "click"])
		addEventListener(
			type,
			(event) => {
				if (!as.armed || ["Shift", "Control", "Meta", "Alt"].includes(event.key)) return;
				as.armed = false;
				as.commitAt = performance.now();
			},
			true,
		);
	globalThis.__as = as;
};

const card = (id, title, lines, x, y, width = 340) => ({
	op: "insert",
	node: {
		type: "frame",
		id,
		name: id,
		layout: "vertical",
		gap: 12,
		padding: 22,
		cornerRadius: 12,
		width,
		fill: "#1f2430",
		metadata: { type: "decks.card" },
		children: [
			{ type: "text", id: `${id}-0`, content: `## ${title}`, fontSize: 17, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } },
			{ type: "text", id: `${id}-1`, content: lines.map((line) => `- ${line}`).join("\n"), fontSize: 17, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } },
		],
	},
	box: { x1: x, y1: y },
});
const arrow = (id, from, to, more = {}) => ({ op: "insert", node: { type: "path", id, geometry: "M0 0 L1 1", strokeWidth: 2.5, metadata: { type: "decks.arrow", from, to, ...more } } });

async function run(engine, lags) {
	const { browser, page, errors } = await open({ width: 1500, height: 950, ...(engine === "webkit" ? { engine: "webkit" } : {}) });
	/** The canvas frame, asked for each time: a reload makes it again. */
	const cv = () => canvasFrame(page);
	await page.addInitScript(SAMPLER);
	await rest(page, { start: 0 });
	await lagged(page);
	await liveZoom(page);
	const link = await socket();
	const agentId = await until(() => link.last("agents")?.focused);
	const send = (ops) => link.send({ type: "stage.pen.edit", agentId, ops });
	const person = await asPerson();
	const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) })).json();

	// Bare canvas right of the boards, at 100%.
	const spot = await (await cv()).evaluate(() => ({ x: Math.max(...globalThis.__decksRust.placedCards.map((b) => b.x + b.w), 0) + 4000, y: 0 }));
	let there = false;
	for (let i = 0; i < 4 && !there; i++) {
		await call("view.move", [{ x: spot.x, y: spot.y, zoom: 1 }]);
		there = !!(await until(async () => (await cv()).evaluate((x) => Math.abs(globalThis.__decksRust.camera.zoom - 1) < 0.01 && Math.abs(globalThis.__decksRust.camera.x - x) < 2000, spot.x), 4000));
	}
	say(`${engine}: the camera is on bare canvas at 100%`, there);
	await settle(page, 600);
	const cam = await (await cv()).evaluate(() => globalThis.__decksRust.camera);
	const X = (dx) => Math.round(cam.x + dx);
	const Y = (dy) => Math.round(cam.y + dy);

	// A diagram like an agent's: six cards sized by their words, two boxes and a note, nine arrows.
	send([
		card("as-web", "Browser", ["**apps/web**: the canvas", "talks to the server over /ws"], X(-700), Y(-420)),
		card("as-ext", "Extension", ["shares one tab"], X(-200), Y(-420), 300),
		card("as-server", "Server", ["**/ws**: one socket", "**/api/v1**: the calls", "writes the deck folder"], X(-700), Y(-120)),
		card("as-agents", "Agents", ["five runtimes", "`decks` is the SDK"], X(-200), Y(-120), 300),
		card("as-folder", "The deck folder", ["canvases and boards", "everything lives here"], X(-700), Y(200)),
		card("as-studio", "Studio", ["sync-client", "hub"], X(-200), Y(200), 300),
		{ op: "insert", node: { type: "rectangle", id: "as-box-a", fill: "#2b3240", cornerRadius: 8 }, box: { x1: X(260), y1: Y(-380), x2: X(400), y2: Y(-300) } },
		{ op: "insert", node: { type: "rectangle", id: "as-box-b", fill: "#2b3240", cornerRadius: 8 }, box: { x1: X(400), y1: Y(-60), x2: X(540), y2: Y(20) } },
		{ op: "insert", node: { type: "note", id: "as-note", content: "Some words" }, box: { x1: X(260), y1: Y(180), x2: X(500), y2: Y(260) } },
		arrow("as-a1", { item: "as-web", side: "bottom", at: 0.35 }, { item: "as-server", side: "top", at: 0.35 }),
		arrow("as-a2", { item: "as-ext", side: "bottom" }, { item: "as-server", side: "top", at: 0.85 }, { route: "elbow", label: "one shared tab" }),
		arrow("as-a3", "as-agents", "as-server", { heads: "both", label: "calls" }),
		arrow("as-a4", { item: "as-server", side: "bottom", at: 0.35 }, { item: "as-folder", side: "top", at: 0.35 }),
		arrow("as-a5", { item: "as-agents", side: "bottom" }, { item: "as-folder", side: "top", at: 0.85 }, { route: "elbow" }),
		arrow("as-a6", "as-folder", "as-studio"),
		arrow("as-a7", "as-ext", "as-box-a", { route: "elbow" }),
		arrow("as-a8", "as-box-a", "as-box-b", { route: "elbow" }),
		arrow("as-a9", "as-box-b", "as-note", { route: "curved" }),
	]);
	const arrows = ["as-a1", "as-a2", "as-a3", "as-a4", "as-a5", "as-a6", "as-a7", "as-a8", "as-a9"];
	const drawn = await until(async () => (await cv()).evaluate((ids) => ids.every((id) => globalThis.__decksRust.placed.get(id)?.node.geometry !== "M0 0 L1 1"), arrows), 8000);
	say(`${engine}: the diagram is drawn, its arrows routed by the server`, !!drawn);
	await settle(page, 800);

	const centre = async (id) => {
		const b = await until(async () => (await cv()).evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id), 4000);
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};
	const clickOn = async (id) => {
		const c = await centre(id);
		await page.mouse.click(c.x, c.y);
		await settle(page, 200);
	};
	const drag = async (from, to, steps = 10) => {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) {
			await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
			await page.waitForTimeout(16);
		}
		await page.waitForTimeout(80);
	};
	const handle = async (selector) => {
		const r = await until(async () => (await cv()).evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON(), selector), 3000);
		if (!r) throw new Error(`no ${selector}`);
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	};
	const escape = async () => {
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
	};
	const totals = { wrong: 0, frames: 0 };
	const rows = [];

	/** One edit at each lag: `setup` at no lag, then `prepare` (a gesture up to its commit), then the lag and `commit`; `undo` puts it back. */
	const edit = async (name, { setup, prepare, commit, undo }) => {
		if (process.env.ARROWS_ONLY && !name.includes(process.env.ARROWS_ONLY)) return;
		for (const ms of lags) {
			const label = `${engine}: ${name}, answers ${ms} ms away`;
			try {
				if (setup) await setup();
				await settle(page, 300);
				if (prepare) await prepare();
				await settle(page, 200);
				const before = await (await cv()).evaluate((ids) => globalThis.__as.where(ids), arrows);
				await (await cv()).evaluate((ids) => globalThis.__as.start(ids), arrows);
				lag.ms = ms;
				await commit(async () => (await cv()).evaluate(() => globalThis.__as.arm()));
				await page.waitForTimeout(WINDOW);
				lag.ms = 0;
				await until(() => lag.queued === 0, 15000);
				await settle(page, 600);
				const { frames, commitAt } = await (await cv()).evaluate(() => globalThis.__as.stop());
				const after = await (await cv()).evaluate((ids) => globalThis.__as.where(ids), arrows);
				const later = frames.filter((f) => f.t >= commitAt);
				const wrong = [];
				const reached = new Set();
				// A lifted arrow is known by its box alone: two samples agree when their boxes do and, if both have one, their paths.
				const eq = (a, b) => {
					if (a === b) return true;
					const [boxA, pathA] = [a.split(" ")[0], a.includes(" ")];
					const [boxB, pathB] = [b.split(" ")[0], b.includes(" ")];
					return boxA === boxB && !(pathA && pathB);
				};
				later.forEach((f, i) => {
					for (const id of arrows) {
						const s = f.s[id];
						let bad;
						if (s === "absent") bad = "not drawn";
						else if (eq(before[id], after[id])) bad = !eq(s, before[id]) ? "moved, though the edit leaves it" : undefined;
						else if (eq(s, after[id])) reached.add(id);
						else if (!eq(s, before[id])) bad = "at a route it does not end on";
						else if (reached.has(id)) bad = "back where it was";
						if (bad) wrong.push({ frame: i, id, bad, s, before: before[id], after: after[id] });
					}
				});
				const frameCount = new Set(wrong.map((w) => w.frame)).size;
				const moved = arrows.filter((id) => !eq(before[id], after[id]));
				totals.wrong += frameCount;
				totals.frames += later.length;
				rows.push({ engine, edit: name, lag: ms, frames: later.length, wrongFrames: frameCount, arrowsWrong: [...new Set(wrong.map((w) => w.id))], moved });
				say(`${label}: made, in ${later.length} frames sampled`, Number.isFinite(commitAt) && later.length > 20, JSON.stringify({ commitAt, frames: later.length }));
				say(`${label}: no frame draws an arrow missing, at a passing route, or back (${moved.length} of ${arrows.length} arrows move)`, frameCount === 0, `${frameCount} of ${later.length} frames wrong; ${JSON.stringify(wrong.slice(0, 3))}`);
			} catch (error) {
				lag.ms = 0;
				say(`${label}: ran`, false, error instanceof Error ? error.stack : String(error));
				await (await cv()).evaluate(() => globalThis.__as?.stop()).catch(() => {});
			}
			try {
				await escape();
				if (undo) await undo();
				await until(() => lag.queued === 0, 15000);
				await settle(page, 500);
			} catch {
				/* the next one starts from what is there */
			}
		}
	};

	await edit("an agent's edit away from the arrows", {
		commit: async () => {
			await (await cv()).evaluate(() => globalThis.__as.now());
			send([{ op: "insert", node: { type: "rectangle", id: "as-elsewhere", fill: "#4c8bf5" }, box: { x1: X(300), y1: Y(-260), x2: X(380), y2: Y(-200) } }]);
		},
		undo: async () => {
			send([{ op: "delete", id: "as-elsewhere" }]);
			await until(async () => (await cv()).evaluate(() => !globalThis.__decksRust.placed.has("as-elsewhere")), 4000);
		},
	});
	await edit("a box nudged with an arrow key", {
		setup: () => clickOn("as-box-b"),
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Shift+ArrowRight");
		},
		undo: async () => {
			await clickOn("as-box-b");
			await page.keyboard.press("Shift+ArrowLeft");
		},
	});
	await edit("a card nudged with an arrow key", {
		setup: () => clickOn("as-studio"),
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Shift+ArrowDown");
		},
		undo: async () => {
			await clickOn("as-studio");
			await page.keyboard.press("Shift+ArrowUp");
		},
	});
	await edit("a card dragged", {
		setup: () => clickOn("as-agents"),
		prepare: async () => {
			const c = await centre("as-agents");
			await drag(c, { x: c.x + 60, y: c.y + 30 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		undo: async () => {
			const c = await centre("as-agents");
			await drag(c, { x: c.x - 60, y: c.y - 30 });
			await page.mouse.up();
		},
	});
	await edit("a box resized by a corner", {
		setup: () => clickOn("as-box-a"),
		prepare: async () => {
			const h = await handle('.pen-handle[data-handle="se"]:not([data-page])');
			await drag(h, { x: h.x + 40, y: h.y + 30 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		undo: () => send([{ op: "update", id: "as-box-a", set: { width: 140, height: 80 } }]),
	});
	await edit("a box's fill colour from the properties", {
		setup: async () => {
			await clickOn("as-box-b");
			await (await cv()).locator(".props-panel").first().waitFor({ timeout: 3000 });
		},
		commit: async (arm) => {
			const swatch = (await cv()).locator('.props-panel .props-swatches button[aria-pressed="false"]').nth(2);
			await swatch.waitFor({ timeout: 3000 });
			const r = await swatch.boundingBox();
			await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
			await arm();
			await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
		},
		undo: () => send([{ op: "update", id: "as-box-b", set: { fill: "#2b3240" } }]),
	});
	await edit("words typed in a note", {
		prepare: async () => {
			const c = await centre("as-note");
			await page.mouse.dblclick(c.x, c.y);
			await until(async () => (await cv()).evaluate(() => !!document.activeElement?.closest(".pen-text")), 3000);
			await page.keyboard.press("End");
			await page.keyboard.type(" more");
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Control+Enter");
		},
		undo: () => send([{ op: "update", id: "as-note", set: { content: "Some words" } }]),
	});

	if (process.env.ARROWS_TABLE) console.log(JSON.stringify(rows));
	console.log(`${engine}: ${totals.wrong} wrong frames of ${totals.frames} sampled`);
	say(`${engine}: no errors on the page`, errors.length === 0, errors.join(" | "));
	link.close?.();
	await browser.close();
}

const engines = (process.env.ARROWS_ENGINES ?? "chromium,webkit").split(",");
const lags = (process.env.ARROWS_LAGS ?? "0,400").split(",").map(Number);
for (const engine of engines) {
	await resetStage();
	await run(engine, lags);
}
await resetStage();
