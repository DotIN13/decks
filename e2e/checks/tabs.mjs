/**
 * Tabs: canvases as tabs, and the camera of the chat on screen moving between them.
 *
 * There is no home canvas (`apps/web/src/tabs/tabs.ts`). The canvas the camera of the chat on screen
 * is on is a tab in the row like any other. The + opens another canvas as a tab and puts that camera
 * on it: that tab is in front now, and the canvas the camera left stays in the row, in its place, a
 * press away. Here: the + lists the canvases and opens one; its cards show, in the
 * frame and in the side panel's list; the harness is told where that chat's camera is; a note made
 * there lands on that canvas; each canvas keeps its own place; the agent on screen showing a card of
 * another canvas takes the camera there; and the ✕ takes a tab out of the row.
 */
import { API, CANVAS, card, asPerson, canvasFrame, focusCanvas, onCanvasAt, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const made = await call("canvas.create", ["Tab two"]);
const second = made.value?.name;
const placed = await call("canvas.insert", [{ type: "card", title: "Second card", html: "<h1>Only on tab two</h1><p>A card of the second canvas.</p>", width: 520, height: 300 }, { canvas: second, at: { x1: 0, y1: 0 } }]);
say("a second canvas with a card of its own", !!second && placed.ok === true, JSON.stringify([made, placed]).slice(0, 240));
const agentsOn = async (name) => ((await call("canvas.list", [])).value ?? []).find((one) => one.name === name)?.open ?? [];
const firstAgents = await agentsOn(CANVAS);

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const drawnIn = async () => (await canvasFrame(page)).evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).map((one) => one.metadata?.path ?? one.id));
const firstDrawn = await drawnIn();
// The tab of the canvas the chat's camera is on, and its name.
const canvasChip = page.locator('.v3-topbar .tab-chip[data-camera="true"]');
const rowNames = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.innerText.trim()}${one.dataset.front ? "*" : ""}`));
const chipName = async () => (await canvasChip.innerText()).trim();
const firstTitle = await chipName();

// --- one canvas: the top bar as it was, with a + that opens a tab ---------------------------------------
say("alone, the canvas is the row's only tab, and has no ✕: a chat is always on a canvas", (await canvasChip.count()) === 1 && (await page.locator(".tab-chip[data-tab]").count()) === 1 && (await page.locator(".v3-topbar .tab-chip-close").count()) === 0);

// --- the + opens a canvas as a tab, and the camera goes there ---------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
const chip = page.locator('.tab-chip[data-kind="canvas"]:not([data-camera])');
say("the tab of the canvas opened is in front", (await until(async () => ((await chipName()).includes("Tab two") ? true : undefined))) === true && (await canvasChip.getAttribute("data-front")) === "true", await chipName());
say("…and the canvas the camera left stays in the row, as a tab", (await until(() => chip.count())) === 1 && (await chip.innerText()).includes(firstTitle) && (await chip.getAttribute("data-front")) === null, await chip.innerText().catch(() => ""));
say("…in its place: the first tab is still first, and the one opened is after it", JSON.stringify(await rowNames()) === JSON.stringify([firstTitle, "Tab two*"]), JSON.stringify(await rowNames()));
const shown = await until(async () => ((await drawnIn()).some((path) => String(path).includes("second-card")) ? true : undefined));
say("the window shows that canvas: its card is in the frame", !!shown, JSON.stringify(await drawnIn()).slice(0, 200));
say("…and none of the first one's", !(await drawnIn()).some((path) => firstDrawn.includes(path)));
say("the harness is told: that chat's camera is on the canvas opened, and no longer on the first", (await until(async () => ((await agentsOn(second)).length === firstAgents.length && (await agentsOn(CANVAS)).length === 0 ? true : undefined))) === true, JSON.stringify([await agentsOn(CANVAS), await agentsOn(second)]));
// The side panel's Objects tab lists what is on the canvas on screen.
await page.locator('.v3-nav-tab:has-text("Objects")').first().click().catch(() => {});
say("the side panel lists the card of the canvas in front", !!(await until(() => page.locator('.panel-shell :text("Second card")').count())), (await page.locator(".panel-shell").innerText().catch(() => "")).slice(0, 160));

// --- an edit there lands on that canvas --------------------------------------------------------------------
const canvas = await canvasFrame(page);
const spots = await canvas.evaluate(() => {
	const stage = document.querySelector(".canvas");
	const out = [];
	for (let y = 260; y < 700; y += 40) for (let x = 480; x < 1200; x += 40) if ([0, 120].every((dx) => [0, 80].every((dy) => document.elementFromPoint(x + dx, y + dy) === stage))) out.push({ x, y });
	return out;
});
let spot;
for (const one of spots) if ((await onCanvasAt(page, one.x, one.y)) && (await onCanvasAt(page, one.x + 120, one.y + 80))) { spot = one; break; }
say("there is bare canvas to press", !!spot);
if (spot) {
	await page.locator('.pen-tools [data-tool="note"]').first().click();
	await until(() => canvas.evaluate(() => document.querySelector(".canvas")?.dataset.penTool === "note"));
	await page.mouse.click(spot.x, spot.y);
	await until(() => canvas.evaluate(() => document.activeElement?.matches?.("textarea.pen-text") === true));
	await page.keyboard.type("on tab two");
	await page.keyboard.press("Escape");
}
const notesOn = async (name) => (((await call("canvas.read", [{ canvas: name }])).value?.items ?? []).filter((one) => one.type === "note" && one.content === "on tab two")).length;
say("a note made there is on that canvas", (await until(async () => ((await notesOn(second)) === 1 ? true : undefined))) === true, String(await notesOn(second)));
say("…and not on the first", (await notesOn(CANVAS)) === 0);

// --- each canvas keeps its own place -----------------------------------------------------------------------
const reading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await settle(page, 700);
const zoomTwo = await reading();

// --- a press on the other canvas's tab puts the camera back there ---------------------------------------------
await chip.locator(".tab-chip-name").click();
const back = await until(async () => ((await drawnIn()).some((path) => firstDrawn.includes(path)) ? true : undefined));
say("a press on the first canvas's tab puts the camera back on it: it is in the frame and in front, and no tab has moved", !!back && (await until(async () => ((await chipName()).includes(firstTitle) ? true : undefined))) === true && JSON.stringify(await rowNames()) === JSON.stringify([`${firstTitle}*`, "Tab two"]), JSON.stringify(await rowNames()));
say("…without opening the canvas list", (await page.locator(".switcher-canvas").count()) === 0);
await settle(page, 900);
const zoomFirst = await reading();
await canvasChip.locator(".tab-chip-name").click();
say("in front, a press on a canvas's tab opens the canvas list, to take the tab to another canvas", !!(await until(() => page.locator(".switcher-canvas").count())));
await page.keyboard.press("Escape");
await chip.locator(".tab-chip-name").click();
await until(async () => ((await drawnIn()).some((path) => String(path).includes("second-card")) ? true : undefined));
await settle(page, 900);
say("the canvas come back to is at the zoom it was left at, which is not the first one's", Math.abs((await reading()) - zoomTwo) <= 1 && Math.abs(zoomTwo - zoomFirst) > 1, JSON.stringify({ zoomTwo, zoomFirst, now: await reading() }));

// --- the agent on screen shows a card of another canvas: its camera goes there -------------------------------
const plan = card("plan");
// An agent's view waits while the person's hands are on the canvas, five seconds from the last press there (`camera/touched.ts`): the note above was one.
await settle(page, 5200);
const focus = await call("view.focus", [plan]);
const there = await until(async () => {
	if (!(await chipName()).includes(firstTitle)) return undefined;
	const box = await (await canvasFrame(page)).evaluate((path) => {
		const one = globalThis.__decksProbes?.cards?.().find((each) => each.path === path)?.rect;
		return one ? { x: one.x, y: one.y, w: one.width, h: one.height, vw: innerWidth, vh: innerHeight } : undefined;
	}, plan);
	// Framed: the card whole on the screen, and filling a good part of it.
	return box && box.x >= 0 && box.y >= 0 && box.x + box.w <= box.vw && box.y + box.h <= box.vh && box.h > box.vh * 0.4 ? true : undefined;
}, 10000);
say("view focus from the chat on screen on a card of the other canvas takes the camera there and frames the card", focus.ok === true && !!there, JSON.stringify(focus).slice(0, 240));

// --- the ✕ takes a tab out of the row ---------------------------------------------------------------------------
await chip.locator(".tab-chip-close").click();
say("the ✕ closes the other canvas's tab, and the camera stays where it is", (await until(async () => ((await page.locator(".tab-chip[data-tab]").count()) === 1 ? true : undefined))) === true && (await chipName()).includes(firstTitle) && (await drawnIn()).some((path) => firstDrawn.includes(path)));

// --- the tab in front closes like any other: the camera goes to the canvas beside it -------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
await until(async () => ((await chipName()).includes("Tab two") ? true : undefined));
await canvasChip.locator(".tab-chip-close").click();
say("the ✕ on the canvas tab in front closes it too: the camera goes to the canvas beside it, which is the row's one tab again", (await until(async () => ((await chipName()).includes(firstTitle) && (await page.locator(".tab-chip[data-tab]").count()) === 1 ? true : undefined))) === true && !!(await until(async () => ((await drawnIn()).some((path) => firstDrawn.includes(path)) ? true : undefined))) && (await page.locator(".v3-topbar .tab-chip-close").count()) === 0, JSON.stringify(await rowNames()));
await focusCanvas(page);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
