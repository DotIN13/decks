/**
 * Board geometry, from the two gestures that change it: the resize handle, and the double-click
 * that makes a board.
 *
 * Both are the same subject — where a board's *size* comes from — and they answer it in opposite
 * directions. A resize is a write: the number lives in the board's own file, so the drag previews
 * the box it is asking for and the file decides what turns out to be true. A double-click is a
 * creation: a name the server mints, a place the browser picked, and a board whose centre ends up
 * where the pointer was.
 *
 * The size is checked **in the file** rather than on screen. The board's draggable box is drawn
 * from the board record, so asserting it would pass even if nothing had been written — and the
 * write is the whole feature. The record and the file are then compared to each other, which is
 * the one thing that could disagree without either looking wrong on its own.
 */
import { boardPath, changed, open, read, resetStage, say, settle, socket, write } from "../harness.mjs";


const { browser, page, errors } = await open({ width: 1500, height: 1000, edit: true });
await resetStage(page);
await settle(page, 900);

/** The `{"w":…,"h":…}` the board file declares, which is the number the drag has to move. */
const metaOf = (text) => {
	const found = text.match(/name="board"\s+content='([^']*)'/) ?? text.match(/name="board"\s+content="([^"]*)"/);
	if (!found) return null;
	try {
		return JSON.parse(found[1]);
	} catch {
		return null;
	}
};

/**
 * Select a board the way a person does: fly to it, zoom in past the interaction threshold, then
 * click what is on it.
 *
 * The zoom is not politeness. Below half zoom a board takes no pointer events at all — the frame
 * is inert so a pan across it is a pan — so a click "inside" it lands on the canvas underneath,
 * nothing is selected, and every assertion after this point would be about a handle that was
 * never going to appear.
 */
const select = async (path) => {
	/*
	 * Flown by its row in the panel, not by its title bar — which is the trap this check fell into
	 * first: the bar is only rendered for a board that is on screen (`visible`), so a board the
	 * camera has left has no bar to double-click, and the press that was supposed to bring it into
	 * view waited thirty seconds for a button that appears only once it is in view. The row is
	 * always there.
	 */
	/*
	 * And alone on the canvas, which is the other half of the same lesson: the fixture's boards
	 * overlap, so a click at the middle of the right board landed on whichever board was painted
	 * over it — the check then measured a *different* board's handle and reported `null` for this
	 * one's. Hiding the rest is what a person does with the ×, and it makes the click mean what it
	 * says.
	 */
	const others = (await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path))).filter((other) => other !== path);
	const link = await socket();
	for (const other of others) link.send({ type: "board.hide", path: other });
	await new Promise((resolve) => setTimeout(resolve, 500));
	link.close();
	await settle(page, 500);
	await page.evaluate((wanted) => {
		const name = wanted.replace("boards/", "");
		[...document.querySelectorAll(".board-row")].find((item) => item.textContent?.includes(name))?.click();
	}, path);
	await settle(page, 900);
	for (let i = 0; i < 8; i++) {
		const level = await page.evaluate(() =>
			Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
		);
		if (level >= 70 && level <= 200) break;
		await page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
		await settle(page, 250);
	}
	await page.frameLocator(`.board-node[data-path="${path}"] iframe`).locator("h1, h3, body").first().click();
	await settle(page, 600);
};

/** Drag the handle by screen pixels, and report what the node was drawn at half way through. */
const dragHandle = async (path, dx, dy) => {
	const handle = page.locator(`.board-node[data-path="${path}"] .sizer`);
	await handle.waitFor({ state: "visible", timeout: 6000 });
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
	await settle(page, 200);
	const during = await page.evaluate((wanted) => {
		const node = document.querySelector(`.board-node[data-path="${wanted}"]`);
		return { w: Math.round(Number.parseFloat(node.style.width)), h: Math.round(Number.parseFloat(node.style.height)) };
	}, path);
	await page.mouse.up();
	await settle(page, 400);
	return during;
};

// --- a component board: both numbers are in the file ---------------------------------

const component = await boardPath("risks.html");
const componentPath = "boards/risks.html";
const wasComponent = read(component);
const componentMeta = metaOf(wasComponent);
say("the component board declares its own size", componentMeta !== null && componentMeta.w > 0, JSON.stringify(componentMeta));

await select(componentPath);
/**
 * The handle, as a box: how it is drawn and **where** it is.
 *
 * `dx`/`dy` are how far the handle's centre sits from the board's own bottom-right corner, in screen
 * pixels — zero when the handle is on the corner, whatever the zoom, because the node's box and the
 * handle's are both measured on screen. That is the claim the shape was standing in for: the corner is
 * where the resize is, and it is the same corner on every kind of document.
 */
const handleAt = (wanted) =>
	page.evaluate((path) => {
		const node = document.querySelector(`.board-node[data-path="${path}"]`);
		const sizer = node?.querySelector(".sizer");
		if (!node || !sizer) return null;
		const n = node.getBoundingClientRect();
		const s = sizer.getBoundingClientRect();
		return {
			w: Math.round(s.width),
			h: Math.round(s.height),
			dx: Math.round(s.left + s.width / 2 - n.right),
			dy: Math.round(s.top + s.height / 2 - n.bottom),
			cursor: getComputedStyle(sizer).cursor,
			square: Math.abs(s.width - s.height) <= 1,
		};
	}, wanted);

const both = await handleAt(componentPath);
say(
	"selecting a board puts a square handle on its bottom-right corner",
	both !== null && both.square && Math.abs(both.dx) <= 1 && Math.abs(both.dy) <= 1,
	JSON.stringify(both),
);
say("…a real target, drawn in screen pixels", both !== null && both.w >= 8 && both.cursor === "nwse-resize", JSON.stringify(both));

const dragged = await dragHandle(componentPath, 140, 90);
say(
	"the box follows the drag, before anything is written",
	dragged.w > componentMeta.w + 40 && dragged.h > componentMeta.h + 20,
	`${componentMeta.w}x${componentMeta.h} → ${dragged.w}x${dragged.h}`,
);

await changed(component, wasComponent, { timeout: 8000 }).catch(() => {});
const nowComponent = read(component);
const afterMeta = metaOf(nowComponent);
say(
	"and letting go writes the size to the board's own file",
	afterMeta !== null && afterMeta.w > componentMeta.w && afterMeta.h > componentMeta.h,
	`${JSON.stringify(componentMeta)} → ${JSON.stringify(afterMeta)}`,
);
const drawn = await page.evaluate((wanted) => {
	const node = document.querySelector(`.board-node[data-path="${wanted}"]`);
	return { w: Math.round(Number.parseFloat(node.style.width)), h: Math.round(Number.parseFloat(node.style.height)) };
}, componentPath);
say(
	"…and the board on screen is that size, not the drag's",
	drawn.w === afterMeta.w && drawn.h === afterMeta.h,
	`drawn ${drawn.w}x${drawn.h}, file ${afterMeta.w}x${afterMeta.h}`,
);
say("nothing else in the file moved", nowComponent.replace(/"w":\d+,"h":\d+/, '"w":0,"h":0') === wasComponent.replace(/"w":\d+,"h":\d+/, '"w":0,"h":0'), "the rest of the bytes are identical");

// --- a flow document: the width is storable, the height is its content ----------------

const flow = await boardPath("notes.html");
const flowPath = "boards/notes.html";
const wasFlow = read(flow);
const flowMeta = metaOf(wasFlow);

await select(flowPath);
const flowHandle = await handleAt(flowPath);
say(
	"a flow document gets the same handle — one box, on the corner, not a bar of another shape",
	flowHandle !== null &&
		both !== null &&
		flowHandle.square &&
		flowHandle.w === both.w &&
		flowHandle.h === both.h &&
		flowHandle.cursor === both.cursor &&
		Math.abs(flowHandle.dx) <= 1 &&
		Math.abs(flowHandle.dy) <= 1,
	`${JSON.stringify(flowHandle)} vs the component board's ${JSON.stringify(both)}`,
);

await dragHandle(flowPath, 120, 60);
await changed(flow, wasFlow, { timeout: 8000 }).catch(() => {});
const nowFlow = read(flow);
const flowAfter = metaOf(nowFlow);
say(
	"…so its width is written and its height is left alone",
	flowAfter !== null && flowAfter.w > flowMeta.w && flowAfter.h === flowMeta.h,
	`${JSON.stringify(flowMeta)} → ${JSON.stringify(flowAfter)}`,
);

// --- a double-click on a board's own bar is not a double-click on empty canvas ----------

/*
 * A title bar is in the app's own document, so a press on it reaches the stage's handler — and a
 * board made every time somebody double-clicked a bar to fly to it would leave a file behind for a
 * gesture that already meant "go to this board". Done here, before the canvas is emptied, because
 * it needs a board to click.
 */
const countNow = await page.evaluate(() => document.querySelectorAll(".board-node").length);
await page.locator(`.board-node[data-path="${flowPath}"] .chrome`).dblclick({ position: { x: 24, y: 12 } });
await settle(page, 900);
const countAfterBar = await page.evaluate(() => document.querySelectorAll(".board-node").length);
/*
 * The claim is that the count did **not** grow, not that it is one: the hides above are best-effort (they
 * go out on a socket and this block does not read the canvas back), and requiring `countNow === 1` made this
 * assertion fail with `7 → 7` — correctly no board, wrongly a red line.
 */
say("a double-click on a board's own bar makes nothing", countAfterBar === countNow && countNow >= 1, `${countNow} → ${countAfterBar}`);

// --- empty canvas: a double-click makes a board, where you clicked ---------------------

/*
 * The canvas is emptied first, and that is the fix for how this step first failed.
 *
 * It scanned for a point that was not over a board — the right way to find empty canvas without
 * knowing the fixture's layout — and found none at all, because one board was still in play and
 * the dock, the palette and that board covered every point the scan looked at. Every board off the
 * canvas is both simpler and closer to what the gesture is for: a double-click on empty canvas.
 */
const link = await socket();
for (const path of await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path))) {
	link.send({ type: "board.hide", path });
}
await new Promise((resolve) => setTimeout(resolve, 800));
link.close();
await settle(page, 800);

const empty = await page.evaluate(() => document.querySelectorAll(".board-node").length);
say("the canvas can be emptied for the press", empty === 0, `${empty} board(s) left`);

const spot = await page.evaluate(() => {
	for (let y = 160; y < window.innerHeight - 220; y += 40)
		for (let x = 320; x < window.innerWidth - 200; x += 40) {
			const el = document.elementFromPoint(x, y);
			if (el && !el.closest(".board-node") && !el.closest(".float") && !el.closest("aside") && !el.closest(".notice") && !el.closest(".inspector")) return { x, y };
		}
	return null;
});
say("there is empty canvas to double-click on", spot !== null, JSON.stringify(spot));

await page.mouse.dblclick(spot.x, spot.y);
await settle(page, 1800);
const created = await page.evaluate(([at]) => {
	const nodes = [...document.querySelectorAll(".board-node")];
	const fresh = nodes[0];
	if (!fresh) return null;
	const box = fresh.getBoundingClientRect();
	return {
		count: nodes.length,
		path: fresh.dataset.path,
		selected: fresh.dataset.selected,
		centre: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
		size: { w: Math.round(Number.parseFloat(fresh.style.width)), h: Math.round(Number.parseFloat(fresh.style.height)) },
		at,
	};
}, [spot]);
say("a double-click on empty canvas makes a board", created !== null && created.count === 1, JSON.stringify(created));
say(
	"…centred on the point that was pressed, not hung off its corner",
	created !== null && Math.abs(created.centre.x - created.at.x) <= 4 && Math.abs(created.centre.y - created.at.y) <= 4,
	`centre ${JSON.stringify(created?.centre)} vs the press ${JSON.stringify(created?.at)}`,
);
say("…selected, so it can be typed into or resized straight away", created?.selected === "true", String(created?.selected));
say("…the blank template's own size", created !== null && created.size.w === 880 && created.size.h === 400, JSON.stringify(created?.size));

const madeFile = created ? await boardPath(created.path.split("/").pop()) : undefined;
const made = madeFile ? read(madeFile) : "";
say(
	"…and a file on disk, with a heading and a board tag in it",
	/<title>Untitled<\/title>/.test(made) && /name="board"/.test(made) && /class="board"/.test(made),
	`${made.split("\n").length} lines written`,
);

// --- the fixture is put back, so the checks after this one see the deck they expect -----

write(component, wasComponent);
write(flow, wasFlow);
if (created) {
	const link = await socket();
	link.send({ type: "board.delete", path: created.path });
	await new Promise((resolve) => setTimeout(resolve, 600));
	link.close();
}
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
