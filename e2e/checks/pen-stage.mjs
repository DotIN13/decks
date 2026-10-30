/**
 * The stage as a pen.dev file: boards as `browser` items, a drawing under them, edits from the
 * wire, from the file and by hand, all ending in the same `canvases/<name>/canvas.pen`.
 *
 * Needs no model: the edits an agent would make with `stage.pen.edit` go over the wire as
 * `stage.pen.edit`, which is the same operation through the same server path.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, editMode, fitCanvas, focusCanvas, open, resetStage, say, selectBoard, settle, socket, rest } from "../harness.mjs";

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
/** The canvas frame: the stage, its tools and its panels are there; the page's chrome is drawn over it. */
const canvas = await canvasFrame(page);
// Framed on the whole canvas, as it opens.
await fitCanvas(page);
/** Whether every point of a box on the page reaches the canvas, not the side panel, a bar or the composer over it. */
const pageClear = (box, step = 20) =>
	page.evaluate(({ x, y, w, h, step }) => {
		for (let dy = 0; dy <= h; dy += step) for (let dx = 0; dx <= w; dx += step) if (document.elementFromPoint(x + dx, y + dy)?.matches("iframe.canvas-frame") !== true) return false;
		return true;
	}, { ...box, step });

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);

// --- an edit from the wire: a note, and an arrow from it to a board --------------------------------
const firstBoard = deck.boards[0].path;
/*
 * On disk a board item's `url` and `metadata.path` are relative to the canvas folder: the canvas's
 * copy `canvases/<canvas>/boards/x.html` is `boards/x.html` in its own file.
 */
const inFolder = (path) => path.replace(/^canvases\/[^/]+\//, "");
// On empty canvas the page shows, so the hand edit below lands on the note and not on a board.
const middle = await (async () => {
	const { found, m } = await canvas.evaluate(() => {
		const stage = document.querySelector(".stage");
		const t = new DOMMatrix(globalThis.__decksCameraTransform());
		const empty = (x, y) => document.elementFromPoint(x, y) === stage;
		const out = [];
		for (let y = 140; y < 820; y += 30) {
			for (let x = 320; x < 1500; x += 30) {
				if (empty(x, y) && empty(x + 80, y) && empty(x, y + 40) && empty(x + 80, y + 40)) out.push({ x, y });
			}
		}
		return { found: out, m: { a: t.a, e: t.e, f: t.f } };
	});
	for (const at of found) if (await pageClear({ x: at.x, y: at.y, w: 80, h: 40 }, 40)) return { x: (at.x - m.e) / m.a, y: (at.y - m.f) / m.a };
	return { x: (800 - m.e) / m.a, y: (500 - m.f) / m.a };
})();
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
const file = frame ? join(deck.path, "canvases", frame.stage, "canvas.pen") : "";
/*
 * The stage file as it is now. Tolerant of a torn read: the server rewrites it while a check is
 * polling, and reading it mid-write once crashed a whole check on a JSON error. The last good
 * answer stands until the next complete one.
 */
let lastGood = { children: [] };
const onDisk = () => {
	if (!existsSync(file)) return { children: [] };
	try {
		lastGood = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		/* half-written; the poll comes round again */
	}
	return lastGood;
};
say("the stage is a pen file on disk", existsSync(file), file);
const doc = onDisk();
say("its version is pen's", typeof doc.version === "string" && /^\d+\.\d+$/.test(doc.version), doc.version);

// --- boards are browser items in it --------------------------------------------------------------
const boardItems = () => onDisk().children.filter((n) => n.type === "browser" && n.metadata?.type === "decks.board");
const shownPaths = (await until(() => boardItems().length >= deck.boards.length && boardItems())) || boardItems();
say("every board on the stage is a browser item in the file", deck.boards.every((b) => shownPaths.some((n) => n.metadata.path === inFolder(b.path))), `${shownPaths.length} of ${deck.boards.length}`);
const item = shownPaths.find((n) => n.metadata.path === inFolder(firstBoard));
say("a board item points at the board's file, relative to the stage", item?.url === inFolder(firstBoard), item?.url);

// --- the arrow was routed to the board ------------------------------------------------------------
const arrow = onDisk().children.find((n) => n.id === "e2e-arrow");
say("an arrow to a board is drawn when it is made", typeof arrow?.geometry === "string" && arrow.geometry.startsWith("M"), arrow?.geometry);

// --- moving a board moves its item, and the arrow follows ------------------------------------------
const before = arrow?.geometry;
link.send({ type: "board.move", path: firstBoard, x: (item?.x ?? 0) + 400, y: (item?.y ?? 0) + 300 });
const movedItem = await until(() => {
	const now = onDisk().children.find((n) => n.metadata?.path === inFolder(firstBoard));
	return now && now.x === (item?.x ?? 0) + 400 ? now : undefined;
});
say("a board moved on the canvas is moved in the file", !!movedItem, JSON.stringify(movedItem && { x: movedItem.x, y: movedItem.y }));
const followed = await until(() => onDisk().children.find((n) => n.id === "e2e-arrow")?.geometry !== before);
say("…and the arrow that ends on it follows", !!followed);

// --- the drawing is drawn --------------------------------------------------------------------------
const drawn = await until(() => canvas.evaluate(() => {
	// The drawing is the engine's tiles, on its canvas over the boards.
	const engine = globalThis.__decksEngine?.stats?.();
	if (engine && engine.tiles > 0 && engine.drawn[1] > 0) return true;
	// In the canvas frame `__decksEngine` can be an engine made before the one on screen: the sheet's own count says a frame was drawn.
	if ((globalThis.__decksSheet?.shown ?? 0) > 0 && globalThis.__decksRust?.placed?.has("e2e-note")) return true;
	// The stage's one sheet, painted in a worker: shown, and sized from the frame it was handed.
	const canvas = document.querySelector(".stage-sheet");
	return !!canvas && !canvas.hidden && parseFloat(canvas.style.width) > 1;
}), 15000);
say("the drawing layer is on screen", !!drawn, JSON.stringify(await canvas.evaluate(() => globalThis.__decksEngine?.stats?.())));

// --- a picture of the stage, taken by the server's own Chromium --------------------------------------
const shotAt = Date.now();
const shot = await fetch(`${API}/api/stage-shot?agent=${agentId}&of=e2e-note&format=png`, { headers: await asPerson() });
const png = Buffer.from(await shot.arrayBuffer());
const pngSize = png.length > 24 && png.readUInt32BE(0) === 0x89504e47 ? { w: png.readUInt32BE(16), h: png.readUInt32BE(20) } : undefined;
say("the server takes a PNG of an item on the stage", shot.status === 200 && !!pngSize, `${shot.status} ${JSON.stringify(pngSize)} in ${Date.now() - shotAt} ms`);
// The note is 240 wide and framed with 24 on each side, at scale 2.
say("…framed on the item with a margin, at twice the pixels", pngSize?.w === (240 + 48) * 2, JSON.stringify(pngSize));
const whole = await fetch(`${API}/api/stage-shot?agent=${agentId}&format=pdf`, { headers: await asPerson() });
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
const screen = await canvas.evaluate(({ x, y }) => {
	const m = new DOMMatrix(globalThis.__decksCameraTransform());
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
// On bare canvas right of every board, at 100%, where the camera is moved (`view.move`).
{
	const person = await asPerson();
	const right = await canvas.evaluate(() => Math.max(0, ...globalThis.__decksRust.boards.map((b) => b.x + b.w)));
	for (let i = 0; i < 4; i++) {
		await fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args: [{ x: right + 3000, y: 0, zoom: 1 }] }) });
		if (await until(() => canvas.evaluate((x) => Math.abs(globalThis.__decksRust.camera.x - x) < 50 && Math.abs(globalThis.__decksRust.camera.zoom - 1) < 0.01, right + 3000), 4000)) break;
	}
	await rest(page);
}
const spots = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	// A board out of live zoom is a picture on the stage's canvas, not an element: ask the stage where they are.
	const boards = (window.__decksBoards?.() ?? []).map((b) => b.rect);
	const empty = (x, y) => document.elementFromPoint(x, y) === stage && boards.every((r) => x < r.left - 8 || x > r.right + 8 || y < r.top - 8 || y > r.bottom + 8);
	// Room for the rectangle (120 by 80 from the spot) and the card clicked in below it (from 10, 150), left of
	// where the properties panel opens on the right once something is selected,
	// with nothing of the chrome anywhere in it: the tool rail floats over the stage's left side, and
	// four corners alone let a spot straddle it.
	const clear = (x, y) => {
		for (let dy = 0; dy <= 260; dy += 20) for (let dx = 0; dx <= 260; dx += 20) if (!empty(x + dx, y + dy)) return false;
		return true;
	};
	const out = [];
	for (let y = 200; y < 820; y += 30) {
		for (let x = 340; x < 1000; x += 30) {
			if (clear(x, y)) out.push({ x, y });
		}
	}
	return out;
});
// …and with nothing of the page's own chrome over it either.
let spot;
for (const at of spots) if (!spot && (await pageClear({ x: at.x, y: at.y, w: 260, h: 260 }))) spot = at;
say("the canvas has room to draw in", !!spot);
let drawnId;
let cardId;
if (spot) {
	await page.mouse.click(spot.x + 150, spot.y + 100);
	await page.keyboard.press("r");
	const armed = await canvas.evaluate(() => document.querySelector(".stage").dataset.penTool);
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
	const handles = await until(() => canvas.evaluate(() => document.querySelectorAll('.pen-handle:not([data-handle="radius"])').length === 8));
	say("…and it is selected, with eight handles", !!handles);
	await canvas.locator('.props-panel [aria-label="Fill #fde68a"]').click();
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
	const card = await until(() => onDisk().children.find((n) => !before.has(n.id) && n.type === "frame"));
	cardId = card?.id;
	// A card is a column frame whose blocks are markdown texts (`pen/card-frame.ts`).
	say("C then a click makes a card: a column frame holding a markdown block", card?.metadata?.type === "decks.markdown-card" && card?.layout === "vertical" && card?.children?.[0]?.metadata?.type === "decks.markdown", JSON.stringify(card));
	const typing = await until(() => canvas.evaluate(() => !!document.activeElement?.closest(".pen-text")));
	say("…and it opens for typing", !!typing);
	await page.keyboard.type("## Plan\n\n- **one**\n- two");
	await page.keyboard.press("Control+Enter");
	const blocks = () => (onDisk().children.find((n) => n.id === cardId)?.children ?? []).map((n) => n.content);
	const titled = await until(() => JSON.stringify(blocks()) === JSON.stringify(["## Plan", "- **one**\n- two"]));
	say("…and what is typed is its markdown in the file, one block per item, as typed", !!titled, JSON.stringify(blocks()));
	// --- the corner radius, and a card sized by its width alone ------------------------------------
	// The rectangle again: it has corners to round, where a card has none.
	await page.keyboard.press("Escape");
	const rectBox = () => canvas.evaluate((id) => globalThis.__decksPenBox?.(id), drawnId);
	const onRect = await rectBox();
	await page.mouse.click(onRect.x + onRect.width / 2, onRect.y + onRect.height / 2);
	await until(() => canvas.evaluate(() => document.querySelectorAll('.pen-handle[data-handle="radius"]').length === 1));
	const extras = await canvas.evaluate(() => ({ radius: document.querySelectorAll('.pen-handle[data-handle="radius"]').length }));
	say("a selected rectangle has one radius handle", extras.radius === 1, JSON.stringify(extras));

	/*
	 * Move it first, then round it: a rounding used to be taken for a move by the sheet, which slid
	 * a picture of the item by however far the *last* drag went, so the item jumped away the moment
	 * the radius handle was pressed and jumped back when it was let go.
	 */
	const moveFrom = await rectBox();
	const wasAt = onDisk().children.find((n) => n.id === drawnId)?.x ?? 0;
	await page.mouse.move(moveFrom.x + moveFrom.width / 2, moveFrom.y + moveFrom.height / 2);
	await page.mouse.down();
	await page.mouse.move(moveFrom.x + moveFrom.width / 2 + 90, moveFrom.y + moveFrom.height / 2 + 60, { steps: 8 });
	await page.mouse.up();
	await until(() => {
		const now = onDisk().children.find((n) => n.id === drawnId);
		return now && Math.abs(now.x - wasAt) > 40 ? now : undefined;
	});
	await settle(page, 400);
	/** Where the rectangle's own fill is drawn on screen, found in a screenshot of the window around it. */
	const paintedAt = async (area) => {
		const shot = (await page.screenshot({ type: "png" })).toString("base64");
		return canvas.evaluate(async ([data, win, hex]) => {
			const img = new Image();
			img.src = "data:image/png;base64," + data;
			await img.decode();
			const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
			const ctx = c.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(img, 0, 0);
			const { data: px, width } = ctx.getImageData(0, 0, img.width, img.height);
			const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
			let x1 = 1e9, y1 = 1e9, n = 0;
			for (let y = Math.max(0, win.y); y < Math.min(img.height, win.y + win.h); y++)
				for (let x = Math.max(0, win.x); x < Math.min(width, win.x + win.w); x++) {
					const i = (y * width + x) * 4;
					if (px[i] !== want[0] || px[i + 1] !== want[1] || px[i + 2] !== want[2]) continue;
					n++;
					if (x < x1) x1 = x;
					if (y < y1) y1 = y;
				}
			return n ? { x: x1, y: y1, n } : null;
		}, [shot, area, hex]);
	};
	const hex = String(onDisk().children.find((n) => n.id === drawnId)?.fill ?? "#dbe4f0");
	const home = await rectBox();
	// Wide enough to catch the item drawn where the move left off, which is where it used to jump to.
	const area = { x: Math.round(home.x - 140), y: Math.round(home.y - 140), w: Math.round(home.width + 280), h: Math.round(home.height + 280) };
	// The selection's action pill and its shadow are not the item: kept out of the pixels that place it.
	const quiet = await canvas.addStyleTag({ content: ".stage-fixed > .board-callout { display: none !important }" });
	const parked = await paintedAt(area);

	// Dragging the radius handle along the diagonal rounds every corner, in the file.
	const radiusAt = () => canvas.evaluate(() => {
		const h = document.querySelector('.pen-handle[data-handle="radius"]').getBoundingClientRect();
		return { x: h.left + h.width / 2, y: h.top + h.height / 2 };
	});
	const grabRadius = await radiusAt();
	await page.mouse.move(grabRadius.x, grabRadius.y);
	await page.mouse.down();
	await page.mouse.move(grabRadius.x + 12, grabRadius.y + 12, { steps: 4 });
	await page.mouse.move(grabRadius.x + 24, grabRadius.y + 24, { steps: 4 });
	await settle(page, 500);
	const rounding = await paintedAt(area);
	say(
		"a rounding leaves the item where it is, after a move",
		!!parked && !!rounding && Math.abs(rounding.x - parked.x) <= 2 && Math.abs(rounding.y - parked.y) <= 2,
		`${JSON.stringify(parked)} -> ${JSON.stringify(rounding)}`,
	);
	await page.mouse.up();
	await quiet.evaluate((tag) => tag.remove());
	const round = await until(() => {
		const r = onDisk().children.find((n) => n.id === drawnId)?.cornerRadius;
		return typeof r === "number" && r > 8 ? r : undefined;
	});
	say("dragging the radius handle rounds the corners in the file", !!round, `cornerRadius ${round}`);

	/*
	 * A card is as tall as its words until its own top or bottom handle says otherwise: it has all
	 * eight, its sides set its width and leave the height to the words, and the bottom pins one.
	 */
	await page.keyboard.press("Escape");
	await settle(page, 200);
	const cardBox = await canvas.evaluate((id) => globalThis.__decksPenBox?.(id), cardId);
	await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + 8);
	const eight = await until(() => canvas.evaluate(() => {
		const all = [...document.querySelectorAll('.pen-handle:not([data-handle="radius"])')].map((h) => h.dataset.handle).sort();
		return all.length === 8 ? all : undefined;
	}));
	say("a card has all eight handles, so its height can be set by hand", !!eight, JSON.stringify(eight));
	const wasCard = onDisk().children.find((n) => n.id === cardId);
	const east = await canvas.evaluate(() => {
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
	// Its words decide its height: no number in the file, only the floor it was made with (`fit_content(48)`).
	say("dragging its side sets its width, and leaves its height to its words", !!widened && (widened.height === undefined || /^fit_content(\(\d+(\.\d+)?\))?$/.test(String(widened.height))), JSON.stringify({ width: widened?.width, height: widened?.height }));
	// The bottom handle: now it is a height the person chose, and the words no longer decide it.
	const tall = await canvas.evaluate((id) => globalThis.__decksPenBox?.(id), cardId);
	const south = await canvas.evaluate(() => {
		const h = document.querySelector('.pen-handle[data-handle="s"]')?.getBoundingClientRect();
		return h ? { x: h.left + h.width / 2, y: h.top + h.height / 2 } : undefined;
	});
	say("its bottom handle is there to drag", !!south, JSON.stringify(south));
	if (south && tall) {
		await page.mouse.move(south.x, south.y);
		await page.mouse.down();
		await page.mouse.move(south.x, south.y + 60, { steps: 4 });
		await page.mouse.move(south.x, south.y + 120, { steps: 4 });
		await page.mouse.up();
		const pinned = await until(() => {
			const card = onDisk().children.find((n) => n.id === cardId);
			return typeof card?.height === "number" ? card : undefined;
		});
		say("dragging its bottom pins a height on it, in pixels", !!pinned && pinned.height > tall.height, JSON.stringify({ height: pinned?.height, was: Math.round(tall.height) }));
		// And the panel gives the words their say back, with the same two words the frame's height uses.
		const back = await until(() => canvas.evaluate(() => {
			const group = document.querySelector('[data-section="place"] [aria-label="height"]');
			return group ? [...group.querySelectorAll("button")].map((b) => b.textContent?.trim()) : undefined;
		}));
		say("a card's own height control is in the panel", JSON.stringify(back) === JSON.stringify(["fit-content", "px"]), JSON.stringify(back));
		await canvas.evaluate(() => {
			const group = document.querySelector('[data-section="place"] [aria-label="height"]');
			[...group.querySelectorAll("button")].find((b) => b.textContent?.trim() === "fit-content")?.click();
		});
		const hugging = await until(() => (onDisk().children.find((n) => n.id === cardId)?.height === undefined ? true : undefined));
		say("…and pressing fit-content takes the pinned height off again", !!hugging, JSON.stringify(onDisk().children.find((n) => n.id === cardId)?.height));
	}
}
// --- boards at the back: a drawing over a board catches its own clicks; the selected board rises ---
const boardItem = onDisk().children.find((n) => n.metadata?.path === inFolder(firstBoard));
if (boardItem) {
	const w = Math.round((boardItem.width ?? 400) * 0.4);
	const h = Math.round((boardItem.height ?? 300) * 0.3);
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "e2e-over", fill: "#bfdbfe" }, box: { x1: boardItem.x + 20, y1: boardItem.y + 20, x2: boardItem.x + 20 + w, y2: boardItem.y + 20 + h } }] });
	await until(() => onDisk().children.some((n) => n.id === "e2e-over"));
	await focusCanvas(page);
	await page.keyboard.press("Escape");
	// Framed on the board, close enough to press the drawing over it.
	await selectBoard(page, firstBoard);
	await page.keyboard.press("1");
	await settle(page, 1200);
	await page.keyboard.press("Escape");
	await settle(page, 200);
	const at = await canvas.evaluate(({ x, y }) => {
		const m = new DOMMatrix(globalThis.__decksCameraTransform());
		return { x: m.e + x * m.a, y: m.f + y * m.a };
	}, { x: boardItem.x + 20 + w / 2, y: boardItem.y + 20 + h / 2 });
	const under = () => canvas.evaluate(({ x, y }) => {
		const e = document.elementFromPoint(x, y);
		return e?.closest(".board-node") ? "board" : e?.classList.contains("pen-hit") ? `drawing:${e.dataset.id}` : e?.className?.baseVal ?? e?.className ?? "nothing";
	}, at);
	const shown = await until(() => under().then((u) => u.startsWith("drawing") && u));
	say("a drawing over a board is on top of it and catches the click there", shown === "drawing:e2e-over", await under());
	// A board is only its picture now (no page of its own to press through to): the selected board stays under the drawing.
	await selectBoard(page, firstBoard);
	say("…and the drawing stays on top of the selected board", (await under()) === "drawing:e2e-over", await under());
}
await editMode(page, false);

// Leave the fixture's stage as it was, minus the check's own drawing.
link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.id.startsWith("e2e-") || n.id === drawnId || n.id === cardId).map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 300);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
