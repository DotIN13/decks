/**
 * Each agent's camera is on a tab, and has a place on each canvas (`apps/web/src/tabs/tabs.ts`,
 * `app/landing.ts`).
 *
 * The row of tabs is the window's; which one is in front is the conversation's. Opening an agent's
 * chat brings forward the tab its camera was on: a card left open with one agent is not in front for
 * another, and is again when the first is come back to. On a canvas in a tab each agent has its own
 * place, kept, and comes back to it. An agent's `view open` from the background puts its camera on
 * that tab without moving the screen: the tab is in front when its chat is opened. And a reload finds
 * each agent's tab again.
 */
import { API, asPerson, canvasFrame, card, newAgent, open, openAgents, resetStage, rest, say, settle, socket } from "../harness.mjs";

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
// The agent whose chat the page opens on, by the name on its chip; and every agent there is before another is made.
const firstName = (await page.locator(".v3-topbar .v3-agent-name").first().innerText()).trim();
const agentsNow = () => link.last("agent.list")?.chats ?? [];
const before = new Set(agentsNow().map((one) => one.id));
const first = agentsNow().find((one) => one.name === firstName)?.id;
const chips = () => page.locator(".tab-chip").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const homeFront = async () => (await page.locator(".v3-topbar .v3-canvas-chip").getAttribute("data-front")) === "true";
const reading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
/** Open an agent's chat from the agent list, by name. */
const openChat = async (name) => {
	await openAgents(page);
	await page.locator('.popover [data-row][data-flat="true"]').filter({ hasText: name }).first().click();
	await until(async () => ((await page.locator(".v3-topbar .v3-agent-name").first().innerText()).trim() === name ? true : undefined));
	await settle(page, 400);
};

// --- the first agent's camera goes to a card's tab ----------------------------------------------------------------
await call("view.open", [plan]);
say("with the first agent, a card opened is the tab in front", JSON.stringify(await until(async () => ((await chips()).length ? chips() : undefined))) === '["card*"]');

// --- another agent: its camera is on its own canvas; the card's tab stays in the row --------------------------------
await newAgent(page, "pi");
const other = await until(() => agentsNow().map((one) => one.id).find((id) => !before.has(id)));
const otherName = agentsNow().find((one) => one.id === other)?.name;
say("two agents to tell apart", !!first && !!other && first !== other && !!otherName && otherName !== firstName, JSON.stringify({ firstName, otherName }));
say("a second agent opens on its own canvas: home in front, the card's tab still in the row", (await until(async () => ((await homeFront()) && JSON.stringify(await chips()) === '["card"]' ? true : undefined))) === true, JSON.stringify([await chips(), await homeFront()]));
await openChat(firstName);
say("the first agent opened again: its camera is on the card, which is in front", (await until(async () => (JSON.stringify(await chips()) === '["card*"]' ? true : undefined))) === true, JSON.stringify(await chips()));

// --- a place on each canvas, per agent -------------------------------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
await until(async () => (JSON.stringify(await chips()) === '["card","canvas*"]' ? true : undefined));
await settle(page, 900);
const arrived = await reading();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await settle(page, 800);
const firstZoom = await reading();
await openChat(otherName);
say("the second agent is still on home", (await until(async () => ((await homeFront()) ? true : undefined))) === true);
await page.locator('.tab-chip[data-kind="canvas"] .tab-chip-name').click();
await settle(page, 1200);
const otherZoom = await reading();
say("on the same canvas's tab the second agent has its own place, not the first's", Math.abs(otherZoom - firstZoom) > 1 && Math.abs(otherZoom - arrived) <= 1, JSON.stringify({ arrived, firstZoom, otherZoom }));
await openChat(firstName);
await settle(page, 1200);
say("the first agent opened again is on that canvas's tab, at the place it left", JSON.stringify(await chips()) === '["card","canvas*"]' && Math.abs((await reading()) - firstZoom) <= 1, JSON.stringify([await chips(), await reading(), firstZoom]));

// --- an agent's view open from the background: its camera moves, the screen does not ---------------------------------
const offered = await call("view.open", ["cam-app"], { "x-decks-agent": other });
say("view open from the agent that is not on screen opens the tab behind, and says it waits in its chat", offered.value?.opened === false && /waits in your chat/.test(offered.value?.note ?? "") && JSON.stringify(await until(async () => ((await chips()).length === 3 ? chips() : undefined))) === '["card","canvas*","app"]', JSON.stringify([offered.value, await chips()]).slice(0, 300));
await openChat(otherName);
say("that agent's chat opened: the app's tab is in front", (await until(async () => (JSON.stringify(await chips()) === '["card","canvas","app*"]' ? true : undefined))) === true, JSON.stringify(await chips()));

// --- an agent pointing its view at its own canvas: its camera is home again -------------------------------------------
await openChat(firstName);
await until(async () => (JSON.stringify(await chips()) === '["card","canvas*","app"]' ? true : undefined));
await call("view.move", [{ x: 0, y: 0, zoom: 0.5 }], { "x-decks-agent": other });
await openChat(otherName);
say("an agent that moved its view on its own canvas, from the background, is on home when its chat is opened", (await until(async () => ((await homeFront()) && JSON.stringify(await chips()) === '["card","canvas","app"]' ? true : undefined))) === true, JSON.stringify([await chips(), await homeFront()]));

// --- kept: the deck opened again finds each agent's tab ----------------------------------------------------------------
await openChat(firstName);
await until(async () => (JSON.stringify(await chips()) === '["card","canvas*","app"]' ? true : undefined));
const again = await page.context().newPage();
await again.goto(page.url().split("#")[0]);
await canvasFrame(again);
const chipsAgain = () => again.locator(".tab-chip").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
say("opened again, the first agent's chat is on the tab its camera was on", JSON.stringify(await until(async () => ((await chipsAgain()).length === 3 ? chipsAgain() : undefined))) === '["card","canvas*","app"]', JSON.stringify(await chipsAgain()));
await again.close();

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
link.close();
await browser.close();
