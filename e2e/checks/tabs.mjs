/**
 * Tabs: a canvas opened in a tab of its own, beside home.
 *
 * The window shows the tab in front (`apps/web/src/tabs/`). The first is home, the canvas chip in the
 * top bar: the canvas of the conversation on screen, as the one canvas always was. The + opens another
 * canvas as a tab: it is looked at and edited there, and no agent moves. Here: the + lists the
 * canvases and opens one; its cards show, in the frame and in the side panel's list; the conversation's
 * agent is still on its own canvas; a note made on the tab lands on that canvas and not on home; the
 * home chip brings home back with a press and opens the canvas list with the next; each tab keeps its
 * own camera; and the ✕ closes the tab, home coming forward.
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
const homeAgents = await agentsOn(CANVAS);

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const drawnIn = async () => (await canvasFrame(page)).evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).map((one) => one.metadata?.path ?? one.id));
const homeDrawn = await drawnIn();

// --- one tab, home: the top bar as it was, with a + that opens a tab -----------------------------------
say("alone, home is the canvas chip and there are no other tabs", (await page.locator(".v3-topbar .v3-canvas-chip").count()) === 1 && (await page.locator(".tab-chip").count()) === 0);

// --- the + opens a canvas as a tab ----------------------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
const chip = page.locator('.tab-chip[data-kind="canvas"]');
say("the canvas is a tab in the row, in front", (await until(() => chip.count())) === 1 && (await chip.getAttribute("data-front")) === "true" && (await chip.innerText()).includes("Tab two"), await chip.innerText().catch(() => ""));
const shown = await until(async () => ((await drawnIn()).some((path) => String(path).includes("second-card")) ? true : undefined));
say("the window shows that canvas: its card is in the frame", !!shown, JSON.stringify(await drawnIn()).slice(0, 200));
say("…and none of home's", !(await drawnIn()).some((path) => homeDrawn.includes(path)));
say("no agent moved: the conversation's agent is still on its own canvas", JSON.stringify(await agentsOn(CANVAS)) === JSON.stringify(homeAgents) && (await agentsOn(second)).length === 0, JSON.stringify([await agentsOn(CANVAS), await agentsOn(second)]));
say("the home chip still names the conversation's canvas, and is not the one in front", (await page.locator(".v3-topbar .v3-canvas-chip").getAttribute("data-front")) === null && !(await page.locator(".v3-topbar .v3-canvas-chip").innerText()).includes("Tab two"));
// The side panel's Canvas tab lists what is on the canvas on screen.
await page.locator('.v3-nav-tab:has-text("Canvas")').first().click().catch(() => {});
say("the side panel lists the card of the canvas in front", !!(await until(() => page.locator('.panel-shell :text("Second card")').count())), (await page.locator(".panel-shell").innerText().catch(() => "")).slice(0, 160));

// --- an edit on the tab lands on its canvas ------------------------------------------------------------
const canvas = await canvasFrame(page);
const spots = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	const out = [];
	for (let y = 260; y < 700; y += 40) for (let x = 480; x < 1200; x += 40) if ([0, 120].every((dx) => [0, 80].every((dy) => document.elementFromPoint(x + dx, y + dy) === stage))) out.push({ x, y });
	return out;
});
let spot;
for (const one of spots) if ((await onCanvasAt(page, one.x, one.y)) && (await onCanvasAt(page, one.x + 120, one.y + 80))) { spot = one; break; }
say("there is bare canvas to press", !!spot);
if (spot) {
	await page.locator('.pen-tools [data-tool="note"]').first().click();
	await until(() => canvas.evaluate(() => document.querySelector(".stage")?.dataset.penTool === "note"));
	await page.mouse.click(spot.x, spot.y);
	await until(() => canvas.evaluate(() => document.activeElement?.matches?.("textarea.pen-text") === true));
	await page.keyboard.type("on tab two");
	await page.keyboard.press("Escape");
}
const notesOn = async (name) => (((await call("canvas.read", [{ canvas: name }])).value?.items ?? []).filter((one) => one.type === "note" && one.content === "on tab two")).length;
say("a note made there is on that canvas", (await until(async () => ((await notesOn(second)) === 1 ? true : undefined))) === true, String(await notesOn(second)));
say("…and not on the conversation's", (await notesOn(CANVAS)) === 0);

// --- each tab keeps its own camera -----------------------------------------------------------------------
const reading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await settle(page, 700);
const zoomTwo = await reading();

// --- the home chip: a press brings home forward, the next opens the canvas list ------------------------
await page.locator(".v3-topbar .v3-canvas-chip").click();
const back = await until(async () => ((await drawnIn()).some((path) => homeDrawn.includes(path)) ? true : undefined));
say("a press on the home chip brings home forward: the conversation's canvas is in the frame", !!back && (await page.locator(".v3-topbar .v3-canvas-chip").getAttribute("data-front")) === "true" && (await chip.getAttribute("data-front")) === null);
say("…without opening the canvas list", (await page.locator(".switcher-canvas").count()) === 0);
await settle(page, 900);
const zoomHome = await reading();
await page.locator(".v3-topbar .v3-canvas-chip").click();
say("in front, a press on it opens the canvas list, as it always did", !!(await until(() => page.locator(".switcher-canvas").count())));
await page.keyboard.press("Escape");
await chip.locator(".tab-chip-name").click();
await until(async () => ((await drawnIn()).some((path) => String(path).includes("second-card")) ? true : undefined));
await settle(page, 900);
say("the tab comes back at the zoom it was left at, which is not home's", Math.abs((await reading()) - zoomTwo) <= 1 && Math.abs(zoomTwo - zoomHome) > 1, JSON.stringify({ zoomTwo, zoomHome, now: await reading() }));

// --- the agent on screen shows a card of its own canvas while this tab is in front: a button, not a move ----
const plan = card("plan");
const focus = await call("view.focus", [plan]);
const show = page.locator(".notice .notice-action", { hasText: "Show" });
say("view focus from the chat on screen, with another canvas's tab in front, offers a button and moves nothing", /offered a button/.test(focus.value?.deferred ?? "") && (await until(() => show.count())) === 1 && (await chip.getAttribute("data-front")) === "true", JSON.stringify(focus).slice(0, 240));
await show.click();
const there = await until(async () => {
	if ((await page.locator(".v3-topbar .v3-canvas-chip").getAttribute("data-front")) !== "true") return undefined;
	const box = await (await canvasFrame(page)).evaluate((path) => {
		const one = globalThis.__decksProbes?.cards?.().find((each) => each.path === path)?.rect;
		return one ? { x: one.x, y: one.y, w: one.width, h: one.height, vw: innerWidth, vh: innerHeight } : undefined;
	}, plan);
	// Framed: the card whole on the screen, and filling a good part of it.
	return box && box.x >= 0 && box.y >= 0 && box.x + box.w <= box.vw && box.y + box.h <= box.vh && box.h > box.vh * 0.4 ? true : undefined;
}, 8000);
say("…pressed, home comes forward and the card is framed", !!there);
await chip.locator(".tab-chip-name").click();
await until(async () => ((await drawnIn()).some((path) => String(path).includes("second-card")) ? true : undefined));

// --- the ✕ closes it ---------------------------------------------------------------------------------------
await chip.locator(".tab-chip-close").click();
say("the ✕ closes the tab, and home comes forward", (await until(async () => ((await page.locator(".tab-chip").count()) === 0 ? true : undefined))) === true && !!(await until(async () => ((await drawnIn()).some((path) => homeDrawn.includes(path)) ? true : undefined))));
await focusCanvas(page);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
