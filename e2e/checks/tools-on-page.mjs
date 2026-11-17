/**
 * The canvas's tools are the page's, drawn over the canvas frame, and the two stay in step.
 *
 * The tool column, the properties panel and the zoom stood inside the frame, beside the canvas, where
 * a float went no further than the frame's edge. The page draws them now (`app/canvas-tools.tsx`),
 * and the tools' state is the same at both ends (`@decks/canvas`, `frame/tools-mirror.ts`). Here:
 * they are on the page and not in the frame; a tool pressed on the page arms the canvas and leaves it
 * the keyboard; the canvas puts the tool down again and the page's column shows it; the column's own
 * key, pressed on the canvas, reaches the column; what is selected on the canvas shows in the page's
 * properties, and a value typed there is saved, the field giving the keyboard back when it is left; and the column is dragged over the side panel, where
 * the frame's edge used to stop it.
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
	const stage = document.querySelector(".stage");
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
const armed = await until(() => canvas.evaluate(() => document.querySelector(".stage")?.dataset.penTool === "note"));
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

// --- the column goes where the frame's edge stopped it -----------------------------------------------
const panelRight = await page.evaluate(() => document.querySelector(".panel-shell")?.getBoundingClientRect().right ?? 0);
const grip = await page.locator(".pen-tools .v3-grip, .pen-tools .pen-grip, .pen-tools [class*='grip']").first().boundingBox();
if (grip && panelRight > 200) {
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(grip.x - 60, grip.y + 120, { steps: 6 });
	await page.mouse.move(panelRight / 2, 420, { steps: 12 });
	await page.waitForTimeout(250);
	await page.mouse.up();
	await settle(page, 900);
}
const column = await page.locator(".pen-tools").boundingBox();
say("the column is dragged over the side panel and stays there", !!column && panelRight > 200 && column.x + column.width < panelRight, JSON.stringify({ column: column && Math.round(column.x), panelRight: Math.round(panelRight) }));
const over = column ? await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".pen-tools"), [column.x + column.width / 2, column.y + 60]) : false;
say("…above the panel, where it can be pressed", over);

say("no page errors", errors.length === 0, errors.join(" | "));
link.close();
await browser.close();
