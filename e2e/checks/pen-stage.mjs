/**
 * The stage as a pen.dev file: boards as `browser` items, a drawing under them, edits from the
 * wire, from the file and by hand, all ending in the same `stages/<name>/stage.pen`.
 *
 * Needs no model: the edits an agent would make with `stage.pen.edit` go over the wire as
 * `stage.pen.edit`, which is the same operation through the same server path.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
	const canvas = document.querySelector(".pen-layer");
	return !!canvas && !canvas.hidden && canvas.width > 1;
}), 15000);
say("the drawing layer is on screen", !!drawn);

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
	const handles = await until(() => page.evaluate(() => document.querySelectorAll(".pen-handle").length === 8));
	say("…and it is selected, with eight handles", !!handles);
	await page.locator('.pen-bar [aria-label="Fill #fde68a"]').click();
	const filled = await until(() => onDisk().children.find((n) => n.id === drawnId)?.fill === "#fde68a");
	say("the bar's fill colours the selected item in the file", !!filled);
	await page.keyboard.press("Control+z");
	const undone = await until(() => onDisk().children.find((n) => n.id === drawnId)?.fill === "#dbe4f0");
	say("⌘Z takes back the person's own last edit", !!undone, JSON.stringify(onDisk().children.find((n) => n.id === drawnId)?.fill));
}
// --- boards at the back: a drawing over a board catches its own clicks; the selected board rises ---
const boardItem = onDisk().children.find((n) => n.metadata?.path === firstBoard);
if (boardItem) {
	const w = Math.round((boardItem.width ?? 400) * 0.4);
	const h = Math.round((boardItem.height ?? 300) * 0.3);
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "e2e-over", fill: "#bfdbfe" }, box: { x1: boardItem.x + 20, y1: boardItem.y + 20, x2: boardItem.x + 20 + w, y2: boardItem.y + 20 + h } }] });
	await until(() => onDisk().children.some((n) => n.id === "e2e-over"));
	await page.keyboard.press("Escape");
	await page.keyboard.press("0");
	await settle(page, 900);
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
	if (free) await page.mouse.click(free.x, free.y);
	const raised = await until(() => node.evaluate((n) => n.dataset.selected === "true" && getComputedStyle(n).zIndex === "2"));
	say("a click on the board's uncovered part selects it and lifts it over the drawing", !!raised && (await under()) === "board", await under());
	// The rectangle is under the raised board now; a press beside the board, on bare canvas, lets it go.
	const bare = await page.evaluate(() => {
		const stage = document.querySelector(".stage");
		for (let y = 120; y < innerHeight - 120; y += 15) for (let x = 320; x < innerWidth - 20; x += 15) if (document.elementFromPoint(x, y) === stage) return { x, y };
	});
	if (bare) await page.mouse.click(bare.x, bare.y);
	await until(() => node.evaluate((n) => n.dataset.selected !== "true"));
	say("a press on bare canvas lets the board go, back under the drawing", (await under()) === "drawing:e2e-over", await under());
}
await editMode(page, false);

// Leave the fixture's stage as it was, minus the check's own drawing.
link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.id.startsWith("e2e-") || n.id === drawnId).map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 300);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
