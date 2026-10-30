/**
 * Shapes from the library, the properties panel, and arrows that keep to a side.
 *
 * A shape is picked in the insert panel and put on the canvas with a click; it is a frame marked
 * `decks.shape` whose outline follows its size (`@decks/pen`, `shapes.ts`). The properties panel
 * swaps its kind, gives it words and sizes it, and stays one column wide however much it shows. An
 * arrow drawn from a selected shape's side keeps to that side in the file.
 *
 * Icons are left out: their names come from a CDN, and a check should not depend on the network.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasFrame, deckState, editMode, fitCanvas, onCanvasAt, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
const { browser, page, errors } = await open({ width: 1600, height: 1000 });
await rest(page, { start: 0 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);

// The stage's file, found from the frame the server sends after the first edit.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "shapes-anchor", content: "x" }, box: { x1: -4000, y1: -4000 } }] });
const frame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.doc.children.some((n) => n.id === "shapes-anchor")).at(-1));
const file = frame ? join(deck.path, "canvases", frame.stage, "canvas.pen") : "";
// Read mid-write the file is cut short: the last whole read stands until the next one parses.
let lastDisk = { children: [] };
const onDisk = () => {
	if (!existsSync(file)) return lastDisk;
	try {
		lastDisk = JSON.parse(readFileSync(file, "utf8"));
	} catch {}
	return lastDisk;
};
const shapesNow = () => onDisk().children.filter((n) => n.metadata?.type === "decks.shape");
say("the stage has a file to draw in", existsSync(file), file);

await editMode(page, true);
/** The canvas frame: the stage, its tools and its panels are there; the page's chrome is drawn over it. */
const canvas = await canvasFrame(page);
// Framed on the whole canvas, as it opens.
await fitCanvas(page);
/** The arrow drawn between the two shapes, so the act below can clear it out of its way. */
let arrowDrawn;
const candidates = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	const found = [];
	for (let y = 160; y < 820; y += 40) {
		for (let x = 360; x < 1200; x += 40) {
			if ([0, 200].every((dx) => [0, 140].every((dy) => empty(x + dx, y + dy)))) found.push({ x, y });
		}
	}
	return found;
});
// …and not under the page's own chrome (the side panel, the composer).
const spots = [];
for (const one of candidates) {
	if (spots.length === 2) break;
	if (spots.some((s) => Math.abs(s.x - one.x) < 260 && Math.abs(s.y - one.y) < 260)) continue;
	let clear = true;
	for (const dx of [0, 200]) for (const dy of [0, 140]) if (clear && !(await onCanvasAt(page, one.x + dx, one.y + dy))) clear = false;
	if (clear) spots.push(one);
}
say("the canvas has room for two shapes", spots.length === 2, JSON.stringify(spots));

// --- a shape from the library -----------------------------------------------------------------------
await canvas.locator('.v3-tool[data-tool="shape"]').click();
await canvas.locator('.v3-menu-row:has-text("More shapes")').click();
say("the shapes button opens the insert panel on its shapes", await canvas.locator(".insert-panel .insert-cell[data-shape]").count() >= 30);
await canvas.locator('.insert-panel .insert-cell[data-shape="Decision"]').click();
const armed = await canvas.evaluate(() => document.querySelector(".stage")?.dataset.penTool);
say("a pick arms the shape tool and closes the panel", armed === "shape" && (await canvas.locator(".insert-panel").count()) === 0, armed);
const had = new Set(shapesNow().map((n) => n.id));
await page.mouse.click(spots[0].x, spots[0].y);
const made = await until(() => shapesNow().find((n) => !had.has(n.id)));
say("a click puts a Decision in the file, as a shape frame", made?.metadata?.kind === "Decision" && made.type === "frame", JSON.stringify(made?.metadata));
const outline = made?.children?.find((n) => n.type === "path");
say("…whose outline is its size, in a 100 by 100 box", outline?.width === made?.width && outline?.height === made?.height && JSON.stringify(outline?.viewBox) === "[0,0,100,100]", JSON.stringify({ frame: [made?.width, made?.height], outline: [outline?.width, outline?.height] }));

// --- the properties panel ----------------------------------------------------------------------------
await until(() => canvas.locator(".props-panel").count());
say("the properties panel shows the selection", (await canvas.locator(".props-panel .props-title").inputValue().catch(() => "")) === "Decision");
const across = await canvas.evaluate(() => {
	const body = document.querySelector(".props-panel .props-body");
	for (const details of body.querySelectorAll("details")) details.open = true;
	return { scroll: body.scrollWidth, client: body.clientWidth, panel: document.querySelector(".props-panel").getBoundingClientRect().width };
});
say("…272 px wide, and it never scrolls sideways", across.panel === 272 && across.scroll <= across.client, JSON.stringify(across));
await canvas.locator('.props-panel select[aria-label="Kind of shape"]').selectOption("Terminator");
const swapped = await until(() => {
	const now = onDisk().children.find((n) => n.id === made?.id);
	// Built at the shape's own size (`@decks/pen`, `build`): its viewBox is the frame's, and its ends are half circles.
	const outline = now?.children.find((n) => n.type === "path");
	const r = typeof now?.height === "number" && typeof now?.width === "number" ? Math.min(now.width, now.height) / 2 : NaN;
	return now?.metadata?.kind === "Terminator" && outline?.viewBox?.[2] === now.width && outline.geometry.includes(`A${Math.round(r * 100) / 100} ${Math.round(r * 100) / 100}`) ? now : undefined;
});
say("its kind swaps the outline and keeps the shape", !!swapped, JSON.stringify(onDisk().children.find((n) => n.id === made?.id)?.metadata));
const words = canvas.locator('.props-panel input[placeholder="Double-click the shape, or type here"]');
await words.fill("Start");
await words.press("Tab");
const labelled = await until(() => onDisk().children.find((n) => n.id === made?.id)?.children?.find((n) => n.type === "text" && n.content === "Start"));
say("words typed in the panel go inside the shape", !!labelled);
const width = canvas.locator('.props-panel [data-field="w"] input');
await width.fill("220");
await width.press("Enter");
const sized = await until(() => {
	const now = onDisk().children.find((n) => n.id === made?.id);
	return now?.width === 220 && now.children.find((n) => n.type === "path")?.width === 220 ? now : undefined;
});
say("a width typed in the panel sizes the shape, and its outline follows", !!sized, JSON.stringify((({ children, ...rest }) => ({ ...rest, kids: children?.map((c) => [c.type, c.width, c.height]) }))(onDisk().children.find((n) => n.id === made?.id) ?? {})));
const wField = canvas.locator('.props-panel [data-field="w"] input');
await wField.hover();
for (let i = 0; i < 3; i++) {
	await page.mouse.wheel(0, -100);
	await page.waitForTimeout(40);
}
const wheeled = await until(() => onDisk().children.find((n) => n.id === made?.id)?.width === 223);
say("the wheel over a number steps it, one a turn, and sends it once", !!wheeled, String(onDisk().children.find((n) => n.id === made?.id)?.width));
await canvas.locator('.props-panel [aria-label="Pick any fill colour"]').click();
const sv = await until(() => canvas.locator(".color-picker .color-sv").boundingBox());
say("a colour field's swatch opens a colour picker", !!sv);
if (sv) {
	/**
	 * What the shape looks like on screen, as a digest of the pixels inside its selection outline.
	 *
	 * A screenshot, not the sheet's own pixels: the sheet is drawn in a worker through an offscreen
	 * canvas, which the page cannot read back.
	 */
	const drawn = async () => {
		const box = await canvas.locator(".pen-selection").first().boundingBox();
		if (!box) return "";
		const clip = { x: box.x + 4, y: box.y + 4, width: Math.max(8, box.width - 8), height: Math.max(8, box.height - 8) };
		return createHash("sha1").update(await page.screenshot({ clip })).digest("hex");
	};
	const fillOf = () => onDisk().children.find((n) => n.id === made?.id)?.children?.find((n) => n.type === "path")?.fill;
	const before = { drawn: await drawn(), fill: fillOf() };
	await page.mouse.move(sv.x + sv.width * 0.2, sv.y + sv.height * 0.2);
	await page.mouse.down();
	await page.mouse.move(sv.x + sv.width * 0.8, sv.y + sv.height * 0.1, { steps: 8 });
	await settle(page, 700);
	const mid = { drawn: await drawn(), fill: fillOf() };
	say("…and a drag in it draws the colour while the hand is still down", !!before.drawn && !!mid.drawn && mid.drawn !== before.drawn, `${before.drawn.slice(0, 12)} -> ${mid.drawn.slice(0, 12)}`);
	say("…saving nothing until it lifts", mid.fill === before.fill, `${before.fill} -> ${mid.fill}`);
	await page.mouse.up();
	const picked = await until(() => {
		const fill = fillOf();
		return typeof fill === "string" && fill !== "#ffffff" ? fill : undefined;
	});
	say("…and sets the fill once, when it is let go", !!picked, String(picked));
	await page.keyboard.press("Escape");
	say("Escape closes the picker and keeps the selection", (await canvas.locator(".color-picker").count()) === 0 && (await canvas.locator(".props-panel").count()) === 1);
}

// --- an arrow from a side ----------------------------------------------------------------------------
await page.keyboard.press("Escape");
await canvas.locator('.v3-tool[data-tool="shape"]').click();
await canvas.locator('.v3-menu-row:has-text("More shapes")').click();
await canvas.locator('.insert-panel .insert-cell[data-shape="Process"]').click();
const had2 = new Set(shapesNow().map((n) => n.id));
await page.mouse.click(spots[1].x, spots[1].y);
const second = await until(() => shapesNow().find((n) => !had2.has(n.id)));
say("a second shape, a Process", second?.metadata?.kind === "Process");
// Select the first again, and draw from its bottom side to the second, once the page has drawn it.
await until(() => canvas.evaluate((id) => !!window.__decksPenBox?.(id), second?.children?.[0]?.id));
// A shape is clicked on its outline; the page says where it draws it (`__decksPenBox`, `Stage.tsx`).
const first = await canvas.evaluate((id) => {
	const r = window.__decksPenBox?.(id);
	return r ? { x: r.x + r.width / 2, y: r.y + r.height / 3 } : undefined;
}, made?.children?.find((n) => n.type === "path")?.id);
const target = await canvas.evaluate((id) => {
	const r = window.__decksPenBox?.(id);
	return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : undefined;
}, second?.children?.find((n) => n.type === "path")?.id);
if (first && target) {
	await page.mouse.click(first.x, first.y);
	const dot = await until(() => canvas.locator('.pen-anchor[data-side="bottom"]').boundingBox());
	say("a selected shape shows the four places an arrow can leave from", (await canvas.locator(".pen-anchor").count()) === 4);
	if (dot) {
		await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
		await page.mouse.down();
		await page.mouse.move((dot.x + target.x) / 2, (dot.y + target.y) / 2, { steps: 6 });
		await page.mouse.move(target.x, target.y, { steps: 6 });
		await page.mouse.up();
		const arrow = await until(() => onDisk().children.find((n) => n.metadata?.type === "decks.arrow" && n.metadata.from?.item === made?.id));
		arrowDrawn = arrow?.id;
		say("an arrow drawn from a side keeps to it in the file", arrow?.metadata.from?.side === "bottom" && (arrow?.metadata.to === second?.id || arrow?.metadata.to?.item === second?.id), JSON.stringify(arrow?.metadata));
		if (arrow) {
			await canvas.locator('.props-panel input[placeholder="On the middle of the line"]').fill("yes");
			await page.keyboard.press("Tab");
			const worded = await until(() => onDisk().children.find((n) => n.id === arrow.id)?.metadata.label === "yes");
			say("words on an arrow are its label", !!worded);
		}
	}
} else say("both shapes are on screen", false, JSON.stringify({ first, target, ids: [made?.id, second?.id], boxes: await canvas.evaluate((ids) => ids.map((id) => !!window.__decksPenBox?.(id)), [made?.id, second?.id]) }));


// --- a shape covers what it draws, and nothing beside it --------------------------------------------
/*
 * What a shape covers is measured from its geometry, and the pointer is tested against that. Every
 * arc used to be measured out to its radii, so an ellipse covered a box twice its own height,
 * reaching half a shape above and below itself: a click near the bottom of whatever sat above an
 * ellipse selected the ellipse. Two stacked ellipses and one click are the whole case.
 *
 * Past the right-hand edge of every board first, as stage-gestures and card-editor do: live boards
 * cover the view the checks above leave, and a live board's page is not bare canvas.
 */
for (let i = 0; i < 12; i++) {
	const right = await canvas.evaluate(() => Math.max(-Infinity, ...(window.__decksBoards?.() ?? []).map(({ rect }) => rect.right)));
	if (right < 360) break;
	// Scrolled where the stage itself is under the pointer: a live board's page keeps a wheel over it.
	const at = await canvas.evaluate(() => {
		const stage = document.querySelector(".stage");
		for (let y = 160; y < 800; y += 20) for (let x = 1300; x > 360; x -= 20) if (document.elementFromPoint(x, y) === stage) return { x, y };
	});
	await page.mouse.move(at?.x ?? 900, at?.y ?? 500);
	await page.mouse.wheel(Math.min(1500, right - 340), 0);
	await settle(page, 300);
}
await settle(page, 400);
const room = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(globalThis.__decksCameraTransform());
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 170; y < 800; y += 40) {
		for (let x = 380; x < 1300; x += 40) {
			if ([0, 60, 120, 180, 240].every((dy) => [0, 100, 200].every((dx) => empty(x + dx, y + dy)))) return { world: { x: (x - m.e) / m.a, y: (y - m.f) / m.a }, zoom: m.a };
		}
	}
});
say("the canvas has room for two stacked ellipses", !!room, JSON.stringify(room));
if (room) {
	// A size on screen, whatever the zoom the checks above left: about 120 by 70 pixels each, 12 apart.
	const size = { w: Math.round(120 / room.zoom), h: Math.round(70 / room.zoom) };
	const gap = Math.round(12 / room.zoom);
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: ["top", "under"].map((which, i) => ({
			op: "insert",
			node: {
				type: "frame",
				id: `oval-${which}`,
				name: "Ellipse",
				width: size.w,
				height: size.h,
				layout: "vertical",
				justifyContent: "center",
				alignItems: "center",
				padding: 10,
				clip: false,
				metadata: { type: "decks.shape", kind: "Ellipse" },
				children: [{ type: "path", id: `oval-${which}-out`, layoutPosition: "absolute", x: 0, y: 0, width: size.w, height: size.h, viewBox: [0, 0, 100, 100], geometry: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z", fill: "#ffffff", stroke: "#1f2328", strokeWidth: 1.5 }],
			},
			box: { x1: room.world.x, y1: room.world.y + i * (size.h + gap), x2: room.world.x + size.w, y2: room.world.y + i * (size.h + gap) + size.h },
		})),
	});
	const boxOf = (id) => canvas.evaluate((one) => globalThis.__decksPenBox?.(one), id);
	const drawn = await until(async () => {
		const all = { top: await boxOf("oval-top"), out: await boxOf("oval-top-out"), under: await boxOf("oval-under") };
		return all.top && all.out && all.under && all.top.height > 0 ? all : undefined;
	});
	say("both ellipses are drawn", !!drawn, JSON.stringify(drawn && Object.fromEntries(Object.entries(drawn).map(([k, b]) => [k, { y: Math.round(b.y), h: Math.round(b.height) }]))));
	if (drawn) {
		const off = Math.max(Math.abs(drawn.out.y - drawn.top.y), Math.abs(drawn.out.height - drawn.top.height));
		say("an ellipse covers its own box, not twice its height", off <= 2, JSON.stringify({ shape: { y: Math.round(drawn.top.y), h: Math.round(drawn.top.height) }, outline: { y: Math.round(drawn.out.y), h: Math.round(drawn.out.height) }, off: Math.round(off) }));
		await page.keyboard.press("Escape");
		await settle(page, 200);
		await page.mouse.click(drawn.top.x + drawn.top.width / 2, drawn.top.y + drawn.top.height * 0.85);
		await settle(page, 400);
		const picked = await until(() => canvas.evaluate(() => {
			const one = document.querySelector(".pen-selection:not([data-board])");
			if (!one) return undefined;
			const box = one.getBoundingClientRect();
			return { y: Math.round(box.y), h: Math.round(box.height) };
		}));
		say("clicking near the bottom of the upper one selects the upper one", !!picked && Math.abs(picked.y - drawn.top.y) <= 4, JSON.stringify({ picked, top: Math.round(drawn.top.y), under: Math.round(drawn.under.y) }));
	}
	link.send({ type: "stage.pen.edit", agentId, ops: ["oval-top", "oval-under"].map((id) => ({ op: "delete", id })) });
	await settle(page, 300);
}


// --- an arrow is hit on its line, not in its box ----------------------------------------------------
// The arrow from the act above is cleared first: it crosses this part of the canvas, and a press
// near its line is a press on it, which is the very thing being asserted about the new one.
if (arrowDrawn) {
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: arrowDrawn }] });
	await settle(page, 400);
}
/*
 * An arrow's box is the rectangle between its two ends, and for a diagonal that is mostly empty
 * canvas. A press in an empty corner of it used to pick the arrow, because the box was the whole
 * test; now the browser is asked whether the point is on what the path draws.
 */
const diagonal = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(globalThis.__decksCameraTransform());
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 170; y < 700; y += 40) {
		for (let x = 380; x < 1300; x += 40) {
			if ([0, 60, 120, 180].every((dy) => [0, 80, 160, 240].every((dx) => empty(x + dx, y + dy)))) return { world: { x: (x - m.e) / m.a, y: (y - m.f) / m.a }, zoom: m.a };
		}
	}
});
say("the canvas has room for a diagonal arrow", !!diagonal, JSON.stringify(diagonal?.world));
if (diagonal) {
	const a = { x: Math.round(diagonal.world.x), y: Math.round(diagonal.world.y) };
	const b = { x: a.x + 700, y: a.y + 500 };
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "path", id: "slash", stroke: "#8a8f98", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", metadata: { type: "decks.arrow", from: [a.x, a.y], to: [b.x, b.y], route: "straight" } } }] });
	const drawn = await until(async () => {
		const box = await canvas.evaluate(() => globalThis.__decksPenBox?.("slash"));
		return box && box.width > 40 && box.height > 40 ? box : undefined;
	});
	say("the arrow is drawn, with a box of real area", !!drawn, JSON.stringify(drawn && { w: Math.round(drawn.width), h: Math.round(drawn.height) }));
	if (drawn) {
		const geometry = onDisk().children.find((n) => n.id === "slash")?.geometry ?? "";
		await page.keyboard.press("Escape");
		await settle(page, 250);
		// A point inside the arrow's box that the hit layer itself calls empty: no hit shape there.
		const corner = await canvas.evaluate((box) => {
			const inside = [];
			for (let dy = 10; dy < box.height - 10; dy += 8) {
				for (let dx = 10; dx < box.width - 10; dx += 8) {
					const el = document.elementFromPoint(box.x + dx, box.y + dy);
					if (!el?.closest?.(".pen-hits") && !el?.closest?.(".board-node")) inside.push({ x: box.x + dx, y: box.y + dy, tag: el?.tagName, cls: el?.getAttribute?.("class") });
				}
			}
			// The one furthest from the line, which is the diagonal of the box.
			return inside.sort((a, b) => Math.abs(b.x - box.x - ((b.y - box.y) * box.width) / box.height) - Math.abs(a.x - box.x - ((a.y - box.y) * box.width) / box.height))[0];
		}, { x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height });
		say("its box has room in it the hit layer calls empty", !!corner, JSON.stringify(corner));
		/*
		 * Read from the properties panel, not from the selection outline: an arrow has no outline, so
		 * counting outlines would call a selected arrow "nothing selected".
		 */
		const named = () => canvas.evaluate(() => document.querySelector(".props-panel .props-title")?.value ?? "");
		await page.mouse.click(corner.x, corner.y);
		await settle(page, 400);
		const nothing = await named();
		say("a press in the empty part of its box picks nothing", nothing === "", JSON.stringify({ corner: { x: Math.round(corner.x), y: Math.round(corner.y) }, panel: nothing }));
		// And the middle of its own line still picks it.
		const on = await canvas.evaluate((one) => {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", one.geometry);
			svg.append(path);
			document.body.append(svg);
			const at = path.getPointAtLength(path.getTotalLength() / 2);
			svg.remove();
			const m = new DOMMatrix(globalThis.__decksCameraTransform());
			const box = globalThis.__decksPenBox?.("slash");
			return { x: box.x + at.x * m.a, y: box.y + at.y * m.a };
		}, { geometry });
		await page.mouse.click(on.x, on.y);
		await settle(page, 350);
		const mine = await until(async () => ((await named()) === "Arrow" ? true : undefined), 3000);
		say("…and a press on the middle of its line picks it", !!mine, JSON.stringify({ at: { x: Math.round(on.x), y: Math.round(on.y) }, panel: await named() }));

		/*
		 * How far from the line a press still reaches it, measured on the screen at two zooms a
		 * factor of four apart. A board's edge band is a constant number of screen pixels at every
		 * zoom (`BoardFrame`), and a line's reach is the same idea: 8 px either side, so a line is no
		 * harder to hit zoomed out, where 8 stage pixels would be two on the screen.
		 */
		const normal = () => canvas.evaluate((one) => {
			const box = globalThis.__decksPenBox?.("slash");
			const m = new DOMMatrix(globalThis.__decksCameraTransform());
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			// The line alone: the geometry's later subpaths are the head.
			path.setAttribute("d", one.geometry.split(/(?=M)/)[0]);
			svg.append(path);
			document.body.append(svg);
			const total = path.getTotalLength();
			const at = (along) => {
				const p = path.getPointAtLength(along);
				return { x: box.x + p.x * m.a, y: box.y + p.y * m.a };
			};
			const mid = at(total / 2);
			const before = at(total / 4);
			const after = at((total * 3) / 4);
			svg.remove();
			const len = Math.hypot(after.x - before.x, after.y - before.y) || 1;
			return { mid, nx: -(after.y - before.y) / len, ny: (after.x - before.x) / len, zoom: Math.round(m.a * 1000) / 1000 };
		}, { geometry });
		const reach = async (line, off) => {
			await page.keyboard.press("Escape");
			await settle(page, 200);
			await page.mouse.click(line.mid.x + line.nx * off, line.mid.y + line.ny * off);
			await settle(page, 250);
			return (await named()) === "Arrow";
		};
		const far = await normal();
		const outside = { near: await reach(far, 5), away: await reach(far, 18) };
		say("zoomed out, a press 5 px off the line reaches it and one 18 px off does not", outside.near && !outside.away, JSON.stringify({ zoom: far.zoom, ...outside }));
		// Zoomed in four times: the band has to be the same on the screen, not four times as wide.
		await page.keyboard.press("Escape");
		await page.mouse.move(far.mid.x, far.mid.y);
		await page.keyboard.down("Control");
		for (let i = 0; i < 40; i++) {
			await page.mouse.wheel(0, -120);
			await page.waitForTimeout(40);
			const zoom = await canvas.evaluate(() => new DOMMatrix(globalThis.__decksCameraTransform()).a);
			if (zoom >= far.zoom * 4) break;
		}
		await page.keyboard.up("Control");
		await settle(page, 900);
		const close = await normal();
		const inside = { near: await reach(close, 5), away: await reach(close, 18) };
		say("…and zoomed in four times, the same 5 px reaches it and 18 px still does not", inside.near && !inside.away, JSON.stringify({ zoom: close.zoom, ...inside }));
	}
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "slash" }] });
	await settle(page, 300);
}

/*
 * The board's pill, over a selected drawn item, with what makes sense for one (`BoardCallout`): zoom to
 * it, comment, duplicate and delete (Properties left the pill on purpose). Its Duplicate selects the copy, and its Delete takes
 * that copy away, leaving the first.
 */
{
	await page.keyboard.press("Escape");
	await settle(page, 300);
	// A fresh shape where the screen is, so what this selects does not depend on where the checks above left the camera.
	const at = await canvas.evaluate(() => {
		const stage = document.querySelector(".stage").getBoundingClientRect();
		const m = new DOMMatrix(globalThis.__decksCameraTransform());
		const sx = stage.left + stage.width * 0.45, sy = stage.top + stage.height * 0.4;
		return { x: (sx - stage.left - m.e) / m.a, y: (sy - stage.top - m.f) / m.d, zoom: m.a };
	});
	const w = Math.round(200 / at.zoom), h = Math.round(120 / at.zoom);
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "frame", id: "pill-shape", name: "Process", width: w, height: h, layout: "vertical", metadata: { type: "decks.shape", kind: "Process" }, children: [{ type: "path", id: "pill-shape-o", layoutPosition: "absolute", x: 0, y: 0, width: w, height: h, viewBox: [0, 0, w, h], geometry: `M0 0H${w}V${h}H0Z`, fill: "#fde68a", stroke: "#1f2328" }] }, box: { x1: Math.round(at.x), y1: Math.round(at.y) } }] });
	await until(() => onDisk().children.find((n) => n.id === "pill-shape"));
	await settle(page, 800);
	const target = onDisk().children.find((n) => n.id === "pill-shape");
	const middle = await canvas.evaluate((id) => { const r = globalThis.__decksPenBox?.(id); return r && r.width > 4 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; }, target?.id);
	say("a shape is on screen to select", !!middle, JSON.stringify(middle));
	if (middle) {
		await page.mouse.click(middle.x, middle.y);
		const labels = await until(() => canvas.evaluate(() => [...document.querySelectorAll(".stage-fixed > .board-callout:not([data-hidden]) [aria-label]")].map((one) => one.getAttribute("aria-label"))).then((all) => (all.length ? all : undefined)));
		say("a selected shape gets the pill: zoom, comment, duplicate and delete", JSON.stringify(labels) === JSON.stringify(["Zoom to it", "Comment", "Duplicate", "Delete"]), JSON.stringify(labels));
		const before = onDisk().children.length;
		// Pressed by its coordinates: a locator's click scrolls its target into view, and the stage is a scroll container.
		const pressOn = async (selector) => {
			const r = await canvas.locator(selector).first().boundingBox();
			await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
		};
		await pressOn('.stage-fixed > .board-callout:not([data-hidden]) [aria-label="Duplicate"]');
		const copy = await until(() => (onDisk().children.length === before + 1 ? onDisk().children.at(-1) : undefined));
		say("…its Duplicate makes a copy", !!copy, `${before} -> ${onDisk().children.length}`);
		// The copy is selected once the drawing has it: the outline moves onto it.
		await until(() => canvas.evaluate((id) => { const r = globalThis.__decksPenBox?.(id); const sel = document.querySelector(".pen-selection")?.getBoundingClientRect(); return r && sel && Math.abs(sel.left - r.left) < 6 && Math.abs(sel.top - r.top) < 6 ? true : undefined; }, copy?.id));
		await settle(page, 300);
		await pressOn('.stage-fixed > .board-callout:not([data-hidden]) [aria-label="Delete"]');
		const gone = await until(() => (onDisk().children.length === before ? true : undefined));
		say("…and its Delete takes the copy away and leaves the first", !!gone && onDisk().children.some((n) => n.id === target?.id) && !onDisk().children.some((n) => n.id === copy?.id), `${onDisk().children.length}`);
	}
}

/*
 * An arrow keeps where it joins and how it bends (`@decks/pen`, `at` and `bend`): its joined end is a
 * diamond that slides along the side it joins, the handle in its middle moves an elbow's turn, and a
 * double-click on either puts it back.
 */
{
	await page.keyboard.press("Escape");
	await settle(page, 300);
	const at = await canvas.evaluate(() => {
		const stage = document.querySelector(".stage").getBoundingClientRect();
		const m = new DOMMatrix(globalThis.__decksCameraTransform());
		const toStage = (sx, sy) => ({ x: (sx - stage.left - m.e) / m.a, y: (sy - stage.top - m.f) / m.d });
		return { a: toStage(stage.left + stage.width * 0.3, stage.top + stage.height * 0.3), b: toStage(stage.left + stage.width * 0.6, stage.top + stage.height * 0.55), zoom: m.a };
	});
	const w = Math.round(160 / at.zoom), h = Math.round(120 / at.zoom);
	link.send({ type: "stage.pen.edit", agentId, ops: [
		{ op: "insert", node: { type: "rectangle", id: "bend-a", width: w, height: h, fill: "#dbeafe" }, box: { x1: Math.round(at.a.x), y1: Math.round(at.a.y) } },
		{ op: "insert", node: { type: "rectangle", id: "bend-b", width: w, height: h, fill: "#dcfce7" }, box: { x1: Math.round(at.b.x), y1: Math.round(at.b.y) } },
		{ op: "insert", node: { type: "path", id: "bend-arrow", stroke: "#1f2328", strokeWidth: 2, metadata: { type: "decks.arrow", from: { item: "bend-a", side: "right" }, to: { item: "bend-b", side: "left" }, route: "elbow" } } },
	] });
	await until(() => onDisk().children.find((n) => n.id === "bend-arrow")?.geometry);
	await settle(page, 800);
	// The arrow is picked on its line: its middle, where the elbow's middle segment is.
	const line = await canvas.evaluate(() => { const r = globalThis.__decksPenBox?.("bend-arrow"); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; });
	if (line) await page.mouse.click(line.x, line.y);
	const handles = await until(() => canvas.evaluate(() => {
		const centre = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; };
		const from = document.querySelector('.pen-handle[data-end="from"][data-joined]');
		const bend = document.querySelector(".pen-handle[data-bend]");
		return from && bend ? { from: centre(from), bend: centre(bend) } : undefined;
	}));
	say("a selected arrow shows a diamond on its joined end and a handle in its middle", !!handles, JSON.stringify(handles));
	if (handles) {
		const box = await canvas.evaluate(() => { const r = globalThis.__decksPenBox?.("bend-a"); return r ? { top: r.top, height: r.height } : undefined; });
		// Down the right side to a quarter from its foot: three quarters of the way.
		await page.mouse.move(handles.from.x, handles.from.y);
		await page.mouse.down();
		await page.mouse.move(handles.from.x, box.top + box.height * 0.6, { steps: 4 });
		await page.mouse.move(handles.from.x, box.top + box.height * 0.75, { steps: 4 });
		await page.mouse.up();
		const slid = await until(() => { const from = onDisk().children.find((n) => n.id === "bend-arrow")?.metadata?.from; return typeof from?.at === "number" ? from : undefined; });
		say("dragging the diamond down the side slides the join, and it clicks to three quarters", slid?.item === "bend-a" && slid?.side === "right" && Math.abs(slid.at - 0.75) < 0.02, JSON.stringify(slid));
		await settle(page, 600);
		const bendNow = await canvas.evaluate(() => { const r = document.querySelector(".pen-handle[data-bend]")?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; });
		await page.mouse.move(bendNow.x, bendNow.y);
		await page.mouse.down();
		await page.mouse.move(bendNow.x - 30, bendNow.y, { steps: 4 });
		await page.mouse.move(bendNow.x - 60, bendNow.y, { steps: 4 });
		await page.mouse.up();
		const bend = await until(() => { const meta = onDisk().children.find((n) => n.id === "bend-arrow")?.metadata; return typeof meta?.bend === "number" ? meta.bend : undefined; });
		say("dragging the middle handle moves the elbow's turn toward the start", typeof bend === "number" && bend < 0.5, String(bend));
		await settle(page, 600);
		await canvas.locator(".pen-handle[data-bend]").dblclick();
		const unbent = await until(() => (onDisk().children.find((n) => n.id === "bend-arrow")?.metadata?.bend === undefined ? true : undefined));
		say("a double-click on it puts the turn back on the automatic route", !!unbent);
		await settle(page, 400);
		await canvas.locator('.pen-handle[data-end="from"]').dblclick();
		const middle = await until(() => { const from = onDisk().children.find((n) => n.id === "bend-arrow")?.metadata?.from; return from && from.at === undefined ? from : undefined; });
		say("…and on the diamond, the join back in the middle of its side", middle?.side === "right", JSON.stringify(middle));
	}
	link.send({ type: "stage.pen.edit", agentId, ops: ["bend-arrow", "bend-a", "bend-b"].map((id) => ({ op: "delete", id })) });
	await settle(page, 300);
}

say("no errors in the page", errors.length === 0, errors.join(" | "));
link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.metadata?.type === "decks.shape" || n.metadata?.type === "decks.arrow" || n.id === "shapes-anchor").map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 400);
link.close?.();
await browser.close();
