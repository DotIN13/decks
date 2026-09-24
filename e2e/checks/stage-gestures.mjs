/**
 * The stage's gestures, against what a design tool and a notes app do.
 *
 * In browse mode as well as edit: the drawing's tools are there, an item outlines itself under the
 * pointer, a drag on bare canvas is a marquee that picks items and boards, and whatever is selected
 * moves together, snapping to what is around it. An arrow's ends light up what they will join and
 * can be picked up again. A finger taps an item to select it and drags it once it is. In edit mode a
 * board outlines itself under the pointer too. With the pen out: a held stroke straightens, the
 * lasso's box resizes what it holds, and two fingers tapped together undo.
 *
 * Needs no model: every edit goes over the wire as `stage.pen.edit`, as a hand edit does.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckState, editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

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
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);

const matrix = () => page.evaluate(() => {
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	return { e: m.e, f: m.f, a: m.a };
});
const toWorld = (m, x, y) => ({ x: Math.round((x - m.e) / m.a), y: Math.round((y - m.f) / m.a) });
const toScreen = (m, x, y) => ({ x: m.e + x * m.a, y: m.f + y * m.a });

// A stretch of bare canvas to work in, zooming out until there is one.
const findRoom = () => page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 130; y + 300 < 780; y += 20) {
		for (let x = 580; x + 640 < 1560; x += 20) {
			let ok = true;
			for (let dy = 0; dy <= 300 && ok; dy += 25) for (let dx = 0; dx <= 640 && ok; dx += 32) ok = empty(x + dx, y + dy);
			if (ok) return { x, y };
		}
	}
});
/*
 * Past the right-hand edge of every board, brought into view with a middle-button drag: the
 * fixture's boards fill the view it opens on.
 */
{
	const boards = deck.boards.filter((b) => Number.isFinite(b.x));
	const right = Math.max(...boards.map((b) => b.x + (b.w ?? 800)));
	const top = Math.min(...boards.map((b) => b.y));
	const now = await matrix();
	const target = toScreen(now, right + 60 / now.a, top);
	let dx = 560 - target.x;
	let dy = 180 - target.y;
	while (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
		const sx = Math.max(-600, Math.min(600, dx));
		const sy = Math.max(-400, Math.min(400, dy));
		await page.mouse.move(900, 500);
		await page.mouse.down({ button: "middle" });
		await page.mouse.move(900 + sx, 500 + sy, { steps: 8 });
		await page.mouse.up({ button: "middle" });
		dx -= sx;
		dy -= sy;
	}
	await settle(page, 500);
}
let room = await findRoom();
say("there is bare canvas to work in", !!room);
if (!room) room = { x: 400, y: 200 };

// Two rectangles, a hundred screen pixels square-ish, side by side.
let m = await matrix();
const A = toWorld(m, room.x + 20, room.y + 30);
const B = toWorld(m, room.x + 300, room.y + 30);
const size = { w: Math.round(100 / m.a), h: Math.round(60 / m.a) };
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{ op: "insert", node: { type: "rectangle", id: "g-a", fill: "#bfdbfe" }, box: { x1: A.x, y1: A.y, x2: A.x + size.w, y2: A.y + size.h } },
		{ op: "insert", node: { type: "rectangle", id: "g-b", fill: "#fde68a" }, box: { x1: B.x, y1: B.y + Math.round(40 / m.a), x2: B.x + size.w, y2: B.y + Math.round(40 / m.a) + size.h } },
	],
});
const frame = await until(() => link.received.filter((msg) => msg.type === "stage.pen" && msg.agentId === agentId && msg.doc.children.some((n) => n.id === "g-b")).at(-1));
const file = frame ? join(deck.path, "stages", frame.stage, "stage.pen") : "";
// The last whole read: a read that lands while the server is writing sees half a file.
let lastRead = { children: [] };
const onDisk = () => {
	try {
		if (existsSync(file)) lastRead = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		/* mid-write: the last whole read stands */
	}
	return lastRead;
};
const item = (id) => onDisk().children.find((n) => n.id === id);
await until(() => page.evaluate(() => document.querySelectorAll('.pen-hits [data-id="g-b"]').length === 1));
await settle(page, 300);
const centre = async (id) => {
	const n = item(id);
	const now = await matrix();
	return toScreen(now, n.x + n.width / 2, n.y + n.height / 2);
};
/** Wait until the page draws an item where the file has it: the file is written before the page is told. */
const drawnWhereFileSays = (id) =>
	until(async () => {
		const want = await centre(id);
		return page.evaluate(({ id, want }) => {
			const hit = document.querySelector(`.pen-hits [data-id="${id}"]`);
			if (!hit) return false;
			const r = hit.getBoundingClientRect();
			return Math.abs(r.x + r.width / 2 - want.x) < 3 && Math.abs(r.y + r.height / 2 - want.y) < 3;
		}, { id, want });
	}, 4000);
const count = (selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);

// --- browse mode: the tools, the hover, the marquee ----------------------------------------------
say("the canvas is browsing", (await page.evaluate(() => document.querySelector(".stage").dataset.mode)) === "browse");
say("…and the stage's seven tools are there, with no cursor among them: that is the browse button", (await count(".pen-tools button[data-tool]")) === 7 && (await count('.pen-tools [data-tool="select"]')) === 0);
const a0 = await centre("g-a");
await page.mouse.move(a0.x, a0.y);
await settle(page, 300);
say("browsing draws no outline under the pointer", (await count(".pen-hover")) === 0);
await page.mouse.move(room.x + 5, room.y + 5);

await page.mouse.down();
await page.mouse.move(room.x + 300, room.y + 100, { steps: 5 });
await page.mouse.move(room.x + 470, room.y + 200, { steps: 5 });
const live = await count(".pen-selection");
await page.mouse.up();
// Two items and, while it was held, the marquee's own box.
say("a drag on bare canvas is a marquee, picking what it goes round as it goes", live === 3, String(live));
say("…and both items are selected after it", (await count(".pen-selection")) === 2);

// --- moving the selection together, then with a board ---------------------------------------------
const before = { a: item("g-a"), b: item("g-b") };
m = await matrix();
const a1 = await centre("g-a");
// Control holds snapping off, so the distance is exactly the hand's.
await page.keyboard.down("Control");
await page.mouse.move(a1.x, a1.y);
await page.mouse.down();
await page.mouse.move(a1.x + 20, a1.y + 25, { steps: 4 });
await page.mouse.move(a1.x + 40, a1.y + 50, { steps: 4 });
await page.mouse.up();
await page.keyboard.up("Control");
const movedBoth = await until(() => {
	const a = item("g-a");
	const b = item("g-b");
	const dx = Math.round(40 / m.a);
	return Math.abs(a.x - before.a.x - dx) <= 2 && Math.abs(b.x - before.b.x - dx) <= 2 ? { a: a.x, b: b.x } : undefined;
});
say("dragging one selected item moves the whole selection", !!movedBoth, JSON.stringify({ before: [before.a.x, before.b.x], now: [item("g-a").x, item("g-b").x] }));

const bar = await page.evaluate(() => {
	for (const chrome of document.querySelectorAll(".bar-layer .chrome")) {
		const r = chrome.getBoundingClientRect();
		// Its title, at the left end, or failing that the bare part of it nearest the right.
		for (const x of [r.x + 30, r.x + r.width * 0.5, r.x + r.width - 60]) {
			const y = r.y + r.height / 2;
			const at = document.elementFromPoint(x, y);
			if (x > 320 && x < 1560 && y > 90 && y < 900 && at?.closest(".chrome") === chrome && !at.closest("button")) return { x, y, path: chrome.dataset.path };
		}
	}
});
say("a board's title bar is on screen", !!bar);
if (bar) {
	await page.keyboard.down("Shift");
	await page.mouse.click(bar.x, bar.y);
	await page.keyboard.up("Shift");
	say("Shift and a press on a title bar adds that board to the selection", (await count(".pen-selection")) === 3, String(await count(".pen-selection")));
	const boardBefore = onDisk().children.find((n) => n.metadata?.path === bar.path);
	await drawnWhereFileSays("g-a");
	const a2 = await centre("g-a");
	m = await matrix();
	await page.keyboard.down("Control");
	await page.mouse.move(a2.x, a2.y);
	await page.mouse.down();
	await page.mouse.move(a2.x + 30, a2.y, { steps: 6 });
	await page.mouse.up();
	await page.keyboard.up("Control");
	const boardMoved = await until(() => {
		const now = onDisk().children.find((n) => n.metadata?.path === bar.path);
		return now && Math.abs(now.x - boardBefore.x - Math.round(30 / m.a)) <= 2;
	});
	say("…and the board moves with the items", !!boardMoved, JSON.stringify({ was: boardBefore?.x, now: onDisk().children.find((n) => n.metadata?.path === bar.path)?.x }));
	// Put it back where the fixture had it.
	link.send({ type: "board.move", path: bar.path, x: boardBefore.x, y: boardBefore.y });
}
await page.keyboard.press("Escape");
say("Escape lets the whole selection go", (await count(".pen-selection")) === 0);

// --- snapping ------------------------------------------------------------------------------------
{
	await drawnWhereFileSays("g-a");
	await drawnWhereFileSays("g-b");
	const a = item("g-a");
	const b = item("g-b");
	m = await matrix();
	const from = await centre("g-b");
	// Aim b's top four screen pixels below a's: the snap closes the gap.
	const wantDy = (a.y - b.y) * m.a + 4;
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 10, from.y + wantDy / 2, { steps: 4 });
	await page.mouse.move(from.x + 20, from.y + wantDy, { steps: 4 });
	const guides = await count(".pen-guides line");
	await page.mouse.up();
	say("a drag near another item's edge draws a guide", guides >= 1, String(guides));
	const snapped = await until(() => item("g-b").y === a.y);
	say("…and lands exactly on the line", !!snapped, JSON.stringify({ a: a.y, b: item("g-b").y }));
}

// --- Alt and a drag leaves a copy -------------------------------------------------------------------
{
	await drawnWhereFileSays("g-b");
	const had = onDisk().children.length;
	const b = item("g-b");
	const from = await centre("g-b");
	await page.keyboard.down("Alt");
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x, from.y + 60, { steps: 4 });
	await page.mouse.move(from.x, from.y + 120, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.up("Alt");
	const copied = await until(() => onDisk().children.length === had + 1);
	say("Alt and a drag leaves a copy and the original", !!copied && item("g-b").y === b.y, JSON.stringify({ had, now: onDisk().children.length, b: [b.y, item("g-b").y] }));
	const copy = onDisk().children.at(-1);
	if (copy && copy.id !== "g-b") link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: copy.id }] });
	await page.keyboard.press("Escape");
}

// --- dropped on the composer: talk about it rather than move it --------------------------------------

/*
 * Dragging a drawn item into the box you are typing in is not a request to park it there. So the
 * move is undone at the last moment and the item's id arrives in the draft as `@item:<id>`,
 * which is how the agent looks it up in `stage.pen.read()`.
 */
{
	await drawnWhereFileSays("g-a");
	const before = item("g-a");
	const from = await centre("g-a");
	const box = await page.locator(".composer-box").boundingBox();
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
	await page.mouse.move(box.x + box.width / 2, box.y + 18, { steps: 12 });
	await settle(page, 200);
	const marked = await page.evaluate(() => document.querySelector(".composer-box")?.dataset.refer ?? null);
	await page.mouse.up();
	await settle(page, 500);
	const typed = await page.evaluate(() => document.querySelector(".dockfield")?.textContent?.trim() ?? "");
	say("the composer says a dragged item would be mentioned here", marked === "true", String(marked));
	say("…and letting go writes its id into what you are typing", typed === "@item:g-a", typed);
	const after = item("g-a");
	say("…and leaves the item where it was, because that was never a move", after.x === before.x && after.y === before.y, JSON.stringify({ before: [before.x, before.y], after: [after.x, after.y] }));
	/* The field is shared with everything below: leave it empty, and leave the keyboard to the
	   canvas — the stage's tools are single letters, and `a` typed into a focused field is an `a`. */
	await page.locator(".dockfield").click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.press("Backspace");
	await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
	await page.keyboard.press("Escape");
	await settle(page, 200);
}

// --- arrows: the ends light up what they will join, and can be picked up again -----------------------
{
	await drawnWhereFileSays("g-a");
	await drawnWhereFileSays("g-b");
	const had = new Set(onDisk().children.map((n) => n.id));
	const a = await centre("g-a");
	m = await matrix();
	const free = { x: room.x + 560, y: room.y + 260 };
	await page.keyboard.press("a");
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(a.x + 60, a.y + 60, { steps: 4 });
	const lit = await count(".pen-join");
	await page.mouse.move(free.x, free.y, { steps: 6 });
	await page.mouse.up();
	say("drawing an arrow lights up what its start joins", lit === 1, String(lit));
	const arrow = await until(() => onDisk().children.find((n) => !had.has(n.id) && n.metadata?.type === "decks.arrow"));
	say("an arrow let go on bare canvas joins its start and stops at a point", arrow?.metadata.from === "g-a" && Array.isArray(arrow?.metadata.to), JSON.stringify(arrow?.metadata));
	const end = await until(() => page.evaluate(() => {
		const h = document.querySelector('.pen-handle[data-end="to"]');
		if (!h) return undefined;
		const r = h.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}));
	say("…and the selected arrow has a handle on each end", !!end && (await count(".pen-handle[data-end]")) === 2);
	if (end && arrow) {
		const b = await centre("g-b");
		await page.mouse.move(end.x, end.y);
		await page.mouse.down();
		await page.mouse.move((end.x + b.x) / 2, (end.y + b.y) / 2, { steps: 4 });
		await page.mouse.move(b.x, b.y, { steps: 4 });
		const litEnd = await count(".pen-join");
		await page.mouse.up();
		say("carrying an end over an item lights it up", litEnd === 1, String(litEnd));
		const rejoined = await until(() => onDisk().children.find((n) => n.id === arrow.id)?.metadata.to === "g-b");
		say("…and letting go joins the arrow to it", !!rejoined, JSON.stringify(onDisk().children.find((n) => n.id === arrow.id)?.metadata));
		// Its style, from the bar: a curve, heads at both ends, dashed. The path is redrawn from it.
		await page.click('.pen-bar [data-route="curved"]');
		const curved = await until(() => {
			const now = onDisk().children.find((n) => n.id === arrow.id);
			// Two items side by side on one level are joined by a straight line even when curved.
			return now?.metadata.route === "curved" ? now : undefined;
		});
		say("an arrow's bar makes it curved", !!curved, JSON.stringify(onDisk().children.find((n) => n.id === arrow.id)?.metadata));
		await page.click('.pen-bar [data-heads="both"]');
		await page.click('.pen-bar [aria-label="Dashed line"]');
		const styled = await until(() => {
			const now = onDisk().children.find((n) => n.id === arrow.id);
			return now?.metadata.heads === "both" && now.metadata.dash === true && now.geometry.split("M").length - 1 === 3 ? now : undefined;
		});
		say("…with a head at each end, and dashed", !!styled, JSON.stringify(onDisk().children.find((n) => n.id === arrow.id)?.metadata));
		await page.click('.pen-bar [data-route="straight"]');
		const straight = await until(() => {
			const now = onDisk().children.find((n) => n.id === arrow.id);
			return now && now.metadata.route === undefined && !/ C/.test(now.geometry) ? now : undefined;
		});
		say("…and straight again drops the route from the file", !!straight, JSON.stringify(onDisk().children.find((n) => n.id === arrow.id)?.metadata));
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: arrow.id }] });
	}
	await page.keyboard.press("Escape");
}

// --- a finger taps to select, and drags what is selected --------------------------------------------
{
	await drawnWhereFileSays("g-a");
	const a = await centre("g-a");
	const touch = (type, id, x, y, target = ".pen-hits") =>
		page.evaluate(({ type, id, x, y, target }) => {
			const t = type === "pointerdown" ? document.elementFromPoint(x, y) : document.querySelector(target) ?? window;
			t.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 31, clientX: x, clientY: y, bubbles: true, composed: true, buttons: type === "pointerup" ? 0 : 1 }));
		}, { type, id, x, y, target });
	await touch("pointerdown", 31, a.x, a.y);
	await touch("pointerup", 31, a.x, a.y);
	say("a finger's tap selects an item", !!(await until(() => count(".pen-selection").then((n) => n === 1), 2000)));
	const was = item("g-a").x;
	m = await matrix();
	await touch("pointerdown", 31, a.x, a.y);
	for (let i = 1; i <= 6; i += 1) await touch("pointermove", 31, a.x + i * 10, a.y);
	await touch("pointerup", 31, a.x + 60, a.y);
	const dragged = await until(() => Math.abs(item("g-a").x - was - Math.round(60 / m.a)) <= 2);
	say("…and once it is selected, a finger drags it", !!dragged, JSON.stringify({ was, now: item("g-a").x }));
	await page.keyboard.press("Escape");
}

// --- typing into a note: the editor sits exactly on it, and the canvas stops drawing its words -------
{
	const at = item("g-b");
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "g-note", content: "Words to edit" }, box: { x1: at.x, y1: at.y + at.height + Math.round(60 / m.a) } }] });
	await until(() => page.evaluate(() => !!document.querySelector('.pen-hits [data-id="g-note"]')));
	// A note is as tall as its words, so the file has no size for it: aim at what is drawn.
	await settle(page, 400);
	const c = await page.evaluate(() => {
		const r = document.querySelector('.pen-hits [data-id="g-note"]').getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	});
	await page.mouse.dblclick(c.x, c.y);
	const fit = await until(() => page.evaluate(() => {
		const editor = document.querySelector(".pen-text");
		const hit = document.querySelector('.pen-hits [data-id="g-note"]');
		if (!editor || !hit) return undefined;
		const e = editor.getBoundingClientRect();
		const h = hit.getBoundingClientRect();
		return { dx: Math.abs(e.x - h.x), dy: Math.abs(e.y - h.y), dw: Math.abs(e.width - h.width), handles: document.querySelectorAll(".pen-handle").length };
	}), 3000);
	say("double-clicking a note opens an editor exactly on it, with no handles over it", !!fit && fit.dx < 2 && fit.dy < 2 && fit.dw < 2 && fit.handles === 0, JSON.stringify(fit));
	// The editor takes the caret a frame after it opens.
	await until(() => page.evaluate(() => document.activeElement?.classList.contains("pen-text")), 2000);
	await page.keyboard.press("End");
	await page.keyboard.type(" and more");
	// A double-click inside the editor picks a word; it is not a double-click on the canvas.
	const boardsBefore = await count(".board-node");
	const inEditor = await page.evaluate(() => {
		const r = document.querySelector(".pen-text").getBoundingClientRect();
		return { x: r.x + 20, y: r.y + r.height / 2 };
	});
	await page.mouse.dblclick(inEditor.x, inEditor.y);
	await settle(page, 800);
	say("a double-click inside the editor makes no board", (await count(".board-node")) === boardsBefore && (await count(".pen-text")) === 1, `${boardsBefore} -> ${await count(".board-node")}`);
	await page.keyboard.press("Control+Enter");
	say("…and what is typed is the note's words in the file", !!(await until(() => item("g-note")?.content === "Words to edit and more")));
	await page.keyboard.press("Escape");
}

// --- a card grows round its title as the title is typed ----------------------------------------------
{
	const had = new Set(onDisk().children.map((n) => n.id));
	const at = await page.evaluate(() => {
		const r = document.querySelector('.pen-hits [data-id="g-note"]').getBoundingClientRect();
		return { x: r.x, y: r.y + r.height + 40 };
	});
	await page.keyboard.press("c");
	await page.mouse.click(at.x, at.y);
	const card = await until(() => onDisk().children.find((n) => !had.has(n.id) && n.metadata?.type === "decks.markdown"));
	await until(() => page.evaluate(() => document.activeElement?.classList.contains("pen-text")), 3000);
	const height = () => page.evaluate((id) => document.querySelector(`.pen-hits [data-id="${id}"]`)?.getBoundingClientRect().height ?? 0, card?.id);
	const before = await until(height, 3000);
	await page.keyboard.type("# A heading\n\nA paragraph long enough to wrap onto a second and then a third line of the card\n\n- a point\n- another");
	const grown = await until(async () => (await height()) > before * 1.3, 3000);
	say("a card grows round its markdown while it is typed, before it is saved", !!grown, JSON.stringify({ before, now: await height() }));
	await page.keyboard.press("Control+Enter");
	await page.keyboard.press("Escape");
	if (card) link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: card.id }] });
}

// --- edit mode: items and boards outline themselves under the pointer --------------------------------
{
	await editMode(page, true);
	await drawnWhereFileSays("g-a");
	const a = await centre("g-a");
	await page.mouse.move(a.x, a.y);
	say("in edit mode an item outlines itself under the pointer, before any press", !!(await until(() => count(".pen-hover:not([data-board])").then((n) => n === 1), 2000)));
	await page.mouse.move(room.x + 5, room.y + 5);
	say("…and the outline goes when the pointer leaves it", !!(await until(() => count(".pen-hover").then((n) => n === 0), 2000)));
	const spot = await page.evaluate(() => {
		for (const node of document.querySelectorAll(".board-node")) {
			if (node.dataset.selected === "true") continue;
			const r = node.getBoundingClientRect();
			const x = r.x + r.width - 30;
			const y = r.y + Math.min(80, r.height / 2);
			if (x > 320 && x < 1560 && y > 120 && y < 880 && document.elementFromPoint(x, y)?.closest(".board-node") === node) return { x, y, path: node.dataset.path };
		}
	});
	if (spot) {
		await page.mouse.move(spot.x, spot.y, { steps: 3 });
		const outlined = await until(() => page.evaluate((path) => {
			const hover = document.querySelector('.pen-hover[data-board="true"]');
			const node = document.querySelector(`.board-node[data-path="${CSS.escape(path)}"]`);
			if (!hover || !node) return undefined;
			const h = hover.getBoundingClientRect();
			const n = node.getBoundingClientRect();
			return Math.abs(h.x - n.x) < 2 && Math.abs(h.width - n.width) < 2 ? { width: getComputedStyle(hover).boxShadow } : undefined;
		}, spot.path), 2000);
		say("…and a board does too, round its own edge", !!outlined, JSON.stringify(outlined));
		await editMode(page, false);
		await page.mouse.move(spot.x - 4, spot.y + 4);
		await settle(page, 200);
		say("…and not when browsing", (await count(".pen-hover")) === 0);
	} else say("a board is on screen to hover", false);
}

// --- a board's bar and handles: the words fill the bar at rest; the handles are an item's, at any zoom --
{
	// The boards sit behind the panel and under the composer here, so the canvas is panned to them and back.
	const find = () => page.evaluate(() => {
		for (const chrome of document.querySelectorAll(".bar-layer .chrome")) {
			const r = chrome.getBoundingClientRect();
			for (const x of [r.x + 30, r.x + r.width * 0.3, r.x + r.width * 0.5]) {
				const y = r.y + r.height / 2;
				if (x > 320 && x < 1500 && y > 290 && y < 880 && document.elementFromPoint(x, y)?.closest(".chrome") === chrome) return { x, y, path: chrome.dataset.path };
			}
		}
	});
	await page.mouse.move(900, 500);
	let target = await find();
	let panned = { x: 0, y: 0 };
	for (let tries = 0; !target && tries < 4; tries += 1) {
		await page.mouse.wheel(-200, 250);
		panned = { x: panned.x - 200, y: panned.y + 250 };
		await settle(page, 400);
		target = await find();
	}
	say("a board's title bar is on screen to press", !!target);
	if (target) {
		const acts = () => page.evaluate((path) => getComputedStyle(document.querySelector(`.bar-layer .chrome[data-path="${CSS.escape(path)}"] .acts`)).display, target.path);
		await page.mouse.move(target.x, target.y - 200);
		await settle(page, 150);
		say("at rest a bar's buttons take no room, so its title and path have the whole bar", (await acts()) === "none", await acts());
		await page.mouse.move(target.x, target.y);
		await settle(page, 150);
		say("…and they show while the pointer is over it", (await acts()) === "flex", await acts());
		await page.mouse.click(target.x, target.y);
		const handles = () => page.evaluate((path) => [...document.querySelectorAll(`.pen-handle[data-board="${CSS.escape(path)}"]`)].map((h) => Math.round(h.getBoundingClientRect().width)), target.path);
		const outline = () => page.evaluate(() => {
			const box = document.querySelector('.pen-selection[data-board="true"]');
			const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
			return box ? Math.round(Number.parseFloat(getComputedStyle(box).boxShadow.split(" ").at(-1)) * m.a * 10) / 10 : 0;
		});
		const near = await until(() => handles().then((h) => (h.length === 8 ? h : undefined)), 3000);
		say("a selected board has an item's eight handles", !!near && near.every((w) => w === 9), JSON.stringify(near));
		const nearLine = await outline();
		await page.keyboard.press("Control+Minus");
		await settle(page, 700);
		const far = await handles();
		const farLine = await outline();
		say("…the same size on screen when zoomed out, and so is the outline", far.length === 8 && far.every((w) => w === 9) && nearLine === 1.5 && farLine === 1.5, JSON.stringify({ near, far, nearLine, farLine }));
		await page.keyboard.press("Control+Equal");
		await settle(page, 500);
		await page.keyboard.press("Escape");
	}
	if (panned.x || panned.y) {
		await page.mouse.move(900, 500);
		await page.mouse.wheel(-panned.x, -panned.y);
		await settle(page, 500);
	}
}

// --- the pen: a held stroke straightens, two fingers undo, the lasso resizes -------------------------
await page.click('[aria-label="Draw on the stage"]');
await page.waitForSelector(".stage-ink");
{
	const had = new Set(onDisk().children.map((n) => n.id));
	const p = { x: room.x + 40, y: room.y + 250 };
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	await page.mouse.move(p.x + 60, p.y + 25, { steps: 6 });
	await page.mouse.move(p.x + 180, p.y - 10, { steps: 6 });
	await page.waitForTimeout(800);
	await page.mouse.up();
	const line = await until(() => onDisk().children.find((n) => !had.has(n.id) && n.metadata?.type === "decks.ink"));
	say("a stroke held still at its end straightens into a line", line?.metadata.points.length === 6, JSON.stringify(line?.metadata.points));

	// Two fingers down and up together: the stroke is taken back.
	const sheet = await page.evaluate(() => {
		const r = document.querySelector(".stage-ink").getBoundingClientRect();
		return { x: r.x + r.width - 200, y: r.y + r.height / 2 };
	});
	const finger = (type, id, x, y) =>
		page.evaluate(({ type, id, x, y }) => {
			document.querySelector(".stage-ink").dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 41, clientX: x, clientY: y, bubbles: true, composed: true }));
		}, { type, id, x, y });
	await finger("pointerdown", 41, sheet.x, sheet.y);
	await finger("pointerdown", 42, sheet.x + 60, sheet.y);
	await finger("pointerup", 41, sheet.x, sheet.y);
	await finger("pointerup", 42, sheet.x + 60, sheet.y);
	const undone = await until(() => !onDisk().children.some((n) => n.id === line?.id));
	say("a two-finger tap takes the last stroke back", !!undone);

	// A stroke, picked with a lasso tap, grown by a corner of the lasso's box.
	const had2 = new Set(onDisk().children.map((n) => n.id));
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	await page.mouse.move(p.x + 80, p.y + 10, { steps: 6 });
	await page.mouse.move(p.x + 160, p.y + 20, { steps: 6 });
	await page.mouse.up();
	const stroke = await until(() => onDisk().children.find((n) => !had2.has(n.id) && n.metadata?.type === "decks.ink"));
	await settle(page, 400);
	await page.click('.ink-bar [aria-label^="Lasso"]');
	await page.mouse.click(p.x + 80, p.y + 10);
	const corner = await until(() => page.evaluate(() => {
		const c = document.querySelector('.ink-corner[data-corner="se"]');
		if (!c) return undefined;
		const r = c.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}), 3000);
	say("the lasso's box has corners to resize by", !!corner);
	if (corner && stroke) {
		await page.mouse.move(corner.x, corner.y);
		await page.mouse.down();
		await page.mouse.move(corner.x + 80, corner.y + 40, { steps: 6 });
		await page.mouse.move(corner.x + 160, corner.y + 80, { steps: 6 });
		await page.mouse.up();
		// Grown, and by about what the hand dragged: not a runaway.
		const grown = await until(() => {
			const width = onDisk().children.find((n) => n.id === stroke.id)?.width ?? 0;
			return width > stroke.width * 1.5 && width < stroke.width * 3;
		});
		say("…and dragging one grows what the lasso holds", !!grown, JSON.stringify({ was: stroke.width, now: onDisk().children.find((n) => n.id === stroke.id)?.width }));
		link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: stroke.id }] });
	}
}
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.id.startsWith("g-")).map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 300);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
