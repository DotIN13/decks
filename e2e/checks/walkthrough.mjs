/**
 * A walkthrough of the app's main journeys, in one sitting, the way a first session goes: open the
 * deck, find a board from the panel, ask an agent for something that makes it read and edit boards,
 * draw, zoom, fit, switch the scheme, and look back through the conversation. Each step is a
 * screen a person would recognise; the other checks each own one surface in depth.
 *
 * Needs an agent: the fake model does (`e2e/fake-model.mjs`). `WALKTHROUGH_SHOTS=<dir>` writes a
 * screenshot at each step, for looking at rather than asserting on.
 */
import { mkdirSync } from "node:fs";
import { ask, editMode, newAgent, open, openHistory, openPanel, resetStage, say, settle, socket } from "../harness.mjs";

const OUT = process.env.WALKTHROUGH_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: `${OUT}/${name}.png` }) : Promise.resolve());

await resetStage();
const { browser, page, errors } = await open({ width: 1500, height: 950 });
await shot(page, "01-open");
say("the app opens with the fixture's boards on the canvas", (await page.evaluate(() => window.__decksProbes?.boards?.().length ?? 0)) >= 3);

// 1. the side panel: canvas tab lists the boards; a row glides to a board
await openPanel(page);
const rows = await page.locator('.shell-item[data-kind="board"]').count();
say("the side panel's Canvas tab lists the boards", rows >= 3, `${rows} rows`);
await page.locator('.shell-item[data-kind="board"]').first().click();
await settle(page, 1200);
await shot(page, "02-panel-row-glide");
const zoomAfterRow = await page.evaluate(() => Number((document.querySelector(".shell-zoom-value")?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("a row's click frames its board and the zoom pill follows", zoomAfterRow > 0, `${zoomAfterRow}%`);

// 2. a new agent, asked something that makes it use its tools
await newAgent(page);
await shot(page, "03-new-agent");
await ask(page, "Read each of boards/plan.html, boards/risks.html and boards/sources.html with the read tool, one call each, then say 'done' and nothing else.");
await openHistory(page);
await settle(page, 600);
await shot(page, "04-agent-turn");
const toolGroup = await page.locator(".stream .tool[data-group]").count();
const reply = await page.locator(".stream").innerText();
say("the agent's turn shows its tool calls collapsed to one row", toolGroup > 0, `${toolGroup} group(s)`);
say("…and its reply", /done/i.test(reply));

// 3. the agent edits a board through its tools, and the canvas shows the new file
const link = await socket();
const agentId = await (async () => { for (let i = 0; i < 50; i++) { const f = link.last("agents")?.focused; if (f) return f; await new Promise((r) => setTimeout(r, 100)); } })();
const revBefore = link.received.filter((m) => m.type === "board" || m.type === "boards").length;
await ask(page, "Add a sticky to boards/plan.html with data-id 'walk' at left 1264px top 780px saying 'walkthrough'. Just do it, briefly.");
await settle(page, 1500);
const sticky = await page.evaluate(() => [...document.querySelectorAll(".board-node iframe")].some((f) => f.contentDocument?.querySelector('[data-id="walk"]')));
await shot(page, "05-agent-edit");
say("the agent's edit of a board file reaches the board on the canvas", sticky, `agent ${agentId}`);

// 4. drawing: the pen draws a stroke on the stage
await editMode(page, true).catch(() => {});
await page.click('.shell-tool[data-tool="pen"]').catch(() => {});
await page.waitForSelector(".stage-ink", { timeout: 10000 }).catch(() => {});
const r = await page.evaluate(() => document.querySelector(".stage-ink")?.getBoundingClientRect().toJSON());
if (r) {
	await page.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.4);
	await page.mouse.down();
	for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + r.width * 0.45 + i * 14, r.y + r.height * 0.4 + Math.sin(i / 2) * 20);
	await page.mouse.up();
}
await settle(page, 1500);
const inks = await page.evaluate(() => [...(window.__decksProbes?.rust?.placed?.values() ?? [])].filter((p) => p.node?.metadata?.type === "decks.ink").length);
await shot(page, "06-ink-stroke");
say("a pen stroke lands in the stage's drawing", inks > 0, `${inks} stroke(s)`);
await page.click('.shell-tool[data-tool="select"]').catch(() => {});

// 5. zoom and fit from the zoom bar
const rested = () => page.waitForFunction(() => { const d = document.querySelector(".stage")?.dataset ?? {}; return d.moving !== "true" && d.gliding !== "true"; }, null, { timeout: 8000 }).catch(() => {});
await rested();
const zoomBefore = await page.evaluate(() => Number((document.querySelector(".shell-zoom-value")?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
await page.locator('button[aria-label="Zoom in"]:visible').first().click();
await settle(page, 400);
await rested();
const zoomedIn = await page.evaluate(() => Number((document.querySelector(".shell-zoom-value")?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("the zoom bar zooms in", zoomedIn > zoomBefore, `${zoomBefore}% → ${zoomedIn}%`);
await page.keyboard.press("0");
await settle(page, 1200);
await shot(page, "07-fit-all");
const fitted = await page.evaluate(() => (window.__decksProbes?.boards?.() ?? []).every((b) => b.rect.left >= -2 && b.rect.right <= innerWidth + 2));
say("the 0 key fits every board on screen", fitted);

// 6. the dark scheme and the settings
await page.locator(".shell-topright button[aria-label='More']").first().click().catch(() => {});
await settle(page, 300);
await shot(page, "08-more-menu");
// The scheme, switched the way a person does: the menu's "Dark mode" row. The run opened dark, so this goes light.
await page.locator(".popover [data-row]", { hasText: "Dark mode" }).first().click().catch(() => page.keyboard.press("Escape"));
await settle(page, 600);
const light = await page.evaluate(() => ({ scheme: document.documentElement.getAttribute("data-color-scheme"), engine: window.__decksProbes?.rust?.scheme, tab: getComputedStyle(document.body).getPropertyValue("--ui-tab-on").trim() }));
await shot(page, "09-light");
say("the menu's Dark mode row switches the whole app, engine included", light.scheme === "light" && light.engine === "light" && light.tab === "#eaf1fe", JSON.stringify(light));

// 7. the time machine: rewind the conversation
await openHistory(page);
await page.waitForSelector(".stream .stream-mine", { timeout: 8000 }).catch(() => {});
const acts = await page.locator(".stream .stream-mine").first().locator(".stream-act").count();
await shot(page, "10-time-machine");
say("each of your messages carries Rewind and Fork", acts === 2, `${acts} actions`);

say("no page errors", errors.length === 0, errors.join(" | "));
link.close();
await browser.close();
