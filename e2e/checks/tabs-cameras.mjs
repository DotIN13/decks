/**
 * Each agent's chat has a camera, on one tab, with its own place on each canvas
 * (`apps/web/src/tabs/tabs.ts`, `app/landing.ts`).
 *
 * There is no home canvas. The row of tabs is the window's; what is in front is the conversation's.
 * Opening an agent's chat shows the tab its camera is on: a card left open with one agent is not in
 * front for another, and is again when the first is come back to. A canvas tab picked moves that
 * chat's camera to the canvas, where each agent has its own place, kept. An agent's `view open` from
 * the background puts its camera on that tab without moving the screen; a view it sets on its canvas
 * takes the tab off it again; its `view goto` moves the camera, and the screen with it when its chat
 * is the one on screen. And a reload finds each agent's tab again.
 */
import { API, CANVAS as firstCanvasName, asPerson, card, newAgent, open, openAgents, resetStage, rest, say, settle, socket, canvasFrame } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args, more = {}) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, ...more }, body: JSON.stringify({ args }) })).json();
const second = (await call("canvas.create", ["Tab two"])).value?.name;
await call("canvas.insert", [{ type: "card", title: "Second card", html: "<h1>Only on tab two</h1>", width: 520, height: 300 }, { canvas: second, at: { x1: 0, y1: 0 } }]);
await call("apps.create", ["cam-app", { title: "Camera app", starter: "static" }]);
const plan = card("plan");

// Wide enough for a chip per tab.
const { browser, page, errors } = await open({ width: 2000, height: 900 });
await rest(page, { start: 0 });
const link = await socket();
// Every agent there is before another is made.
const agentsNow = () => link.last("agent.list")?.chats ?? [];
await until(() => agentsNow().length > 0);
const before = new Set(agentsNow().map((one) => one.id));
// The agent whose chat the page opens on, by the name on its chip.
const nameOnChip = async () => (await page.locator(".v3-topbar .v3-agent-name").first().innerText()).trim();
const firstName = await nameOnChip();
// The tabs beside the one of the canvas the chat's camera is on, in the row's order, the one in front starred.
const chips = () => page.locator(".tab-chip[data-tab]:not([data-camera])").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const canvasFront = async () => (await page.locator('.v3-topbar .tab-chip[data-camera="true"]').getAttribute("data-front")) === "true";
const reading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
/** Wait for the canvas in front to be there and still: its frame started, and the zoom reading the same over half a second. */
const arrivedOnCanvas = async () => {
	await canvasFrame(page);
	await settle(page, 600);
	for (let i = 0, last = -1; i < 12; i++) {
		const now = await reading();
		if (now === last) return;
		last = now;
		await settle(page, 500);
	}
};
/** Open an agent's chat from the agent list, by the name the page shows for it. */
const openChat = async (name) => {
	await openAgents(page);
	await page.locator('.popover [data-row][data-agent="true"]').filter({ hasText: name }).first().click();
	await until(async () => ((await nameOnChip()) === name ? true : undefined));
	await settle(page, 400);
};

const canvasChip = page.locator('.v3-topbar .tab-chip[data-camera="true"]');
const chipName = async () => (await canvasChip.innerText()).trim();
const firstCanvas = await chipName();

// --- the first agent's camera goes to a card's tab ----------------------------------------------------------------
await call("view.open", [plan]);
say("with the first agent, a card opened is the tab in front", JSON.stringify(await until(async () => ((await chips()).length ? chips() : undefined))) === '["card*"]');

// --- another agent: its camera is on a canvas; the card's tab stays in the row --------------------------------------
await newAgent(page, "pi");
const other = await until(() => agentsNow().map((one) => one.id).find((id) => !before.has(id)));
// The page opens the new agent's chat, and its chip says its name.
const otherName = await until(async () => {
	const name = await nameOnChip();
	return name && name !== firstName ? name : undefined;
}, 15000);
say("two agents to tell apart, by the names the page shows", !!other && !!otherName, JSON.stringify({ firstName, otherName }));
say("a second agent's camera is on a canvas, in front; the card's tab is still in the row, not in front", (await until(async () => ((await canvasFront()) && JSON.stringify(await chips()) === '["card"]' ? true : undefined))) === true, JSON.stringify([await chips(), await canvasFront()]));
await openChat(firstName);
say("the first agent opened again: its camera is on the card, which is in front", (await until(async () => (JSON.stringify(await chips()) === '["card*"]' ? true : undefined))) === true, JSON.stringify(await chips()));

// --- a place on each canvas, per agent -------------------------------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
say("the first agent's camera goes to the canvas opened: its tab names it, and the one it left is a tab, in its place", (await until(async () => ((await chipName()).includes("Tab two") && JSON.stringify(await chips()) === '["canvas","card"]' ? true : undefined))) === true, JSON.stringify([await chipName(), await chips()]));
// Arrived: the canvas's frame has started (it may be one made for it just now) and the camera has landed, so the zoom reads the same twice.
await arrivedOnCanvas();
const arrived = await reading();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await settle(page, 800);
const firstZoom = await reading();
await openChat(otherName);
say("the second agent's camera is where it was: not on that canvas", (await until(async () => ((await canvasFront()) && !(await chipName()).includes("Tab two") ? true : undefined))) === true, await chipName());
await page.locator('.tab-chip[data-kind="canvas"]', { hasText: "Tab two" }).locator(".tab-chip-name").click();
await until(async () => ((await chipName()).includes("Tab two") ? true : undefined));
await arrivedOnCanvas();
const otherZoom = await reading();
say("put on the same canvas, the second agent has its own place there, not the first's", Math.abs(otherZoom - firstZoom) > 1 && Math.abs(otherZoom - arrived) <= 1, JSON.stringify({ arrived, firstZoom, otherZoom }));
await openChat(firstName);
await settle(page, 1200);
say("the first agent opened again is on that canvas, at the place it left", (await chipName()).includes("Tab two") && (await canvasFront()) && Math.abs((await reading()) - firstZoom) <= 1, JSON.stringify([await chipName(), await reading(), firstZoom]));

// --- an agent's view open from the background: its camera moves, the screen does not ---------------------------------
const offered = await call("view.open", ["cam-app"], { "x-decks-agent": other });
say("view open from the agent that is not on screen opens the tab behind, and says it waits in its chat", offered.value?.opened === false && /waits in your chat/.test(offered.value?.note ?? "") && (await until(async () => ((await chips()).includes("app") ? true : undefined))) === true && (await canvasFront()), JSON.stringify([offered.value, await chips()]).slice(0, 300));
await openChat(otherName);
say("that agent's chat opened: the app's tab is in front", (await until(async () => ((await chips()).includes("app*") ? true : undefined))) === true, JSON.stringify(await chips()));

// --- an agent pointing its view at its canvas: nothing is over it any more ------------------------------------------
await openChat(firstName);
await until(async () => ((await canvasFront()) ? true : undefined));
await call("view.move", [{ x: 0, y: 0, zoom: 0.5 }], { "x-decks-agent": other });
await openChat(otherName);
say("an agent that moved its view on its canvas, from the background, is on that canvas when its chat is opened", (await until(async () => ((await canvasFront()) && !(await chips()).includes("app*") ? true : undefined))) === true, JSON.stringify([await chips(), await canvasFront()]));

// --- the agent's own view goto: its camera, and the screen with it when its chat is the one on screen ------------------
const went = await call("view.goto", [firstCanvasName], { "x-decks-agent": other });
say("view goto from the chat on screen puts its camera on that canvas, and the screen goes there", went.ok === true && (await until(async () => ((await chipName()).includes(firstCanvas) ? true : undefined))) === true, JSON.stringify([went, await chipName()]).slice(0, 240));

// --- kept: the deck opened again finds each agent's tab ----------------------------------------------------------------
await openChat(firstName);
await call("view.open", [plan]);
await until(async () => ((await chips()).includes("card*") ? true : undefined));
const left = await chips();
const again = await page.context().newPage();
await again.goto(page.url().split("#")[0]);
const chipsAgain = () => again.locator(".tab-chip[data-tab]:not([data-camera])").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
say("opened again, the first agent's chat is on the tab its camera was on", JSON.stringify(await until(async () => ((await chipsAgain()).includes("card*") ? chipsAgain() : undefined))) === JSON.stringify(left), JSON.stringify([left, await chipsAgain()]));
await again.close();

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
link.close();
await browser.close();
