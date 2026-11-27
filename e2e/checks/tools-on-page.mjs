/**
 * The canvas's tools are the page's, drawn over the canvas frame, and the two stay in step.
 *
 * The tool column, the properties panel and the zoom stood inside the frame, beside the canvas, where
 * a float went no further than the frame's edge. The page draws them now (`tabs/kinds/canvas-tools.tsx`),
 * and the tools' state is the same at both ends (`@decks/canvas`, `frame/tools-mirror.ts`). Here:
 * they are on the page and not in the frame; a tool pressed on the page arms the canvas and leaves it
 * the keyboard; the canvas puts the tool down again and the page's column shows it; the column's own
 * key, pressed on the canvas, reaches the column; what is selected on the canvas shows in the page's
 * properties, and a value typed there is saved, the field giving the keyboard back when it is left; and
 * the column is one of the page's floats: it stands against the side panel's edge, goes down to the
 * window's foot beside the composer, and it and the composer keep clear of each other.
 */
import { canvasFrame, focusCanvas, onCanvasAt, open, rest, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 6000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const canvas = await canvasFrame(page);
const link = await socket();
const agentId = await until(() => link.last("agent.list")?.focused);
const drawn = () => link.drawing(agentId)?.doc ?? { children: [] };

// --- where they are ----------------------------------------------------------------------------------
const places = {};
for (const [name, selector] of Object.entries({ column: ".pen-tools", zoom: ".v3-zoom" })) places[name] = { page: await page.locator(selector).count(), frame: await canvas.locator(selector).count() };
say("the tool column and the zoom are on the page, and the frame draws none", Object.values(places).every((one) => one.page === 1 && one.frame === 0), JSON.stringify(places));

// --- a tool pressed on the page arms the canvas, which keeps the keyboard ----------------------------
// A place the frame calls bare canvas and the page leaves to the frame.
const spots = await canvas.evaluate(() => {
	const stage = document.querySelector(".canvas");
	const out = [];
	for (let y = 200; y < 700; y += 40) for (let x = 480; x < 1200; x += 40) if ([0, 120].every((dx) => [0, 80].every((dy) => document.elementFromPoint(x + dx, y + dy) === stage))) out.push({ x, y });
	return out;
});
let spot;
for (const one of spots) {
	if (await onCanvasAt(page, one.x, one.y) && (await onCanvasAt(page, one.x + 120, one.y + 80))) {
		spot = one;
		break;
	}
}
say("there is bare canvas to press", !!spot, JSON.stringify(spot));
await focusCanvas(page);
await page.mouse.click(spot.x, spot.y);
await page.locator('.pen-tools [data-tool="note"]').first().click();
const armed = await until(() => canvas.evaluate(() => document.querySelector(".canvas")?.dataset.penTool === "note"));
say("the note tool pressed on the page arms the canvas in its frame", !!armed);
say("…and the keyboard stays with the canvas", (await page.evaluate(() => document.activeElement?.tagName)) === "IFRAME");
const had = new Set((drawn().children ?? []).map((node) => node.id));
await page.mouse.click(spot.x, spot.y);
// The note opens for typing, in the frame.
await until(() => canvas.evaluate(() => document.activeElement?.matches?.("textarea.pen-text") === true));
await page.keyboard.type("made from the page");
await page.keyboard.press("Escape");
const note = await until(() => (drawn().children ?? []).find((node) => !had.has(node.id) && node.type === "note" && node.content));
say("a press on the canvas makes the note, typed into at once", note?.content === "made from the page", JSON.stringify(note?.content));
const down = await until(() => page.evaluate(() => document.querySelector('.pen-tools [data-tool="note"]')?.getAttribute("aria-pressed") !== "true" && document.querySelector('.pen-tools [data-tool="select"]')?.getAttribute("aria-pressed") === "true"));
say("…and the canvas puts the tool down: the page's column shows select again", !!down);

// --- the column's own key, pressed on the canvas ------------------------------------------------------
await focusCanvas(page);
await page.keyboard.press("h");
const hand = await until(() => page.evaluate(() => document.querySelector('.pen-tools [data-tool="view"]')?.getAttribute("aria-pressed") === "true" && document.querySelector('.pen-tools [data-tool="select"]')?.getAttribute("aria-pressed") !== "true"));
say("H pressed on the canvas takes up the hand in the page's column", !!hand);
await page.keyboard.press("v");
await settle(page, 200);

// --- the selection on the canvas, in the page's properties -------------------------------------------
const at = note ? await until(() => canvas.evaluate((id) => globalThis.__decksProbes?.penBox?.(id), note.id)) : undefined;
if (at) await page.mouse.click(at.x + at.width / 2, at.y + 8);
const panel = await until(() => page.locator(".props-panel").count(), 4000);
say("the note selected on the canvas shows in the properties, on the page", panel === 1 && (await canvas.locator(".props-panel").count()) === 0);
const width = page.locator('.props-panel [data-field="w"] input');
if (await width.count()) {
	await width.fill("300");
	await width.press("Enter");
}
const wide = await until(() => ((drawn().children ?? []).find((node) => node.id === note?.id)?.width === 300 ? true : undefined));
say("a width typed there is saved to the drawing", !!wide, String((drawn().children ?? []).find((node) => node.id === note?.id)?.width));
// The field keeps the keyboard while it is typed into; left for nothing else on the page, it gives it back.
if (await width.count()) await width.evaluate((field) => field.blur());
say("…and the field, once left, gives the keyboard back to the canvas", (await until(() => page.evaluate(() => document.activeElement?.tagName === "IFRAME"), 2000)) === true);

// --- the zoom ------------------------------------------------------------------------------------------
const reading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
const before = await reading();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
const zoomed = await until(async () => ((await reading()) > before ? true : undefined));
say("the page's zoom button zooms the canvas, and its reading follows", !!zoomed, `${before}% → ${await reading()}%`);

// --- the column is a float of the page's, beside the composer ----------------------------------------
const gripSelector = ".pen-tools .v3-grip, .pen-tools .pen-grip, .pen-tools [class*='grip']";
const panelRight = await page.evaluate(() => document.querySelector(".panel-shell")?.getBoundingClientRect().right ?? 0);
const box = (selector) => page.locator(selector).first().boundingBox();
/** Take the column by its grip, carry the grip to a place, pause there (a placement, not a throw), and let go. */
const carry = async (x, y) => {
	const grip = await box(gripSelector);
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(grip.x + grip.width / 2 + 30, grip.y + grip.height / 2 + 60, { steps: 6 });
	await page.mouse.move(x, y, { steps: 14 });
	await page.waitForTimeout(300);
	await page.mouse.up();
	await settle(page, 900);
	return box(".pen-tools");
};
const view = page.viewportSize();
// Carried over the side panel, it stays in the canvas's column and stands against the panel's edge.
let column = await carry(panelRight / 2, 380);
say("carried over the side panel, the column stands against the panel's edge", !!column && panelRight > 200 && Math.abs(column.x - (panelRight + 12)) <= 2, JSON.stringify({ column: column && Math.round(column.x), panelRight: Math.round(panelRight) }));
// Carried to the foot of the window beside the composer, it goes all the way down.
const dock = await box(".dock");
column = await carry(panelRight + 40, view.height - 4);
say("carried to the foot, it stands at the window's foot, beside the composer", !!column && !!dock && column.y + column.height > dock.y + 20 && Math.abs(column.y + column.height - (view.height - 12)) <= 2, JSON.stringify({ foot: column && Math.round(column.y + column.height), dockTop: dock && Math.round(dock.y), window: view.height }));
// Dropped on the composer, it takes the nearest place clear of it.
column = await carry(dock.x + dock.width / 2, dock.y + dock.height / 2 - 200);
const clear = (a, b, gap = 6) => a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y;
const dockNow = await box(".dock");
say("dropped on the composer, it rests clear of it", !!column && !!dockNow && clear(column, dockNow), JSON.stringify({ column, dock: dockNow }));
const reach = column ? await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".pen-tools"), [column.x + column.width / 2, column.y + 60]) : false;
say("…and can be pressed there", reach);
// The composer dropped on the column steps clear of it too.
const bar = await box(".dock .composer-box");
if (bar && column) {
	await page.mouse.move(bar.x + bar.width / 2, bar.y + 5);
	await page.mouse.down();
	await page.mouse.move(bar.x + bar.width / 2 - 40, bar.y - 60, { steps: 6 });
	await page.mouse.move(column.x + column.width / 2 + bar.width / 4, column.y + column.height / 2, { steps: 14 });
	await page.waitForTimeout(300);
	await page.mouse.up();
	await settle(page, 900);
}
const [columnThen, dockThen] = [await box(".pen-tools"), await box(".dock")];
say("the composer dropped on the column rests clear of it", !!columnThen && !!dockThen && Math.abs(dockThen.y - dockNow.y) + Math.abs(dockThen.x - dockNow.x) > 40 && clear(columnThen, dockThen), JSON.stringify({ column: columnThen, dock: dockThen }));

say("no page errors", errors.length === 0, errors.join(" | "));
link.close();
await browser.close();
