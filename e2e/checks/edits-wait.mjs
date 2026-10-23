/**
 * Every edit a person makes on the canvas, with the server's answer held back: does the screen show
 * the drawing as it was before the edit until the answer comes?
 *
 * The page's socket is routed and every message from the server is held back `LAG` ms (a far
 * network's round trip, as Studio over the tailnet). For each operation the stage is set up over
 * the socket, the edit is made by input (a drag, a key, a click in a panel), and every animation
 * frame from the moment of the committing event (the pointer let go, the key pressed) for 1.5 s it is
 * written down what is drawn: the engine's box and fields for the items the edit touches (its laid
 * out drawing, `__decksRust.placed`), how many items there are, a board's box in the engine and its
 * page on screen, and the selection's outline. A frame shows the old state when any of those is as
 * it was before the edit and is not as it is once everything has landed.
 *
 * The person's edits are shown at once and kept on top of the server's drawings until the one that
 * has them arrives (`packages/canvas/src/drawing.ts`), so every case asks for no frame of the old
 * state. A board made from a file is the server's to make (`board.create`) and is not driven here.
 *
 *   node e2e/run.mjs edits-wait                       # Chromium, then WebKit for a few
 *   EDITS_WAIT_TABLE=1 node e2e/run.mjs edits-wait    # and the table, as JSON, for a report
 */
import { API, asPerson, boardEdge, liveZoom, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const LAG = 400;
const WINDOW = 1500;

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

/** The server's messages to the page held back while `lag.ms` is set, in order (as `drop-lands.mjs`). */
const lag = { ms: 0, queued: 0 };
async function laggedSocket(page) {
	let queue = Promise.resolve();
	await page.routeWebSocket(/\/ws/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => server.send(message));
		server.onMessage((message) => {
			const ms = lag.ms;
			lag.queued++;
			queue = queue.then(() => (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined)).then(() => {
				lag.queued--;
				ws.send(message);
			});
		});
	});
	await page.reload({ waitUntil: "load" });
	await rest(page, { start: 300 });
}

/**
 * The sampler, in the page: `__ew.sample(probe)` is what is drawn for a probe now, part by part;
 * `start` samples it every frame, and `armCommit` takes the time of the next committing event.
 */
const SAMPLER = () => {
	const r = (n) => Math.round(n);
	const ew = {
		frames: [],
		commitAt: Infinity,
		armed: false,
		sample(probe) {
			const e = globalThis.__decksRust;
			const out = {};
			if (!e) return out;
			for (const id of probe.items ?? []) {
				const p = e.placed.get(id);
				if (!p) {
					out[`item ${id}`] = "absent";
					continue;
				}
				const { x: _x, y: _y, width: _w, height: _h, children: _c, ...fields } = p.node;
				/*
				 * What a gesture's preview draws over the layout: a move's offset (a move is drawn lifted, not
				 * laid out again) and a corner's radius; a resize is laid out already.
				 */
				const shown = e.shown ? new Map(JSON.parse(e.shown)) : undefined;
				const preview = e.lifted?.has(id) ? shown?.get(id) : undefined;
				const moveOnly = preview && preview.w === undefined && preview.h === undefined && preview.radius === undefined && !(preview.set && Object.keys(preview.set).length);
				const dx = moveOnly ? (preview.dx ?? 0) : 0;
				const dy = moveOnly ? (preview.dy ?? 0) : 0;
				if (preview?.radius !== undefined) fields.cornerRadius = Math.round(preview.radius);
				if (preview?.set) Object.assign(fields, preview.set);
				out[`item ${id}`] = JSON.stringify([r(p.box.x + dx), r(p.box.y + dy), r(p.box.w), r(p.box.h), p.parent ?? null]);
				out[`fields ${id}`] = JSON.stringify(fields);
				if (probe.order) out[`order ${id}`] = String(p.order);
			}
			if (probe.count) out.count = String([...e.placed.values()].filter((p) => !p.parent).length);
			for (const path of probe.boards ?? []) {
				const b = e.boards.find((one) => one.path === path);
				const carrying = e.carriedCount > 0 ? e.carriedBy : { dx: 0, dy: 0 };
				out[`board ${path}`] = b ? JSON.stringify([r(b.x + carrying.dx), r(b.y + carrying.dy), r(b.w), r(b.h)]) : "absent";
				const node = document.querySelector(`.board-node[data-path="${CSS.escape(path)}"]`);
				if (probe.page) {
					const n = node?.getBoundingClientRect();
					out[`page ${path}`] = n ? JSON.stringify([r(n.x), r(n.y), r(n.width), r(n.height)]) : "absent";
				}
			}
			if (probe.outline) {
				const o = document.querySelector(".pen-selection")?.getBoundingClientRect();
				out.outline = o ? JSON.stringify([r(o.x), r(o.y), r(o.width), r(o.height)]) : "none";
			}
			return out;
		},
		start(probe) {
			ew.frames = [];
			ew.commitAt = Infinity;
			ew.on = true;
			const tick = () => {
				if (!ew.on) return;
				ew.frames.push({ t: performance.now(), s: ew.sample(probe) });
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		armCommit() {
			ew.commitAt = Infinity;
			ew.armed = true;
		},
		stop() {
			ew.on = false;
			return { frames: ew.frames, commitAt: ew.commitAt };
		},
	};
	for (const type of ["pointerup", "keydown", "click"])
		addEventListener(
			type,
			(event) => {
				// A chord's modifier goes down first: the key that commits is the one after it.
				if (!ew.armed || ["Shift", "Control", "Meta", "Alt"].includes(event.key)) return;
				ew.armed = false;
				ew.commitAt = performance.now();
			},
			true,
		);
	globalThis.__ew = ew;
};

const results = [];

/**
 * One operation: `setup` over the socket with no lag, and what is to be edited selected; `before` is
 * sampled then. `prepare` is the gesture up to its commit, at no lag, as a person's hand is before
 * letting go; then the lag and `commit` (the event that makes the edit, `__ew.armCommit` called just before), and the
 * frames for `WINDOW`. `after` is sampled once the answer has landed with no lag.
 */
const ONLY = process.env.EDITS_WAIT_ONLY;
async function op(page, engine, name, { probe, setup, prepare, commit, cleanup, wait = 0 }) {
	if (ONLY && !name.includes(ONLY)) return;
	try {
		if (setup) await setup();
		await settle(page, 400);
		const before = await page.evaluate((probe) => globalThis.__ew.sample(probe), probe);
		if (prepare) await prepare();
		await settle(page, 250);
		await page.evaluate((probe) => globalThis.__ew.start(probe), probe);
		lag.ms = LAG;
		await commit(() => page.evaluate(() => globalThis.__ew.armCommit()));
		await page.waitForTimeout(WINDOW);
		lag.ms = 0;
		const { frames, commitAt } = await page.evaluate(() => globalThis.__ew.stop());
		// Everything held back has reached the page (each message waits its turn behind the one before).
		await until(() => lag.queued === 0, 15000);
		await settle(page, 600 + wait);
		const after = await page.evaluate((probe) => globalThis.__ew.sample(probe), probe);
		const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
		const later = frames.filter((f) => f.t > commitAt);
		const old = later.filter((f) => changed.some((k) => f.s[k] === before[k]));
		const which = [...new Set(old.flatMap((f) => changed.filter((k) => f.s[k] === before[k]).map((k) => k.split(" ")[0])))];
		const row = { engine, op: name, old: old.length, frames: later.length, parts: which, edited: changed.length > 0 };
		results.push(row);
		say(`${engine}: ${name}: it is made`, changed.length > 0 && Number.isFinite(commitAt), JSON.stringify({ before, after, commitAt }));
		say(`${engine}: ${name}: no frame shows it as it was, with the server's answer ${LAG} ms away`, old.length === 0 && later.length > 20, `${old.length} of ${later.length} frames old (${which.join(", ")}); first ${JSON.stringify(old[0]?.s)}`);
	} catch (error) {
		lag.ms = 0;
		say(`${engine}: ${name}: ran`, false, error instanceof Error ? error.stack : String(error));
		await page.evaluate(() => globalThis.__ew?.stop()).catch(() => {});
	}
	try {
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		if (cleanup) await cleanup();
		await settle(page, 300);
	} catch {
		/* the next case starts from what is there */
	}
}

async function run(engine, { all }) {
	const { browser, page, errors } = await open({ width: 1400, height: 900, ...(engine === "webkit" ? { engine: "webkit" } : {}) });
	await page.addInitScript(SAMPLER);
	await rest(page, { start: 0 });
	await laggedSocket(page);
	await liveZoom(page);
	const link = await socket();
	const agentId = await until(() => link.last("agents")?.focused);
	const send = (ops) => link.send({ type: "stage.pen.edit", agentId, ops });
	const cam = await page.evaluate(() => globalThis.__decksRust.camera);
	const z = cam.zoom;
	/** A box in stage units from screen pixels off the middle of the window. */
	const at = (dx, dy, w, h) => ({ x1: Math.round(cam.x + dx / z), y1: Math.round(cam.y + dy / z), x2: Math.round(cam.x + (dx + w) / z), y2: Math.round(cam.y + (dy + h) / z) });
	const rect = (id, dx, dy, w = 120, h = 80, fill = "#4c8bf5") => ({ op: "insert", node: { type: "rectangle", id, fill }, box: at(dx, dy, w, h) });
	const box = (id) => page.evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id);
	const centre = async (id) => {
		const b = await until(() => box(id), 4000);
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	};
	const drawn = (...ids) => until(() => page.evaluate((ids) => ids.every((id) => globalThis.__decksRust.placed.has(id)), ids), 6000);
	const gone = (...ids) => until(() => page.evaluate((ids) => ids.every((id) => !globalThis.__decksRust.placed.has(id)), ids), 6000);
	/** Each deleted on its own: one already gone (inside a frame deleted before it) does not keep the rest. */
	const del = async (...ids) => {
		for (const id of ids) send([{ op: "delete", id }]);
		await gone(...ids);
	};
	/** Clear of the panels and the boards: room in the middle of the window, which the camera centres. */
	const clickOn = async (id, mods = []) => {
		const c = await centre(id);
		for (const m of mods) await page.keyboard.down(m);
		await page.mouse.click(c.x, c.y);
		for (const m of mods) await page.keyboard.up(m);
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
		const r = await until(() => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().toJSON(), selector), 3000);
		if (!r) throw new Error(`no ${selector}`);
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	};
	/** The properties panel, which shows for what is selected (`pen/Properties.tsx`). */
	const properties = () => page.locator(".props-panel").first().waitFor({ timeout: 3000 });
	/** A button on the selection's pill, pressed with the commit armed. */
	const pillButton = async (label, arm) => {
		const button = page.locator(`.stage > .board-callout:not([data-hidden]) [aria-label="${label}"]`).first();
		await button.waitFor({ timeout: 3000 });
		const r = await button.boundingBox();
		await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
		await arm();
		await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
	};

	// Boards first, where the canvas opens on them.
	const pick = async () => {
		const paths = await page.evaluate(() =>
			window.__decksBoards()
				.filter((one) => one.node && one.rect.width >= 40 && one.rect.x >= 120 && one.rect.y >= 60 && one.rect.right <= innerWidth - 140 && one.rect.bottom <= innerHeight - 120)
				.map((one) => one.path),
		);
		for (const path of paths) {
			const grip = await boardEdge(page, path);
			if (grip) return { path, grip };
		}
		return undefined;
	};
	const board = await until(pick, 6000);
	if (!board) say(`${engine}: a board on screen to change`, false);
	else {
		const probe = { boards: [board.path], page: true };
		await op(page, engine, "a board moved by its edge", {
			probe,
			prepare: async () => {
				const grip = await boardEdge(page, board.path);
				await drag(grip, { x: grip.x + 120, y: grip.y + 60 }, 12);
			},
			commit: async (arm) => {
				await arm();
				await page.mouse.up();
			},
		});
		await op(page, engine, "a board resized by a corner", {
			probe,
			setup: async () => {
				const grip = await boardEdge(page, board.path);
				await page.mouse.click(grip.x, grip.y);
			},
			prepare: async () => {
				const h = await handle(`.pen-handle[data-handle="se"][data-board="${board.path}"]`);
				await drag(h, { x: h.x - 60, y: h.y - 40 }, 10);
			},
			commit: async (arm) => {
				await arm();
				await page.mouse.up();
			},
		});
		if (all) {
			await op(page, engine, "a board hidden from its pill", {
				probe,
				setup: async () => {
					const grip = await boardEdge(page, board.path);
					await page.mouse.click(grip.x, grip.y);
					await page.locator('.stage > .board-callout:not([data-hidden]) [aria-label="Hide"]').first().waitFor({ timeout: 3000 });
				},
				commit: async (arm) => {
					const r = await page.locator('.stage > .board-callout:not([data-hidden]) [aria-label="Hide"]').first().boundingBox();
					await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
					await arm();
					await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
				},
			});
		}
	}
	// The drawn items go on bare canvas to the right of every board, at 100%, where the camera is moved (`view.move`).
	const person = await asPerson();
	const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) })).json();
	const home = (await call("view.camera", [])).value;
	const spot = await page.evaluate(() => ({ x: Math.max(...globalThis.__decksRust.boards.map((b) => b.x + b.w), 0) + 4000, y: 0 }));
	let there = false;
	for (let i = 0; i < 4 && !there; i++) {
		const asked = await call("view.move", [{ x: spot.x, y: spot.y, zoom: 1 }]);
		there = !!(await until(() => page.evaluate((x) => Math.abs(globalThis.__decksRust.camera.zoom - 1) < 0.01 && Math.abs(globalThis.__decksRust.camera.x - x) < 2000, spot.x), 4000));
		if (!there) console.log(`view.move did not land (${JSON.stringify(asked)}); again`);
	}
	say(`${engine}: the camera is on bare canvas at 100%`, there);
	await settle(page, 600);
	const moved = await page.evaluate(() => globalThis.__decksRust.camera);
	Object.assign(cam, moved);
	const zz = moved.zoom;
	const at2 = (dx, dy, w, h) => ({ x1: Math.round(cam.x + dx / zz), y1: Math.round(cam.y + dy / zz), x2: Math.round(cam.x + (dx + w) / zz), y2: Math.round(cam.y + (dy + h) / zz) });
	const rect2 = (id, dx, dy, w = 120, h = 80, fill = "#4c8bf5") => ({ op: "insert", node: { type: "rectangle", id, fill }, box: at2(dx, dy, w, h) });
	const note2 = (id, dx, dy, content = "Some words") => ({ op: "insert", node: { type: "note", id, content }, box: at2(dx, dy, 240, 80) });
	void rect;

	const items = (...ids) => ({ items: ids });
	const madeIds = async (had) => (await page.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => !p.parent).map((p) => p.node.id))).filter((id) => !had.includes(id));
	let had = [];
	const remember = async () => {
		had = await page.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => !p.parent).map((p) => p.node.id));
	};
	const dropMade = async () => {
		const made = await madeIds(had);
		if (made.length) await del(...made);
	};

	await op(page, engine, "move an item", {
		probe: { items: ["ew-move"], outline: true },
		setup: async () => {
			send([rect2("ew-move", -200, -100)]);
			await drawn("ew-move");
			await clickOn("ew-move");
		},
		prepare: async () => {
			const c = await centre("ew-move");
			await drag(c, { x: c.x + 160, y: c.y + 90 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: () => del("ew-move"),
	});

	await op(page, engine, "resize an item by a corner", {
		probe: { items: ["ew-size"], outline: true },
		setup: async () => {
			send([rect2("ew-size", -200, -100)]);
			await drawn("ew-size");
			await clickOn("ew-size");
		},
		prepare: async () => {
			const h = await handle('.pen-handle[data-handle="se"]:not([data-board])');
			await drag(h, { x: h.x + 90, y: h.y + 60 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: () => del("ew-size"),
	});

	await op(page, engine, "nudge with an arrow key", {
		probe: { items: ["ew-nudge"], outline: true },
		setup: async () => {
			send([rect2("ew-nudge", -200, -100)]);
			await drawn("ew-nudge");
			await clickOn("ew-nudge");
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Shift+ArrowRight");
		},
		cleanup: () => del("ew-nudge"),
	});

	// An agent's edit reaches the server just before the person's, and the page while the person's is on its way.
	await op(page, engine, "nudge while an agent's edit lands first", {
		probe: items("ew-race"),
		setup: async () => {
			send([rect2("ew-race", -200, -100)]);
			await drawn("ew-race");
			await clickOn("ew-race");
		},
		commit: async (arm) => {
			send([note2("ew-agent", 200, 120, "An agent's note")]);
			await page.waitForTimeout(30);
			await arm();
			await page.keyboard.press("Shift+ArrowRight");
		},
		cleanup: async () => {
			const both = await page.evaluate(() => ({ note: globalThis.__decksRust.placed.has("ew-agent"), x: globalThis.__decksRust.placed.get("ew-race")?.box.x }));
			say(`${engine}: …and the agent's note and the person's nudge are both drawn once both have landed`, both.note && Math.abs(both.x - (Math.round(cam.x - 200 / zz) + 10)) < 1.5, JSON.stringify(both));
			await del("ew-race", "ew-agent");
		},
	});

	// The person's edit refused (an agent took the item away first): the server's drawing wins, at once.
	if (!ONLY || "refused".includes(ONLY)) {
		send([rect2("ew-refused", -200, -100)]);
		await drawn("ew-refused");
		await clickOn("ew-refused");
		await settle(page, 300);
		lag.ms = LAG;
		send([{ op: "delete", id: "ew-refused" }]);
		await page.waitForTimeout(60);
		await page.keyboard.press("Shift+ArrowRight");
		const shown = await until(() => page.evaluate(() => globalThis.__decksRust.placed.get("ew-refused")?.box.x), 300);
		const gone = await until(() => page.evaluate(() => !globalThis.__decksRust.placed.has("ew-refused")), 8000);
		lag.ms = 0;
		await until(() => lag.queued === 0, 15000);
		say(`${engine}: an edit the server refuses is shown at once, then the server's drawing (the item gone) wins`, shown !== undefined && gone, JSON.stringify({ shown, gone }));
		await page.keyboard.press("Escape");
		await settle(page, 300);
	}

	await op(page, engine, "delete with the key", {
		probe: items("ew-del"),
		setup: async () => {
			send([rect2("ew-del", -200, -100)]);
			await drawn("ew-del");
			await clickOn("ew-del");
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Backspace");
		},
	});

	await op(page, engine, "delete from the pill", {
		probe: items("ew-pilldel"),
		setup: async () => {
			send([rect2("ew-pilldel", -200, -100)]);
			await drawn("ew-pilldel");
			await clickOn("ew-pilldel");
		},
		commit: (arm) => pillButton("Delete", arm),
	});

	await op(page, engine, "duplicate from the pill", {
		probe: { count: true },
		setup: async () => {
			send([rect2("ew-pilldup", -200, -100)]);
			await drawn("ew-pilldup");
			await clickOn("ew-pilldup");
			await remember();
		},
		commit: (arm) => pillButton("Duplicate", arm),
		cleanup: async () => {
			await dropMade();
			await del("ew-pilldup");
		},
	});

	await op(page, engine, "duplicate (⌘D)", {
		probe: { count: true },
		setup: async () => {
			send([rect2("ew-dup", -200, -100)]);
			await drawn("ew-dup");
			await clickOn("ew-dup");
			await remember();
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("ControlOrMeta+d");
		},
		cleanup: async () => {
			await dropMade();
			await del("ew-dup");
		},
	});


	await op(page, engine, "a rectangle made with its tool (R, click)", {
		probe: { count: true },
		prepare: async () => {
			await remember();
			await page.keyboard.press("r");
			await page.mouse.move(cam.x ? 700 : 700, 450);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.click(700, 450);
		},
		cleanup: dropMade,
	});

	await op(page, engine, "a note made by a double-click on bare canvas", {
		probe: { count: true },
		setup: () => remember(),
		prepare: () => page.mouse.move(700, 450),
		commit: async (arm) => {
			await arm();
			await page.mouse.click(700, 450, { clickCount: 2 });
		},
		cleanup: async () => {
			await page.keyboard.press("Escape");
			await dropMade();
		},
	});

	await op(page, engine, "a note's words typed and saved (⌃↩)", {
		probe: items("ew-words"),
		setup: async () => {
			send([note2("ew-words", -200, -100, "Words before")]);
			await drawn("ew-words");
		},
		prepare: async () => {
			const c = await centre("ew-words");
			await page.mouse.dblclick(c.x, c.y);
			await until(() => page.evaluate(() => !!document.activeElement?.closest(".pen-text")), 3000);
			await page.keyboard.press("End");
			await page.keyboard.type(" and after");
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("Control+Enter");
		},
		cleanup: () => del("ew-words"),
	});

	await op(page, engine, "fill colour from the properties", {
		probe: items("ew-fill"),
		setup: async () => {
			send([rect2("ew-fill", -200, -100, 120, 80, "#4c8bf5")]);
			await drawn("ew-fill");
			await clickOn("ew-fill");
		},
		prepare: async () => {
			await properties();
		},
		commit: async (arm) => {
			const swatch = page.locator('.props-panel .props-swatches button[aria-pressed="false"]').nth(2);
			await swatch.waitFor({ timeout: 3000 });
			const r = await swatch.boundingBox();
			await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
			await arm();
			await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
		},
		cleanup: () => del("ew-fill"),
	});

	await op(page, engine, "bring to the front", {
		probe: { items: ["ew-back"], order: true },
		setup: async () => {
			send([rect2("ew-back", -200, -100), rect2("ew-front", -160, -70, 120, 80, "#f5a34c")]);
			await drawn("ew-back", "ew-front");
		},
		prepare: async () => {
			const b = await box("ew-back");
			await page.mouse.click(b.x + 10, b.y + 10);
			await properties();
		},
		commit: async (arm) => {
			const button = page.locator('.props-panel [aria-label="Bring to the front"]').first();
			const r = await button.boundingBox();
			await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
			await arm();
			await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
		},
		cleanup: () => del("ew-back", "ew-front"),
	});

	await op(page, engine, "align left edges", {
		probe: items("ew-al1", "ew-al2"),
		setup: async () => {
			send([rect2("ew-al1", -260, -140), rect2("ew-al2", -140, 0, 120, 80, "#f5a34c")]);
			await drawn("ew-al1", "ew-al2");
			await clickOn("ew-al1");
		},
		prepare: async () => {
			await clickOn("ew-al2", ["Shift"]);
			await properties();
		},
		commit: async (arm) => {
			const button = page.locator('.props-panel [aria-label="Align left edges"]').first();
			const r = await button.boundingBox();
			await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
			await arm();
			await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
		},
		cleanup: () => del("ew-al1", "ew-al2"),
	});

	const column = () => send([{ op: "insert", node: { type: "frame", id: "ew-col", name: "Column", layout: "vertical", gap: 10, padding: 12, fill: "#eeeeee", children: ["ew-r1", "ew-r2", "ew-r3"].map((id, i) => ({ type: "rectangle", id, fill: ["#88aaff", "#88ffaa", "#ffcc88"][i], width: 160, height: 50 })) }, box: at2(120, -200, 184, 200) }]);

	await op(page, engine, "drag into a frame's slot", {
		probe: items("ew-in"),
		setup: async () => {
			column();
			send([rect2("ew-in", -300, 60, 100, 50, "#ff3355")]);
			await drawn("ew-in", "ew-r3");
			await clickOn("ew-in");
		},
		prepare: async () => {
			const c = await centre("ew-in");
			const r1 = await box("ew-r1");
			const r2 = await box("ew-r2");
			await drag(c, { x: r1.x + 60, y: (r1.y + r1.height + r2.y) / 2 }, 20);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		wait: 400,
	});

	await op(page, engine, "drag out of a frame", {
		setup: async () => {
			await clickOn("ew-r1");
		},
		probe: items("ew-r1"),
		prepare: async () => {
			const c = await centre("ew-r1");
			await drag(c, { x: c.x - 380, y: c.y + 260 }, 20);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: () => del("ew-col", "ew-in", "ew-r1"),
	});

	await op(page, engine, "an arrow drawn from one item to another", {
		probe: { count: true },
		setup: async () => {
			send([rect2("ew-a", -300, -100), rect2("ew-b", 100, 60, 120, 80, "#f5a34c"), rect2("ew-c", 100, -200, 120, 80, "#88ffaa")]);
			await drawn("ew-a", "ew-b", "ew-c");
		},
		prepare: async () => {
			await remember();
			await page.keyboard.press("a");
			await drag(await centre("ew-a"), await centre("ew-b"), 12);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
	});
	const arrowId = (await madeIds(had))[0];

	if (arrowId) {
		await op(page, engine, "an arrow's end joined to another item", {
			probe: items(arrowId),
			prepare: async () => {
				await page.keyboard.press("Escape");
				// The arrow is picked by its middle handle's line: select it from the drawing's own selection, as a click on it does.
				const mid = await page.evaluate((id) => {
					const p = globalThis.__decksRust.placed.get(id);
					return p ? { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 } : undefined;
				}, arrowId);
				void mid;
				const a = await centre("ew-a");
				const b = await centre("ew-b");
				await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
				const end = await handle('.pen-handle[data-end="to"]');
				await drag(end, await centre("ew-c"), 12);
			},
			commit: async (arm) => {
				await arm();
				await page.mouse.up();
			},
		});

		await op(page, engine, "an arrow bent by its middle", {
			probe: items(arrowId),
			prepare: async () => {
				const a = await centre("ew-a");
				const c = await centre("ew-c");
				await page.mouse.click((a.x + c.x) / 2, (a.y + c.y) / 2);
				const bend = await handle(".pen-handle[data-bend]");
				await drag(bend, { x: bend.x + 40, y: bend.y + 80 }, 10);
			},
			commit: async (arm) => {
				await arm();
				await page.mouse.up();
			},
		});
	} else if (!ONLY) say(`${engine}: an arrow was drawn to change`, false);

	await op(page, engine, "copy by an alt-drag", {
		probe: { count: true },
		prepare: async () => {
			await remember();
			await clickOn("ew-a");
			const c = await centre("ew-a");
			await page.keyboard.down("Alt");
			await drag(c, { x: c.x, y: c.y + 160 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
			await page.keyboard.up("Alt");
		},
		cleanup: async () => {
			await dropMade();
			const arrows = await page.evaluate(() => [...globalThis.__decksRust.placed.values()].filter((p) => p.node.metadata?.type === "decks.arrow").map((p) => p.node.id));
			await del("ew-a", "ew-b", "ew-c", ...arrows);
		},
	});

	await op(page, engine, "a corner rounded by its handle", {
		probe: items("ew-round"),
		setup: async () => {
			send([rect2("ew-round", -200, -100, 200, 140)]);
			await drawn("ew-round");
			await clickOn("ew-round");
		},
		prepare: async () => {
			const h = await handle('.pen-handle[data-handle="radius"]');
			await drag(h, { x: h.x + 30, y: h.y + 30 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: () => del("ew-round"),
	});

	await op(page, engine, "a frame resized with what it holds", {
		probe: items("ew-frame", "ew-kid"),
		setup: async () => {
			send([{ op: "insert", node: { type: "frame", id: "ew-frame", name: "Frame", fill: "#eeeeee", children: [{ type: "rectangle", id: "ew-kid", fill: "#88aaff", x: 20, y: 20, width: 80, height: 60 }] }, box: at2(-250, -150, 260, 200) }]);
			await drawn("ew-frame", "ew-kid");
		},
		prepare: async () => {
			const b = await box("ew-frame");
			await page.mouse.click(b.x + b.width - 12, b.y + b.height - 12);
			const h = await handle('.pen-handle[data-handle="se"]:not([data-board])');
			await drag(h, { x: h.x + 100, y: h.y + 70 });
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: () => del("ew-frame"),
	});

	// Undo and redo of a move that has landed.
	await op(page, engine, "undo (⌘Z)", {
		probe: items("ew-undo"),
		setup: async () => {
			send([rect2("ew-undo", -200, -100)]);
			await drawn("ew-undo");
			await clickOn("ew-undo");
			const c = await centre("ew-undo");
			await drag(c, { x: c.x + 150, y: c.y + 50 });
			await page.mouse.up();
			await settle(page, 600);
		},
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("ControlOrMeta+z");
		},
	});
	await op(page, engine, "redo (⇧⌘Z)", {
		probe: items("ew-undo"),
		commit: async (arm) => {
			await arm();
			await page.keyboard.press("ControlOrMeta+Shift+z");
		},
		cleanup: () => del("ew-undo"),
	});

	// Ink: a stroke, then the eraser over it.
	await op(page, engine, "an ink stroke", {
		probe: { count: true },
		prepare: async () => {
			await remember();
			await page.click('[aria-label="Draw on the canvas"]');
			await page.waitForSelector(".stage-ink");
			await page.click('.ink-bar [aria-label^="Pen"]');
			await drag({ x: 600, y: 420 }, { x: 820, y: 470 }, 14);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
	});
	await op(page, engine, "an ink stroke erased", {
		probe: { count: true },
		setup: async () => {
			await page.click('[aria-label="Draw on the canvas"]');
			await page.waitForSelector(".stage-ink");
		},
		prepare: async () => {
			await page.click('.ink-bar [aria-label^="Eraser"]');
			await drag({ x: 700, y: 380 }, { x: 712, y: 520 }, 12);
		},
		commit: async (arm) => {
			await arm();
			await page.mouse.up();
		},
		cleanup: async () => {
			await page.click('.ink-bar [aria-label="Stop drawing"]').catch(() => {});
			await dropMade();
		},
	});

	say(`${engine}: no errors on the page`, errors.length === 0, errors.join(" | "));
	link.close?.();
	await browser.close();
}

const engines = (process.env.EDITS_WAIT_ENGINES ?? "chromium,webkit").split(",");
for (const engine of engines) {
	await resetStage();
	await run(engine, { all: true });
}
await resetStage();
if (process.env.EDITS_WAIT_TABLE) console.log(`TABLE ${JSON.stringify(results)}`);
