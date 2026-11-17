/**
 * Links on the canvas to things in the deck (`packages/canvas/src/model/deck-link.ts`,
 * `apps/web/src/tabs/open.ts`).
 *
 * A link's address may be one of this window's own, the address a tab has after `#`: `#canvas/<name>`,
 * `#card/<path>`, `#doc/<path>`, `#app/<name>`. Followed on the canvas it opens that tab in this
 * window, in front, where a web link opens the browser's. Here, links in drawn words: a click opens a
 * card as a tab; a click on a canvas's opens it as another tab, the one left staying in the row; one
 * already open comes forward and no second is made; ⌘ asks for the browser's tab; and a link to
 * something that is not in the deck says so and opens nothing.
 */
import { API, CANVAS, asPerson, canvasFrame, card, open, resetStage, rest, say, settle } from "../harness.mjs";

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
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const second = (await call("canvas.create", ["Tab two"])).value?.name;
const plan = card("plan");

// --- links in drawn words ------------------------------------------------------------------------------------------
// Each a line of its own, a link from end to end, so a press in its middle is a press on the link.
const words = (id, content) => ({ type: "text", id, content, fontSize: 30, textGrowth: "fixed-width", width: 460, metadata: { type: "decks.markdown" } });
const placed = await call("canvas.batch", [
	[
		{ op: "insert", item: words("to-card", `[The plan, whole](#card/${plan})`), at: { x1: 0, y1: -400 } },
		{ op: "insert", item: words("to-canvas", `[Over to tab two](#canvas/${second})`), at: { x1: 0, y1: -320 } },
		{ op: "insert", item: words("to-gone", "[A canvas long gone](#canvas/nowhere-at-all)"), at: { x1: 0, y1: -240 } },
	],
	{ canvas: CANVAS },
]);
say("three lines of words, each a link to something in the deck", placed.ok === true, JSON.stringify(placed).slice(0, 240));

const { browser, page, errors } = await open({ width: 1400, height: 900, scheme: "light" });
await rest(page, { start: 0 });
/** Bring drawn items into view, as the agent on screen shows them: its offer is taken when the canvas was just touched. */
const show = async (ids) => {
	await call("view.focus", [ids, { canvas: CANVAS }]);
	const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
	if (await until(() => go.isVisible(), 1500)) await go.click();
	await settle(page, 900);
};
await show(["to-card", "to-canvas", "to-gone"]);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-words.png` });
/** A point on a drawn item, on screen: the canvas's frame fills the window, so its points are the page's. */
const middle = async (id) => {
	const box = await until(async () => (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), id));
	// A third of the way along: the words end before their box does, and the side panel lies over its start.
	return box ? { x: box.x + box.width * 0.3, y: box.y + box.height / 2 } : undefined;
};
const press = async (id, mods = []) => {
	const at = await middle(id);
	if (!at) return false;
	for (const key of mods) await page.keyboard.down(key);
	await page.mouse.click(at.x, at.y);
	for (const key of mods) await page.keyboard.up(key);
	return true;
};
const row = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const cameraName = async () => (await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).trim();
const toCanvas = async () => {
	await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
	await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
	await settle(page, 300);
};
const firstTitle = await cameraName();

say("a press on a link to a card opens the card as a tab, in front", (await press("to-card")) && JSON.stringify(await until(async () => ((await row()).includes("card*") ? row() : undefined))) === '["canvas","card*"]' && (await page.evaluate(() => location.hash)) === `#card/${plan}`, JSON.stringify(await row()));
await toCanvas();
say("pressed again it comes forward, and no second tab is made", (await press("to-card")) && JSON.stringify(await until(async () => ((await row()).includes("card*") ? row() : undefined))) === '["canvas","card*"]', JSON.stringify(await row()));
await toCanvas();

// --- with ⌘, the browser's tab ---------------------------------------------------------------------------------------
const popup = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => undefined);
await press("to-card", ["Meta"]);
const opened = await popup;
say("with ⌘ held the link opens the browser's tab, at this window's address with the card's after #", !!opened && opened.url().endsWith(`#card/${plan}`) && JSON.stringify(await row()) === '["canvas*","card"]', `${opened?.url()} ${JSON.stringify(await row())}`);
await opened?.close().catch(() => {});

// --- a link to nothing -----------------------------------------------------------------------------------------------
await press("to-gone");
const notice = await until(async () => {
	const text = await page.locator(".notice").allInnerTexts();
	return text.find((one) => /not in the deck any more/.test(one));
});
say("a link to a canvas that is not in the deck says so, and opens nothing", !!notice && JSON.stringify(await row()) === '["canvas*","card"]', notice ?? JSON.stringify(await page.locator(".notice").allInnerTexts()));

// --- a link to a canvas: another tab ---------------------------------------------------------------------------------
say("a press on a link to a canvas opens that canvas as another tab: the camera is on it, and the canvas left stays in the row", (await press("to-canvas")) && (await until(async () => ((await cameraName()) === "Tab two" ? true : undefined))) === true && JSON.stringify(await row()) === '["canvas","card","canvas*"]' && (await page.locator(".v3-topbar .tab-chip[data-tab]").first().innerText()).trim() === firstTitle, `${await cameraName()} ${JSON.stringify(await row())}`);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
