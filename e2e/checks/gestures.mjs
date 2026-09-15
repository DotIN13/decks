/**
 * Phase 5: the gestures, one op each, driven by a real mouse and a real keyboard.
 *
 * What this check can assert and what it cannot is worth being exact about. The app is not wired to the
 * package yet — that is phase 6 — so there is no server on the other end of these ops and nothing here
 * reads a file. What it asserts is **the contract each gesture produces**: the op's kind, its address, and
 * the fact that it carries only what the gesture changed. The other half — that these ops write a file
 * correctly — is `apps/server/src/boards/editor-ops.test.ts`, where all eight run against real bytes.
 *
 * Together those two are "each gesture reaches the file". Neither is enough alone, and a check that
 * pretended otherwise would be the kind of green that costs an afternoon.
 *
 * The one thing asserted about the frame itself is the *preview*: a drag moves the element as it goes,
 * before any op is sent, which is what makes an edit feel like it happened rather than like it was
 * requested.
 */
import { chromium } from "playwright";
import { WEB, say } from "../harness.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(`${WEB}/editor.html?board=${encodeURIComponent("boards/plan.html")}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__editorDev?.loaded === true, null, { timeout: 20000 });
await page.locator("#mode").click(); // edit

const board = page.frameLocator(".board-frame");
const ops = () => page.evaluate(() => window.__editorDev?.ops ?? []);
const lastOp = async () => (await ops()).at(-1) ?? null;
const clearOps = () => page.evaluate(() => window.__editorDev && (window.__editorDev.ops.length = 0));

/**
 * A point inside an element of the frame, in page coordinates.
 *
 * **No frame offset, and that is the whole of the arithmetic.** Playwright's `boundingBox()` on a locator
 * *inside an iframe* already answers in page coordinates — adding the frame's own box to it puts the press
 * past the element. Measured the hard way: a card 380 pixels wide absorbed the extra twelve, so a drag
 * passed and a press two pixels inside its right edge landed ten pixels outside it, on the body, where
 * there is no handle and so no gesture. Two failures, one cause, and neither of them in the editor.
 */
async function pointIn(selector, offset = { x: 4, y: 4 }) {
	const inner = await board.locator(selector).first().boundingBox();
	return { x: inner.x + offset.x, y: inner.y + offset.y, inner };
}

const card = '[data-id="goal"]';
const before = await board.locator(card).getAttribute("style");

// --- drag --------------------------------------------------------------------------------------
await clearOps();
const corner = await pointIn(card);
await page.mouse.click(corner.x, corner.y); // select it, on its own box rather than its words
const grab = await pointIn(card, { x: 4, y: 4 });
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.mouse.move(grab.x + 48, grab.y + 24, { steps: 8 });
const during = await board.locator(card).getAttribute("style");
await page.mouse.up();
const dragged = await lastOp();
say(
	"a drag moves the node on screen before anything is sent",
	during !== before && /left:/.test(during ?? ""),
	`${before} → ${during}`,
);
say(
	"…and emits one `set`: the path, and only the two declarations that moved",
	dragged?.op === "set" && Array.isArray(dragged?.path) && Object.keys(dragged?.style ?? {}).sort().join(",") === "left,top",
	JSON.stringify(dragged),
);
const onGrid = (value) => typeof value === "string" && value.endsWith("px") && Number.parseInt(value, 10) % 8 === 0;
say(
	"…snapped to the grid, and carrying no markup of the element",
	onGrid(dragged?.style?.left) && onGrid(dragged?.style?.top) && !("html" in (dragged ?? {})),
	`left ${dragged?.style?.left}, top ${dragged?.style?.top}, on-grid ${onGrid(dragged?.style?.left)}, keys ${Object.keys(dragged ?? {}).join(",")}`,
);

// --- resize ------------------------------------------------------------------------------------
await clearOps();
/*
 * Two pixels inside the element's own bottom-right corner.
 *
 * Pressing the corner rather than a point on one edge, and measuring it from the element rather than from
 * a number written here: the resize zone is the outer eight pixels, and a check that guesses where that
 * is tests its own arithmetic. A corner press is inside both zones, so whichever edge the geometry puts
 * under the pointer, the gesture is a resize.
 */
/*
 * Two pixels inside the right edge, at half its height.
 *
 * Measured from the element's own box — see `pointIn` — and at mid-height rather than in the corner,
 * because a card's corner is rounded and the part of it that is certainly inside the element is the middle
 * of an edge.
 */
const innerBox = await board.locator(card).boundingBox();
const corner2 = { x: innerBox.x + innerBox.width - 2, y: innerBox.y + innerBox.height / 2 };
await page.mouse.move(corner2.x, corner2.y);
await page.mouse.down();
await page.mouse.move(corner2.x + 64, corner2.y + 32, { steps: 8 });
await page.mouse.up();
const resized = await lastOp();
const size = Object.keys(resized?.style ?? {});
say(
	"a press in a corner resizes, and emits a `set` of the size and not the position",
	resized?.op === "set" && size.length > 0 && size.every((key) => key === "width" || key === "height"),
	`from ${JSON.stringify(corner2)} (element ${Math.round(innerBox.width)}x${Math.round(innerBox.height)} at ${Math.round(innerBox.x)},${Math.round(innerBox.y)}): ${JSON.stringify(resized)}`,
);

// --- duplicate ---------------------------------------------------------------------------------
await clearOps();
await page.mouse.click((await pointIn(card)).x, (await pointIn(card)).y);
await page.keyboard.press("Meta+d");
const copied = await lastOp();
say(
	"⌘D duplicates a placed node, with the offset that puts the copy beside it",
	copied?.op === "duplicate" && copied?.offset?.x === 16 && Array.isArray(copied?.path),
	JSON.stringify(copied),
);

// --- the palette -------------------------------------------------------------------------------
await clearOps();
await page.locator("#palette button").first().click();
const added = await lastOp();
say(
	"a palette press inserts one, at the body's end, as placed markup",
	added?.op === "insert" && Array.isArray(added?.path) && /class="sticky"/.test(added?.html ?? ""),
	JSON.stringify({ op: added?.op, path: added?.path, html: String(added?.html ?? "").slice(0, 90) }),
);
say(
	"…with its own left and top, and a name nothing else is using",
	/left: \d+px/.test(added?.html ?? "") && /top: \d+px/.test(added?.html ?? "") && /data-id="sticky(-\d+)?"/.test(added?.html ?? ""),
	String(added?.html ?? "").slice(0, 120),
);

// --- delete ------------------------------------------------------------------------------------
await clearOps();
await page.mouse.click((await pointIn(card)).x, (await pointIn(card)).y);
await page.keyboard.press("Delete");
const removed = await lastOp();
say(
	"Delete removes the selection, and its guard is the words that were there",
	removed?.op === "remove" && Array.isArray(removed?.path) && (removed?.before ?? "").length > 0,
	JSON.stringify({ op: removed?.op, path: removed?.path, before: String(removed?.before ?? "").slice(0, 40) }),
);

// --- the caret on a leaf ------------------------------------------------------------------------
await clearOps();
const words = await pointIn('[data-id="goal"] p', { x: 30, y: 8 });
await page.mouse.dblclick(words.x, words.y);
say(
	"a double-click puts a caret in the run, as a plaintext surface rather than a rich one",
	(await board.locator('[data-id="goal"] p').first().getAttribute("contenteditable")) === "plaintext-only",
	String(await board.locator('[data-id="goal"] p').first().getAttribute("contenteditable")),
);
await page.keyboard.type(" and one more tab");
await page.mouse.click((await pointIn(card)).x, (await pointIn(card)).y);
const typed = await lastOp();
say(
	"…and leaving it emits one `text`, with the words that were there as the guard",
	typed?.op === "text" && Array.isArray(typed?.path) && (typed?.before ?? "").length > 0 && /one more tab/.test(typed?.html ?? ""),
	JSON.stringify({ op: typed?.op, path: typed?.path, before: String(typed?.before ?? "").slice(0, 30), html: String(typed?.html ?? "").slice(0, 60) }),
);

/*
 * And the property that matters more than the gesture: **a caret opened and left writes nothing.**
 * `contenteditable` alone can rewrite an element's markup while somebody only clicked it, and a file must
 * not change because a person put a caret in it and looked away.
 */
await clearOps();
await page.mouse.dblclick(words.x, words.y);
await page.mouse.click((await pointIn(card)).x, (await pointIn(card)).y);
say("a caret opened and left without typing emits nothing", (await ops()).length === 0, `${(await ops()).length} op(s)`);

// --- reorder among siblings ---------------------------------------------------------------------
await page.goto(`${WEB}/editor.html?board=${encodeURIComponent("boards/notes.html")}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__editorDev?.loaded === true, null, { timeout: 20000 });
await page.locator("#mode").click();
await clearOps();

const flow = page.frameLocator(".board-frame");
const paragraphs = await flow.locator(".doc > p").count();
const firstText = await flow.locator(".doc > p").first().innerText();
const first = await flow.locator(".doc > p").first().boundingBox();
const third = await flow.locator(".doc > p").nth(2).boundingBox();
const draggedText = await flow.locator(".doc > p").nth(2).innerText();

/*
 * Dropped two pixels below the *first paragraph's* top: above every sibling's midpoint, which is the
 * condition `dropIndex` counts — so the block lands as early as that point allows, which is directly under
 * the document's heading. A drop 200 pixels higher up was a no-op: it left the pointer below the siblings
 * it was supposed to pass.
 */
await page.mouse.move(third.x + 40, third.y + 6);
await page.mouse.down();
await page.mouse.move(third.x + 40, first.y + 2, { steps: 12 });
await page.mouse.up();
const reordered = await lastOp();

/*
 * `to: 1` and not `to: 0`, because the index counts **every** element child of the parent and the document
 * opens with a heading: a paragraph dropped at the top of the flow is the second child, which is the
 * position it visibly takes. The first version of this asserted zero and called a correct gesture wrong.
 */
say(
	"a block dragged above its siblings emits one `move`, to the index it ends up at",
	reordered?.op === "move" && Array.isArray(reordered?.path) && reordered?.to === 1,
	`of ${paragraphs} paragraphs, path ${JSON.stringify(reordered?.path)}, to ${reordered?.to}`,
);
say(
	"…and the frame is already in that order, because the drag moved it there",
	(await flow.locator(".doc > p").first().innerText()) === draggedText &&
		(await flow.locator(".doc > p").first().innerText()) !== firstText,
	`first paragraph now starts “${(await flow.locator(".doc > p").first().innerText()).slice(0, 40)}”`,
);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
