/**
 * A walkthrough of the app's main journeys, in one sitting, the way a first session goes: open the
 * deck, find a card from the panel, ask an agent for something that makes it read and edit cards,
 * draw, zoom, fit, switch the scheme, and look back through the conversation. Each step is a
 * screen a person would recognise; the other checks each own one surface in depth.
 *
 * Needs an agent: the fake model does (`e2e/fake-model.mjs`). `WALKTHROUGH_SHOTS=<dir>` writes a
 * screenshot at each step, for looking at rather than asserting on.
 */
import { mkdirSync } from "node:fs";
import { ask, canvasFrame, card, cardFile, changed, focusCanvas, newAgent, open, openHistory, openPanel, read, resetStage, say, settle, zoom } from "../harness.mjs";

const OUT = process.env.WALKTHROUGH_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: `${OUT}/${name}.png` }) : Promise.resolve());

await resetStage();
const { browser, page, errors } = await open({ width: 1500, height: 950 });
let frame = await canvasFrame(page);
await settle(page, 1500);
await shot(page, "01-open");
const cardCount = await frame.evaluate(() => globalThis.__decksProbes?.cards?.().length ?? 0);
say("the app opens with the fixture's cards on the canvas", cardCount >= 3, `${cardCount} cards`);

// 1. the side panel: the Canvas tab lists the cards; a row glides to its card
await openPanel(page);
const rows = page.locator('.v3-item[data-kind="board"]');
const rowCount = await rows.count();
say("the side panel's Canvas tab lists the cards", rowCount >= 3, `${rowCount} rows`);
if (rowCount > 0) await rows.first().click();
await settle(page, 1200);
await shot(page, "02-panel-row-glide");
const zoomAfterRow = await zoom(page);
say("a row's click frames its card and the zoom pill follows", zoomAfterRow > 0, `${zoomAfterRow}%`);

// 2. a new agent, asked something that makes it use its tools
await newAgent(page);
await shot(page, "03-new-agent");
await ask(page, `Read each of ${card("plan")}, ${card("risks")} and ${card("sources")} with the read tool, one call each, then say 'done' and nothing else.`);
await openHistory(page);
await settle(page, 600);
await shot(page, "04-agent-turn");
const toolGroup = await page.locator(".stream .tool[data-group]").count();
const reply = await page.locator(".stream").innerText();
say("the agent's turn shows its tool calls collapsed to one row", toolGroup > 0, `${toolGroup} group(s)`);
say("…and its reply", /done/i.test(reply));

// 3. the agent edits a card's file, and the canvas shows the change
const file = await cardFile("plan");
const was = read(file);
await ask(page, `Add a sticky to ${card("plan")} with data-id 'walk' at left 1264px top 780px saying 'walkthrough'. Just do it, briefly.`);
const now = await changed(file, was, { timeout: 30000 }).catch(() => was);
await settle(page, 1500);
await shot(page, "05-agent-edit");
say("the agent's edit lands in the card's file", now.includes('data-id="walk"'));

// 4. drawing: the pen draws a stroke on the canvas
frame = await canvasFrame(page);
const pen = page.locator('.v3-tool[data-tool="pen"]:visible').first();
if (await pen.count()) await pen.click();
else await frame.locator('[data-tool="pen"]:visible').first().click().catch(() => {});
await frame.waitForSelector(".stage-ink", { timeout: 10000 }).catch(() => {});
const frameBox = await (await frame.frameElement()).boundingBox();
const r = await frame.evaluate(() => document.querySelector(".stage-ink")?.getBoundingClientRect().toJSON());
if (r && frameBox) {
	const x0 = frameBox.x + r.x + r.width * 0.45;
	const y0 = frameBox.y + r.y + r.height * 0.4;
	await page.mouse.move(x0, y0);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + i * 14, y0 + Math.sin(i / 2) * 20);
	await page.mouse.up();
}
await settle(page, 1500);
const inks = await frame.evaluate(() => [...(globalThis.__decksProbes?.rust?.placed?.values?.() ?? [])].filter((p) => p.node?.metadata?.type === "decks.ink").length).catch(() => 0);
await shot(page, "06-ink-stroke");
say("a pen stroke lands in the canvas's drawing", inks > 0, `${inks} stroke(s)`);
await page.keyboard.press("Escape");
const select = page.locator('.v3-tool[data-tool="select"]:visible').first();
if (await select.count()) await select.click();

// 5. zoom and fit
const zoomBefore = await zoom(page);
await (await canvasFrame(page)).locator('button[aria-label="Zoom in"]:visible').first().click().catch(() => {});
await settle(page, 900);
const zoomedIn = await zoom(page);
say("the zoom bar zooms in", zoomedIn > zoomBefore, `${zoomBefore}% → ${zoomedIn}%`);
await focusCanvas(page).catch(() => {});
await page.keyboard.press("0");
await settle(page, 1500);
await shot(page, "07-fit-all");
const fitted = await frame.evaluate(() => (globalThis.__decksProbes?.cards?.() ?? []).filter((c) => c.rect).every((c) => c.rect.left >= -2 && c.rect.right <= innerWidth + 2 && c.rect.top >= -2 && c.rect.bottom <= innerHeight + 2));
say("the 0 key fits every card on screen", fitted);

// 6. the scheme, switched the way a person does: the More menu's "Dark mode" row (the run opens dark)
await page.locator("button[aria-label='More']:visible").first().click().catch(() => {});
await settle(page, 400);
await shot(page, "08-more-menu");
await page.locator(".popover [data-row]", { hasText: "Dark mode" }).first().click().catch(() => page.keyboard.press("Escape"));
await settle(page, 900);
const light = {
	page: await page.evaluate(() => document.documentElement.getAttribute("data-color-scheme")),
	engine: await frame.evaluate(() => globalThis.__decksProbes?.rust?.scheme ?? null).catch(() => null),
};
await shot(page, "09-light");
say("the menu's Dark mode row switches the whole app, engine included", light.page === "light" && light.engine === "light", JSON.stringify(light));

// 7. the time machine: rewind the conversation
await openHistory(page);
await page.waitForSelector(".stream .stream-mine", { timeout: 8000 }).catch(() => {});
const acts = await page.locator(".stream .stream-mine").first().locator(".stream-act").count();
await shot(page, "10-time-machine");
say("each of your messages carries Rewind and Fork", acts === 2, `${acts} actions`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
