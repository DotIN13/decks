/**
 * The stage as a pen.dev file: boards as `browser` items, a drawing under them, edits from the
 * wire, from the file and by hand, all ending in the same `stages/<name>/stage.pen`.
 *
 * Needs no model: the edits an agent would make with `stage.pen.edit` go over the wire as
 * `stage.pen.edit`, which is the same operation through the same server path.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, deckState, editMode, open, resetStage, say, selectBoard, settle, socket } from "../harness.mjs";

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

// --- an edit from the wire: a note, and an arrow from it to a board --------------------------------
const firstBoard = deck.boards[0].path;
// On empty canvas the page shows, so the hand edit below lands on the note and not on a board.
const middle = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 140; y < 820; y += 30) {
		for (let x = 320; x < 1500; x += 30) {
			if (empty(x, y) && empty(x + 80, y) && empty(x, y + 40) && empty(x + 80, y + 40)) return { x: (x - m.e) / m.a, y: (y - m.f) / m.a };
		}
	}
	return { x: (800 - m.e) / m.a, y: (500 - m.f) / m.a };
});
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{ op: "insert", node: { type: "note", id: "e2e-note", content: "Drawn by the check" }, box: { x1: Math.round(middle.x), y1: Math.round(middle.y) } },
		{ op: "insert", node: { type: "path", id: "e2e-arrow", metadata: { type: "decks.arrow", from: "e2e-note", to: firstBoard } } },
	],
});
const frame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.doc.children.some((n) => n.id === "e2e-note")).at(-1));
say("an edit comes back as a stage.pen frame", !!frame);
const file = frame ? join(deck.path, "stages", frame.stage, "stage.pen") : "";
const onDisk = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { children: [] });
say("the stage is a pen file on disk", existsSync(file), file);
const doc = onDisk();
say("its version is pen's", typeof doc.version === "string" && /^\d+\.\d+$/.test(doc.version), doc.version);

// --- boards are browser items in it --------------------------------------------------------------
const boardItems = () => onDisk().children.filter((n) => n.type === "browser" && n.metadata?.type === "decks.board");
const shownPaths = (await until(() => boardItems().length >= deck.boards.length && boardItems())) || boardItems();
say("every board on the stage is a browser item in the file", deck.boards.every((b) => shownPaths.some((n) => n.metadata.path === b.path)), `${shownPaths.length} of ${deck.boards.length}`);
const item = shownPaths.find((n) => n.metadata.path === firstBoard);
say("a board item points at the board's file, relative to the stage", item?.url === `../../${firstBoard}`, item?.url);

// --- the arrow was routed to the board ------------------------------------------------------------
const arrow = onDisk().children.find((n) => n.id === "e2e-arrow");
say("an arrow to a board is drawn when it is made", typeof arrow?.geometry === "string" && arrow.geometry.startsWith("M"), arrow?.geometry);

// --- moving a board moves its item, and the arrow follows ------------------------------------------
const before = arrow?.geometry;
link.send({ type: "board.move", path: firstBoard, x: (item?.x ?? 0) + 400, y: (item?.y ?? 0) + 300 });
const movedItem = await until(() => {
	const now = onDisk().children.find((n) => n.metadata?.path === firstBoard);
	return now && now.x === (item?.x ?? 0) + 400 ? now : undefined;
});
say("a board moved on the canvas is moved in the file", !!movedItem, JSON.stringify(movedItem && { x: movedItem.x, y: movedItem.y }));
const followed = await until(() => onDisk().children.find((n) => n.id === "e2e-arrow")?.geometry !== before);
say("…and the arrow that ends on it follows", !!followed);

// --- the drawing is drawn --------------------------------------------------------------------------
const drawn = await until(() => page.evaluate(() => {
	// The stage's one sheet, painted in a worker: shown, and sized from the frame it was handed.
	const canvas = document.querySelector(".stage-sheet");
	return !!canvas && !canvas.hidden && parseFloat(canvas.style.width) > 1;
}), 15000);
say("the drawing layer is on screen", !!drawn);

// --- a picture of the stage, taken by the server's own Chromium --------------------------------------
const shotAt = Date.now();
const shot = await fetch(`${API}/api/stage-shot?agent=${agentId}&of=e2e-note&format=png`);
const png = Buffer.from(await shot.arrayBuffer());
const pngSize = png.length > 24 && png.readUInt32BE(0) === 0x89504e47 ? { w: png.readUInt32BE(16), h: png.readUInt32BE(20) } : undefined;
say("the server takes a PNG of an item on the stage", shot.status === 200 && !!pngSize, `${shot.status} ${JSON.stringify(pngSize)} in ${Date.now() - shotAt} ms`);
// The note is 240 wide and framed with 24 on each side, at scale 2.
say("…framed on the item with a margin, at twice the pixels", pngSize?.w === (240 + 48) * 2, JSON.stringify(pngSize));
const whole = await fetch(`${API}/api/stage-shot?agent=${agentId}&format=pdf`);
say("…and the whole stage as a PDF", whole.status === 200 && Buffer.from(await whole.arrayBuffer()).subarray(0, 4).toString() === "%PDF", String(whole.status));

// --- a hand edit of the file reaches the browser ----------------------------------------------------
const revBefore = link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId).at(-1)?.rev ?? 0;
const text = onDisk();
text.children.find((n) => n.id === "e2e-note").content = "Edited in the file";
writeFileSync(file, `${JSON.stringify(text, null, 2)}\n`);
const handFrame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.rev > revBefore).at(-1));
say("a hand edit of the file is sent to the browser", handFrame?.doc.children.find((n) => n.id === "e2e-note")?.content === "Edited in the file");

// --- by hand in the page: select and drag the note, then delete it ----------------------------------
await editMode(page, true);
// Bring the note into view: the camera looks at it through the stage's own transform.
const note = onDisk().children.find((n) => n.id === "e2e-note");
const screen = await page.evaluate(({ x, y }) => {
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	return { x: m.e + x * m.a, y: m.f + y * m.a, zoom: m.a };
}, { x: note.x + 4 / 0.2, y: note.y + 4 / 0.2 });
const inView = screen.x > 280 && screen.x < 1580 && screen.y > 80 && screen.y < 900;
if (inView) {
	await page.mouse.move(screen.x, screen.y);
	await page.mouse.down();
	await page.mouse.move(screen.x + 40, screen.y + 30, { steps: 6 });
	await page.mouse.move(screen.x + 80, screen.y + 60, { steps: 6 });
	await page.mouse.up();
	const dragged = await until(() => {
		const now = onDisk().children.find((n) => n.id === "e2e-note");
		return now && Math.abs(now.x - (note.x + Math.round(80 / screen.zoom))) <= 2 ? now : undefined;
	});
	say("a drag in edit mode moves the drawn item in the file", !!dragged, JSON.stringify({ was: [note.x, note.y], zoom: screen.zoom }));
	await page.keyboard.press("Delete");
	const gone = await until(() => !onDisk().children.some((n) => n.id === "e2e-note"));
	say("Delete removes the selected item", !!gone);
} else {
	say("the note is on screen to be dragged", false, JSON.stringify(screen));
}
// --- the drawing tools: a rectangle drawn by hand, a fill from the bar, and undo ---------------------
const spot = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 200; y < 820; y += 30) {
		for (let x = 340; x < 1400; x += 30) {
			if (empty(x, y) && empty(x + 160, y) && empty(x, y + 110) && empty(x + 160, y + 110)) return { x, y };
		}
	}
});
say("the canvas has room to draw in", !!spot);
let drawnId;
let cardId;
if (spot) {
	await page.mouse.click(spot.x + 150, spot.y + 100);
	await page.keyboard.press("r");
	const armed = await page.evaluate(() => document.querySelector(".stage").dataset.penTool);
	say("R arms the rectangle tool", armed === "rectangle", armed);
	const had = new Set(onDisk().children.map((n) => n.id));
	await page.mouse.move(spot.x, spot.y);
	await page.mouse.down();
	await page.mouse.move(spot.x + 60, spot.y + 40, { steps: 5 });
	await page.mouse.move(spot.x + 120, spot.y + 80, { steps: 5 });
	await page.mouse.up();
	const rect = await until(() => onDisk().children.find((n) => n.type === "rectangle" && !had.has(n.id)));
	drawnId = rect?.id;
	say("a drag with the rectangle tool draws one into the file", !!rect && rect.width > 0 && rect.height > 0, JSON.stringify(rect));
	const handles = await until(() => page.evaluate(() => document.querySelectorAll('.pen-handle:not([data-handle="radius"])').length === 8));
	say("…and it is selected, with eight handles", !!handles);
	await page.locator('.props-panel [aria-label="Fill #fde68a"]').click();
	const filled = await until(() => onDisk().children.find((n) => n.id === drawnId)?.fill === "#fde68a");
	say("the properties panel's fill colours the selected item in the file", !!filled);
	await page.keyboard.press("Control+z");
	const undone = await until(() => onDisk().children.find((n) => n.id === drawnId)?.fill === "#dbe4f0");
	say("⌘Z takes back the person's own last edit", !!undone, JSON.stringify(onDisk().children.find((n) => n.id === drawnId)?.fill));

	// A card is pen's own note with a mark that says its words are markdown, and it opens for typing.
	await page.keyboard.press("Escape");
	const before = new Set(onDisk().children.map((n) => n.id));
	await page.keyboard.press("c");
	await page.mouse.click(spot.x + 10, spot.y + 150);
	const card = await until(() => onDisk().children.find((n) => !before.has(n.id) && n.type === "note"));
	cardId = card?.id;
	say("C then a click makes a card: a note marked as markdown", card?.metadata?.type === "decks.markdown", JSON.stringify(card));
	const typing = await until(() => page.evaluate(() => document.activeElement?.classList.contains("pen-text")));
	say("…and it opens for typing", !!typing);
	await page.keyboard.type("## Plan\n\n- **one**\n- two");
	await page.keyboard.press("Control+Enter");
	const titled = await until(() => onDisk().children.find((n) => n.id === cardId)?.content === "## Plan\n\n- **one**\n- two");
	say("…and what is typed is its markdown in the file, as typed", !!titled, JSON.stringify(onDisk().children.find((n) => n.id === cardId)?.content));
	// --- the corner radius, the turn, and a card sized by its width alone ---------------------------
	// The rectangle again: it has corners to round and a size to turn, where a card has neither.
	await page.keyboard.press("Escape");
	const rectBox = () => page.evaluate((id) => globalThis.__decksPenBox?.(id), drawnId);
	const onRect = await rectBox();
	await page.mouse.click(onRect.x + onRect.width / 2, onRect.y + onRect.height / 2);
	await until(() => page.evaluate(() => document.querySelectorAll('.pen-handle[data-handle="radius"]').length === 1));
	const extras = await page.evaluate(() => ({
		radius: document.querySelectorAll('.pen-handle[data-handle="radius"]').length,
		grips: document.querySelectorAll(".pen-rotate").length,
	}));
	say("a selected rectangle has one radius handle and four reaches to turn it by", extras.radius === 1 && extras.grips === 4, JSON.stringify(extras));

	// Dragging the radius handle along the diagonal rounds every corner, in the file.
	const radiusAt = () => page.evaluate(() => {
		const h = document.querySelector('.pen-handle[data-handle="radius"]').getBoundingClientRect();
		return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
	});
	const grabRadius = await radiusAt();
	await page.mouse.move(grabRadius.x, grabRadius.y);
	await page.mouse.down();
	await page.mouse.move(grabRadius.x + 12, grabRadius.y + 12, { steps: 4 });
	await page.mouse.move(grabRadius.x + 24, grabRadius.y + 24, { steps: 4 });
	await page.mouse.up();
	const round = await until(() => {
		const r = onDisk().children.find((n) => n.id === drawnId)?.cornerRadius;
		return typeof r === "number" && r > 8 ? r : undefined;
	});
	say("dragging the radius handle rounds the corners in the file", !!round, `cornerRadius ${round}`);

	// Dragging from just outside a corner turns it, and the turn is written with the corner it turns about.
	const gripAt = (which) => page.evaluate((grip) => {
		const h = document.querySelector(`.pen-rotate[data-grip="${grip}"]`)?.getBoundingClientRect();
		return h ? { x: h.left + h.width / 2, y: h.top + h.height / 2 } : undefined;
	}, which);
	const grip = await gripAt("ne");
	const spun = await (async () => {
		if (!grip) return undefined;
		const mid = await rectBox();
		const centre = { x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 };
		await page.mouse.move(grip.x, grip.y);
		await page.mouse.down();
		// A quarter of the way round the middle, in three steps so the drag is seen as one.
		for (const t of [0.12, 0.25, 0.4]) {
			const a0 = Math.atan2(grip.y - centre.y, grip.x - centre.x);
			const r = Math.hypot(grip.x - centre.x, grip.y - centre.y);
			await page.mouse.move(centre.x + r * Math.cos(a0 + t), centre.y + r * Math.sin(a0 + t), { steps: 4 });
		}
		await page.mouse.up();
		return until(() => {
			const deg = onDisk().children.find((n) => n.id === drawnId)?.rotation;
			return typeof deg === "number" && deg !== 0 ? deg : undefined;
		});
	})();
	say("dragging outside a corner turns the item, counter-clockwise in the file", !!spun && spun > 300, `rotation ${spun}`);
	// It is still selected after the drag, and its outline is turned with it rather than left upright.
	const onItem = await page.evaluate(() => {
		const sel = document.querySelector(".pen-selection:not([data-board])");
		const turn = sel && getComputedStyle(sel).transform;
		const rect = sel?.getBoundingClientRect();
		return {
			turned: !!turn && turn !== "none",
			handles: document.querySelectorAll('.pen-handle:not([data-handle="radius"])').length,
			middle: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined,
		};
	});
	const seenTurn = await page.evaluate((id) => globalThis.__decksPenTurn?.(id), drawnId);
	say("…and its outline is turned with it, handles and all", onItem.turned && onItem.handles === 8, JSON.stringify({ turned: onItem.turned, handles: onItem.handles, seenTurn }));
	/*
	 * Turned, it is still the item the pointer finds: a press is carried back through the turn before
	 * the box test. The middle of where it is drawn, which is not the middle of the upright box the
	 * layout gave it — that is the whole point.
	 */
	const stillThere = await (async () => {
		if (!onItem.middle) return undefined;
		await page.keyboard.press("Escape");
		await settle(page, 300);
		const upright = await rectBox();
		const apart = Math.hypot(onItem.middle.x - (upright.x + upright.width / 2), onItem.middle.y - (upright.y + upright.height / 2));
		await page.mouse.click(onItem.middle.x, onItem.middle.y);
		const got = await until(() => page.evaluate(() => document.querySelectorAll(".pen-selection:not([data-board])").length === 1));
		return { got, apart };
	})();
	say("…and a click in the middle of where it is drawn selects it, not the board under it", !!stillThere?.got, JSON.stringify(stillThere));

	/*
	 * Everything the canvas draws round a turned item has to be on the item, not on the upright box
	 * the layout gave it: the eight sizing handles, the radius handle, the four reaches to turn by,
	 * and the anchors an arrow leaves from. Each was its own oversight once.
	 */
	const around = await page.evaluate(() => {
		const sel = document.querySelector(".pen-selection:not([data-board])")?.getBoundingClientRect();
		if (!sel) return undefined;
		const spread = (list) => {
			const mid = [...list].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
			// How far the set reaches beyond the upright box, which is what being left behind looks like.
			return mid.length === 0 ? undefined : Math.max(...mid.map((p) => Math.max(sel.x - p.x, p.x - (sel.x + sel.width), sel.y - p.y, p.y - (sel.y + sel.height))));
		};
		return {
			sizers: document.querySelectorAll('.pen-handle:not([data-handle="radius"])').length,
			radius: document.querySelectorAll('.pen-handle[data-handle="radius"]').length,
			grips: document.querySelectorAll(".pen-rotate").length,
			anchors: document.querySelectorAll(".pen-anchor").length,
			/* The turned corners stick out of the upright box; nothing may sit wholly inside it unmoved. */
			out: spread(document.querySelectorAll('.pen-handle, .pen-rotate, .pen-anchor')),
			cursor: getComputedStyle(document.querySelector('.pen-rotate[data-grip="nw"]')).cursor.slice(0, 22),
		};
	});
	say("a turned item has its radius handle and its arrow anchors too", !!around && around.radius === 1 && around.anchors === 4 && around.grips === 4, JSON.stringify(around && { ...around, out: Math.round(around.out) }));
	// Every one of them turned with it: on an upright item they would all sit inside the box.
	say("…and they are placed on the item, not on the upright box it was laid out in", !!around && around.out > 2, `reaches ${Math.round(around?.out ?? 0)}px past the upright box`);
	say("…and the reaches to turn it have a cursor of their own", (around?.cursor ?? "").startsWith("url("), String(around?.cursor));

	/*
	 * And carrying a turned item takes its outline with it exactly. The turn is taken about the
	 * item's own corner, so while it is being dragged that corner has to move too — otherwise it
	 * rotates about where it used to be and the outline slides off the item as the drag goes on.
	 */
	const carried = await (async () => {
		const rect = () => page.evaluate(() => {
			const el = document.querySelector(".pen-selection:not([data-board])");
			const r = el?.getBoundingClientRect();
			return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : undefined;
		});
		const was = await rect();
		const inside = await page.evaluate((id) => globalThis.__decksPenBox?.(id), drawnId);
		if (!was || !inside) return undefined;
		await page.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
		await page.mouse.down();
		// ⌘ off, Control on: snapping would add a few pixels of its own and this is about the turn.
		await page.keyboard.down("Control");
		await page.mouse.move(inside.x + inside.width / 2 + 20, inside.y + inside.height / 2 + 13, { steps: 4 });
		await page.mouse.move(inside.x + inside.width / 2 + 40, inside.y + inside.height / 2 + 26, { steps: 4 });
		await settle(page, 150);
		const now = await rect();
		await page.mouse.up();
		await page.keyboard.up("Control");
		await settle(page, 400);
		return now && { dx: Math.round(now.x - was.x), dy: Math.round(now.y - was.y), dw: Math.round(now.w - was.w), dh: Math.round(now.h - was.h) };
	})();
	say("carrying a turned item moves its outline by the same amount, and never reshapes it", !!carried && Math.abs(carried.dx - 40) <= 2 && Math.abs(carried.dy - 26) <= 2 && Math.abs(carried.dw) <= 1 && Math.abs(carried.dh) <= 1, JSON.stringify(carried));

	// A card is as tall as its words: two side handles, and a drag writes no height.
	await page.keyboard.press("Escape");
	await settle(page, 200);
	const cardBox = await page.evaluate((id) => globalThis.__decksPenBox?.(id), cardId);
	await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + 8);
	const two = await until(() => page.evaluate(() => {
		const all = [...document.querySelectorAll('.pen-handle:not([data-handle="radius"])')].map((h) => h.dataset.handle).sort();
		return all.length === 2 && all.join(",") === "e,w" ? all : undefined;
	}));
	say("a card shows its two side handles alone, because its height is its words'", !!two, JSON.stringify(two));
	const wasCard = onDisk().children.find((n) => n.id === cardId);
	const east = await page.evaluate(() => {
		const h = document.querySelector('.pen-handle[data-handle="e"]').getBoundingClientRect();
		return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
	});
	await page.mouse.move(east.x, east.y);
	await page.mouse.down();
	await page.mouse.move(east.x + 40, east.y, { steps: 4 });
	await page.mouse.move(east.x + 80, east.y, { steps: 4 });
	await page.mouse.up();
	const widened = await until(() => {
		const card = onDisk().children.find((n) => n.id === cardId);
		return card && card.width !== wasCard?.width ? card : undefined;
	});
	say("dragging its side sets its width, and pins no height on it", !!widened && widened.height === undefined, JSON.stringify({ width: widened?.width, height: widened?.height }));
}
// --- boards at the back: a drawing over a board catches its own clicks; the selected board rises ---
const boardItem = onDisk().children.find((n) => n.metadata?.path === firstBoard);
if (boardItem) {
	const w = Math.round((boardItem.width ?? 400) * 0.4);
	const h = Math.round((boardItem.height ?? 300) * 0.3);
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "e2e-over", fill: "#bfdbfe" }, box: { x1: boardItem.x + 20, y1: boardItem.y + 20, x2: boardItem.x + 20 + w, y2: boardItem.y + 20 + h } }] });
	await until(() => onDisk().children.some((n) => n.id === "e2e-over"));
	await page.keyboard.press("Escape");
	// Close enough that the board is live: below that zoom a board is a picture and a click only selects it.
	await selectBoard(page, firstBoard);
	await page.keyboard.press("1");
	await settle(page, 1200);
	await page.keyboard.press("Escape");
	await settle(page, 200);
	const at = await page.evaluate(({ x, y }) => {
		const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
		return { x: m.e + x * m.a, y: m.f + y * m.a };
	}, { x: boardItem.x + 20 + w / 2, y: boardItem.y + 20 + h / 2 });
	const under = () => page.evaluate(({ x, y }) => {
		const e = document.elementFromPoint(x, y);
		return e?.closest(".board-node") ? "board" : e?.classList.contains("pen-hit") ? `drawing:${e.dataset.id}` : e?.className?.baseVal ?? e?.className ?? "nothing";
	}, at);
	const shown = await until(() => under().then((u) => u.startsWith("drawing") && u));
	say("a drawing over a board is on top of it and catches the click there", shown === "drawing:e2e-over", await under());
	const node = page.locator(`.board-node[data-path="${firstBoard}"]`);
	// A point where this board is the top thing: not another board over it, not a drawn item.
	const free = await page.evaluate((path) => {
		const n = document.querySelector(`.board-node[data-path="${CSS.escape(path)}"]`);
		const r = n.getBoundingClientRect();
		for (let y = r.y + r.height - 8; y > r.y + 30; y -= 7) {
			for (let x = r.x + r.width - 8; x > r.x + 8; x -= 7) {
				if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
				if (document.elementFromPoint(x, y)?.closest(".board-node") === n) return { x, y };
			}
		}
	}, firstBoard);
	say("the board has an uncovered spot on screen", !!free);
	// Count the presses the board's own page receives.
	await node.evaluate((n) => {
		const doc = n.querySelector("iframe").contentDocument;
		doc.__presses = 0;
		doc.addEventListener("pointerdown", () => (doc.__presses += 1), true);
	});
	const presses = () => node.evaluate((n) => n.querySelector("iframe").contentDocument.__presses);
	if (free) await page.mouse.click(free.x, free.y);
	const reached = await until(() => node.evaluate((n) => n.dataset.selected === "true"));
	say("a click beside the drawing goes straight through to the board's page, with nothing to lift first", !!reached && (await presses()) === 1, `presses ${await presses()}`);
	say("…and the drawing stays on top of the selected board", (await under()) === "drawing:e2e-over", await under());
	await page.mouse.click(at.x, at.y);
	await settle(page, 300);
	say("a click on the drawing does not reach the page under it", (await presses()) === 1, `presses ${await presses()}`);
}
await editMode(page, false);

// Leave the fixture's stage as it was, minus the check's own drawing.
link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.id.startsWith("e2e-") || n.id === drawnId || n.id === cardId).map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 300);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
