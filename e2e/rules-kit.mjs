/**
 * What the rules checks share (`checks/rules-*.mjs`): the three forms the rules table has a column
 * for (`packages/canvas/src/device/rules.json`), opened in turn as a desk, an iPad and an iPhone;
 * the table's column for each, read in Node to hold the page to; a bare stretch of canvas with notes
 * put on it over the wire; and fingers, a mouse and a pen at stage points.
 *
 * Touches go through CDP (`Input.dispatchTouchEvent`), as a real screen sends them: Playwright's own
 * tap does not reach a page in Chromium's touch emulation.
 */
import { readFileSync } from "node:fs";
import { API, asPerson, canvasFrame, open, rest } from "./harness.mjs";

const RULES = JSON.parse(readFileSync(new URL("../packages/canvas/src/device/rules.json", import.meta.url), "utf8")).rules;

/** The three forms, and how each is opened: a desk at a laptop's size, an iPad Mini, an iPhone 13. */
export const FORMS = [
	{ form: "desk", os: "computer", open: { width: 1400, height: 900 } },
	{ form: "tablet", os: "mobile", open: { device: "iPad Mini" } },
	{ form: "phone", os: "mobile", open: { device: "iPhone 13" } },
];

/** A row of the table for a form: its one value, or that form's (or that system's) column; a row by pointer or GPU whole. */
export function rule(name, form, os) {
	const row = RULES[name];
	if (!row) throw new Error(`no rule ${name}`);
	if (!row.by) return row.value;
	if (row.by === "form") return row[form];
	if (row.by === "os") return row[os];
	return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "by" && key !== "says"));
}

export const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const until = async (test, ms = 6000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await sleep(100);
	}
};

/** Where the checks work: far from the fixture's boards, so nothing else is under a press. */
export const ROOM = { x: -6000, y: -6000 };

/**
 * Rectangles on the room, by id, each `{ id, x, y, w, h }` relative to `ROOM` (exact sizes, unlike a note's), put there over the wire and
 * waited for in the frame. Any earlier ones of the same id are taken off first.
 */
export async function notes(canvas, list, canvasName) {
	for (const one of list) await call("canvas.delete", [one.id, canvasName ? { canvas: canvasName } : {}]).catch(() => {});
	const ops = list.map((one) => ({ op: "insert", item: { type: "rectangle", id: one.id, width: one.w, height: one.h, fill: "$decks-fill-slate", cornerRadius: 8 }, at: { x1: ROOM.x + one.x, y1: ROOM.y + one.y } }));
	const made = await call("canvas.batch", [ops, canvasName ? { canvas: canvasName } : {}]);
	if (made.error) throw new Error(`notes: ${JSON.stringify(made.error)}`);
	await until(() => canvas.evaluate((ids) => ids.every((id) => !!globalThis.__decksPenBox?.(id)), list.map((one) => one.id)), 8000);
}

/** An item's box as the file has it. */
export async function itemBox(id, canvasName) {
	const read = await call("canvas.read", [{ of: id, depth: 0, ...(canvasName ? { canvas: canvasName } : {}) }]);
	const item = read.value?.items?.[0];
	return item?.box ? { x: item.box.x1, y: item.box.y1, w: item.box.x2 - item.box.x1, h: item.box.y2 - item.box.y1 } : undefined;
}

/**
 * One form open: the page, its canvas frame and where the frame sits on the page, the room in view
 * at life size, edit mode on, and the inputs.
 */
export async function openForm(f, { zoom = 1, edit = true } = {}) {
	const opened = await open({ ...f.open, scheme: "light", cards: false });
	const { browser, page, errors } = opened;
	await rest(page, { start: 0 });
	const canvas = await canvasFrame(page);
	const frameBox = await page.locator("iframe.canvas-frame").first().boundingBox();
	const offset = { x: frameBox?.x ?? 0, y: frameBox?.y ?? 0 };
	const view = await canvas.evaluate(() => ({ w: innerWidth, h: innerHeight }));
	/** Put a room point at a place on the frame's screen, at a zoom. */
	const look = async (at = { x: ROOM.x + 200, y: ROOM.y + 200 }, z = zoom, screen = { x: view.w / 2, y: view.h * 0.45 }) => {
		await canvas.evaluate(({ at, z, screen, view }) => {
			const h = globalThis.__decksFrameHandle;
			h.setCamera({ x: at.x + (view.w / 2 - screen.x) / z, y: at.y + (view.h / 2 - screen.y) / z, zoom: z });
		}, { at, z, screen, view });
		await rest(page, { start: 150 });
	};
	if (edit) await canvas.evaluate(() => globalThis.__decksFrameHandle?.setMode("edit"));
	await look();
	const cdp = await page.context().newCDPSession(page);
	/** A frame point on the page's screen. */
	const page_ = (p) => ({ x: p.x + offset.x, y: p.y + offset.y });
	/** Where a stage point is on the frame's screen, from the camera now. */
	const screenOf = async (p) => canvas.evaluate(({ p, view }) => {
		const c = globalThis.__decksFrameHandle.camera();
		return { x: view.w / 2 + (p.x - c.x) * c.zoom, y: view.h / 2 + (p.y - c.y) * c.zoom };
	}, { p, view });
	/** An item's middle on the frame's screen. */
	const middle = async (id, fy = 0.5) => {
		const r = await canvas.evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id);
		return r ? { x: r.x + r.width / 2, y: r.y + r.height * fy } : undefined;
	};
	const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ ...page_(p), id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
	const fingers = {
		tap: async (p, hold = 60) => {
			await touch("touchStart", [p]);
			await sleep(hold);
			await touch("touchEnd", []);
			await sleep(450);
		},
		/** One finger from `a` to `b` in `steps`, holding `wait` first, lifting after `after`. */
		drag: async (a, b, { steps = 12, wait = 0, after = 80, every = 16 } = {}) => {
			await touch("touchStart", [a]);
			if (wait) await sleep(wait);
			for (let i = 1; i <= steps; i++) {
				await touch("touchMove", [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]);
				await sleep(every);
			}
			await sleep(after);
			await touch("touchEnd", []);
		},
		/** Two fingers from `mid ± spread0` to `mid ± spread1`, landed 30 ms apart as a hand does. */
		pinch: async (mid, spread0, spread1, steps = 10) => {
			const at = (s) => [{ x: mid.x - s, y: mid.y }, { x: mid.x + s, y: mid.y }];
			await touch("touchStart", [at(spread0)[0]]);
			await sleep(30);
			await touch("touchStart", at(spread0));
			for (let i = 1; i <= steps; i++) {
				await touch("touchMove", at(spread0 + ((spread1 - spread0) * i) / steps));
				await sleep(16);
			}
			await touch("touchEnd", []);
		},
		touch,
	};
	const mouse = {
		drag: async (a, b, { steps = 12 } = {}) => {
			const A = page_(a);
			const B = page_(b);
			await page.mouse.move(A.x, A.y);
			await page.mouse.down();
			for (let i = 1; i <= steps; i++) await page.mouse.move(A.x + ((B.x - A.x) * i) / steps, A.y + ((B.y - A.y) * i) / steps);
			await page.mouse.up();
		},
		move: async (p) => {
			const P = page_(p);
			await page.mouse.move(P.x, P.y);
		},
		click: async (p) => {
			const P = page_(p);
			await page.mouse.click(P.x, P.y);
		},
		dblclick: async (p) => {
			const P = page_(p);
			await page.mouse.dblclick(P.x, P.y);
		},
	};
	const selection = () => canvas.evaluate(() => globalThis.__decksFrameHandle?.selection?.() ?? []);
	const select = async (ids) => {
		await canvas.evaluate((ids) => globalThis.__decksFrameHandle.select(ids), ids);
		await sleep(250);
	};
	const camera = () => canvas.evaluate(() => globalThis.__decksFrameHandle.camera());
	const read = () => canvas.evaluate(() => globalThis.__decksRules?.());
	const pageRead = () => page.evaluate(() => globalThis.__decksRules?.());
	return { browser, page, errors, canvas, view, look, screenOf, middle, fingers, mouse, selection, select, camera, read, pageRead, close: () => browser.close() };
}
