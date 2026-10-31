/**
 * Board geometry, from the gesture that changes it: the resize handle — and the double-click on
 * empty canvas, which makes a note and never a board.
 *
 * A resize is written twice: to this stage's file, where the board is drawn at what the drag let go
 * at, and to the board's own file, the size another stage takes it at next, as an agent's fit
 * writes it. A double-click on empty canvas is the Note tool's click: a note there, open for typing.
 *
 * A board is only its picture on the canvas now (no page of its own in it), so what this asked of a
 * board's page (kept through a resize, its content a floor for its height) is gone with it.
 */
import { boardPath, canvasFrame, flyToBoard, onCanvasAt, open, read, resetStage, say, selectBoard, settle, socket, stagePath, write } from "../harness.mjs";


const { browser, page, errors } = await open({ width: 1500, height: 1000, edit: true });
await resetStage(page);
await settle(page, 900);
/** The canvas frame: the stage, the boards' nodes and their handles are there. */
const canvas = await canvasFrame(page);

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
	 * Flown to, not found by its title bar — which is the trap this check fell into
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
	const others = (await canvas.evaluate(() => [...document.querySelectorAll(".card-node")].map((node) => node.dataset.path))).filter((other) => other !== path);
	const link = await socket();
	for (const other of others) link.send({ type: "card.hide", path: other });
	// Brought back if an earlier select hid it, as its row in the panel used to (`App.tsx`, `playAndFrame`).
	link.send({ type: "card.play", path });
	await new Promise((resolve) => setTimeout(resolve, 500));
	link.close();
	await settle(page, 500);
	// The panel has no row per board file any more (its Canvas tab lists items by their names), so it is
	// picked on the canvas and flown to with its Fit, which finds it wherever the camera is (`flyToBoard`).
	await flyToBoard(page, path);
	await settle(page, 300);
	for (let i = 0; i < 8; i++) {
		const level = await canvas.evaluate(() =>
			Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
		);
		if (level >= 70 && level <= 200) break;
		await page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
		await settle(page, 250);
	}
	await selectBoard(page, path);
	await settle(page, 600);
	await cornerOnScreen(path);
};

/**
 * Zoom out until the board's bottom corner is on the screen, where the handle this check drags is. A
 * board that reads top to bottom is drawn as tall as its content (`App.tsx`, `stageBoards`), which at
 * the zoom `select` picks runs past the bottom of the window.
 */
const cornerOnScreen = async (path) => {
	for (let i = 0; i < 6; i++) {
		const below = await canvas.evaluate((wanted) => {
			const corner = document.querySelector(`.pen-handle[data-page="${wanted}"][data-handle="se"]`)?.getBoundingClientRect();
			return !!corner && corner.bottom > window.innerHeight - 140;
		}, path);
		if (!below) break;
		await page.keyboard.press("Control+Minus");
		await settle(page, 300);
	}
};

/** Drag the handle by screen pixels, and report what the node was drawn at half way through. */
const dragHandle = async (path, dx, dy) => {
	const handle = canvas.locator(`.pen-handle[data-page="${path}"][data-handle="se"]`);
	await handle.waitFor({ state: "visible", timeout: 6000 });
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
	await settle(page, 200);
	const during = await canvas.evaluate((wanted) => {
		const node = document.querySelector(`.card-node[data-path="${wanted}"]`);
		return { w: Math.round(Number.parseFloat(node.style.width)), h: Math.round(Number.parseFloat(node.style.height)) };
	}, path);
	await page.mouse.up();
	await settle(page, 400);
	return during;
};

// --- a component board: both numbers are in the file ---------------------------------

// The board's own file is the canvas's copy, and the stage shows it under that path; both read before
// the first `select` hides the other boards.
const component = await boardPath("risks.html");
const componentPath = await stagePath(page, "boards/risks.html");
const flow = await boardPath("notes.html");
const flowPath = await stagePath(page, "boards/notes.html");
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
	canvas.evaluate((path) => {
		const node = document.querySelector(`.card-node[data-path="${path}"]`);
		const sizer = document.querySelector(`.pen-handle[data-page="${path}"][data-handle="se"]`);
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

/*
 * And no board's node draws text of its own that came from the source.
 *
 * This is the one place a mistake of this kind can be caught, and it took a person looking at the canvas
 * to find it: a `/* … *\/` written in the **children** position of JSX is not a comment, it is text — and
 * it is *valid* JSX, so `tsc` is happy and esbuild strips it. This app compiles JSX with Solid's preset,
 * which does not, so ninety words of a source file rendered as a text node inside every `.card-node` and
 * sat under eight boards. Nothing in the toolchain objects. The DOM does.
 */
const stray = await canvas.evaluate(() => {
	const found = [];
	for (const el of document.querySelectorAll("*")) {
		if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
		for (const child of el.childNodes) {
			if (child.nodeType === 3 && (child.textContent ?? "").includes("/*")) {
				found.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}: ${(child.textContent ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
			}
		}
	}
	return found;
});
say("no comment from a source file is drawn on the canvas", stray.length === 0, stray.slice(0, 2).join(" | "));

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

await page.waitForTimeout(1500);
const nowComponent = read(component);
const drawnAt = (wanted) =>
	canvas.evaluate((wanted) => {
		const node = document.querySelector(`.card-node[data-path="${wanted}"]`);
		return { w: Math.round(Number.parseFloat(node.style.width)), h: Math.round(Number.parseFloat(node.style.height)) };
	}, wanted);
const drawn = await drawnAt(componentPath);
say(
	"letting go keeps the board at the size the drag let go at",
	Math.abs(drawn.w - dragged.w) <= 2 && Math.abs(drawn.h - dragged.h) <= 2,
	`drawn ${drawn.w}x${drawn.h}, dragged ${dragged.w}x${dragged.h}`,
);
const writtenMeta = metaOf(nowComponent);
say("…and writes that size to the board's own file", Math.abs(writtenMeta?.w - drawn.w) <= 1 && Math.abs(writtenMeta?.h - drawn.h) <= 1, JSON.stringify(writtenMeta));
// The person's own resize is theirs: the board's new file time must not read as an agent's change.
await page.waitForTimeout(600);
const glows = await canvas.evaluate((wanted) => {
	const node = document.querySelector(`.card-node[data-path="${wanted}"]`);
	return { glow: Boolean(node?.querySelector(".news-glow")) };
}, componentPath);
say("…and a board you resized does not glow as news", !glows.glow, JSON.stringify(glows));

// Made shorter again, it stays at the new height from the moment it is let go: every frame drawn
// after that is at most the height it was let go at. It used to come back at its old height for a
// moment, because the file's new revision reached the page before the canvas's new size.
await select(componentPath);
await settle(page, 400);
const before = await drawnAt(componentPath);
const handle = canvas.locator(`.pen-handle[data-page="${componentPath}"][data-handle="se"]`);
await handle.waitFor({ state: "visible", timeout: 6000 });
const grip = await handle.boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 60, { steps: 10 });
await settle(page, 200);
const letGo = await drawnAt(componentPath);
await canvas.evaluate((wanted) => {
	const seen = (window.__heights = []);
	const sample = () => {
		const node = document.querySelector(`.card-node[data-path="${wanted}"]`);
		seen.push(Math.round(Number.parseFloat(node.style.height)));
		if (seen.length < 120) requestAnimationFrame(sample);
	};
	requestAnimationFrame(sample);
}, componentPath);
await page.mouse.up();
await page.waitForTimeout(2200);
const heights = await canvas.evaluate(() => window.__heights);
say(
	"a board made shorter never draws taller than where it was let go",
	letGo.h < before.h - 40 && Math.max(...heights) <= letGo.h + 1 && Math.abs(heights.at(-1) - letGo.h) <= 1,
	`${before.h} → ${letGo.h}, frames after letting go reach ${Math.max(...heights)}, end at ${heights.at(-1)}; ${[...new Set(heights)].join(" ")}`,
);

// --- a board written as a document: both numbers are writable, and the height is a floor ---

const wasFlow = read(flow);
const flowMeta = metaOf(wasFlow);

await select(flowPath);
const flowHandle = await handleAt(flowPath);
say(
	"a board written as a document gets the same handle — one box, on the corner, not a bar of another shape",
	flowHandle !== null &&
		both !== null &&
		flowHandle.square &&
		flowHandle.w === both.w &&
		flowHandle.h === both.h &&
		flowHandle.cursor === both.cursor &&
		Math.abs(flowHandle.dx) <= 1 &&
		Math.abs(flowHandle.dy) <= 1,
	`${JSON.stringify(flowHandle)} vs the other board's ${JSON.stringify(both)}`,
);

const flowBefore = await drawnAt(flowPath);
await dragHandle(flowPath, 120, 60);
await page.waitForTimeout(1500);
const flowDrawn = await drawnAt(flowPath);
say(
	"…and it takes both numbers, in its file too",
	flowDrawn.w > flowBefore.w && flowDrawn.h > flowBefore.h && metaOf(read(flow))?.w === flowDrawn.w && metaOf(read(flow))?.h === flowDrawn.h,
	`${flowBefore.w}x${flowBefore.h} → ${flowDrawn.w}x${flowDrawn.h}, ${JSON.stringify(metaOf(read(flow)))}`,
);


// --- a double-click on a board's own bar is not a double-click on empty canvas ----------

/*
 * A title bar is in the app's own document, so a press on it reaches the stage's handler — and a
 * board made every time somebody double-clicked a bar to fly to it would leave a file behind for a
 * gesture that already meant "go to this board". Done here, before the canvas is emptied, because
 * it needs a board to click.
 */
const countNow = await canvas.evaluate(() => document.querySelectorAll(".card-node").length);
await flyToBoard(page, flowPath);
await settle(page, 900);
const countAfterBar = await canvas.evaluate(() => document.querySelectorAll(".card-node").length);
/*
 * The claim is that the count did **not** grow, not that it is one: the hides above are best-effort (they
 * go out on a socket and this block does not read the canvas back), and requiring `countNow === 1` made this
 * assertion fail with `7 → 7` — correctly no board, wrongly a red line.
 */
say("a double-click on a board's own bar makes nothing", countAfterBar === countNow && countNow >= 1, `${countNow} → ${countAfterBar}`);

// --- empty canvas: a double-click makes a note, where you clicked ----------------------

/*
 * The canvas is emptied first, and that is the fix for how this step first failed.
 *
 * It scanned for a point that was not over a board — the right way to find empty canvas without
 * knowing the fixture's layout — and found none at all, because one board was still in play and
 * the dock, the palette and that board covered every point the scan looked at. Every board off the
 * canvas is both simpler and closer to what the gesture is for: a double-click on empty canvas.
 */
const link = await socket();
for (const path of await canvas.evaluate(() => [...document.querySelectorAll(".card-node")].map((node) => node.dataset.path))) {
	link.send({ type: "card.hide", path });
}
await new Promise((resolve) => setTimeout(resolve, 800));
link.close();
await settle(page, 800);

const empty = await canvas.evaluate(() => document.querySelectorAll(".card-node").length);
say("the canvas can be emptied for the press", empty === 0, `${empty} board(s) left`);

const spots = await canvas.evaluate(() => {
	const out = [];
	for (let y = 160; y < window.innerHeight - 220; y += 40)
		for (let x = 320; x < window.innerWidth - 200; x += 40) {
			const el = document.elementFromPoint(x, y);
			if (el && !el.closest(".card-node") && !el.closest(".float") && !el.closest("aside") && !el.closest(".notice") && !el.closest(".inspector")) out.push({ x, y });
		}
	return out;
});
// …and not under the page's own chrome drawn over the canvas (the side panel, the bars, the composer).
let spot = null;
for (const at of spots) if (!spot && (await onCanvasAt(page, at.x, at.y)) && (await onCanvasAt(page, at.x + 300, at.y + 120))) spot = at;
say("there is empty canvas to double-click on", spot !== null, JSON.stringify(spot));

const pens = await socket();
await page.mouse.dblclick(spot.x, spot.y);
// The same note the Note tool makes with a click there: its corner at the point, open for typing.
const typing = await canvas.waitForSelector(".pen-text", { timeout: 3000 }).catch(() => null);
const focused = await canvas.evaluate(() => !!document.activeElement?.classList.contains("pen-text"));
say("a double-click on empty canvas starts a note, open for typing", !!typing && focused, `editor ${!!typing}, focused ${focused}`);
const box = await canvas.evaluate(() => {
	const r = document.querySelector(".pen-text")?.getBoundingClientRect();
	return r ? { x: Math.round(r.x), y: Math.round(r.y) } : null;
});
say("…at the point that was pressed", box !== null && Math.abs(box.x - spot.x) <= 30 && Math.abs(box.y - spot.y) <= 30, `${JSON.stringify(box)} vs the press ${JSON.stringify(spot)}`);
await page.keyboard.type("hello");
await page.mouse.click(spot.x + 300, spot.y + 120);
await settle(page, 1500);
const notes = (pens.last("stage.pen")?.doc?.children ?? []).filter((node) => node.type === "note");
say("…and the note is saved with what was typed", JSON.stringify(notes).includes("hello"), `${notes.length} note(s)`);
const boardsAfter = await canvas.evaluate(() => document.querySelectorAll(".card-node").length);
say("…and no board was made", boardsAfter === 0, `${boardsAfter} board(s)`);
pens.close();

// --- the fixture is put back, so the checks after this one see the deck they expect -----

write(component, wasComponent);
write(flow, wasFlow);
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
