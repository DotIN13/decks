/**
 * Settings → Boards → Engine: the C++ engine or CanvasKit draws the stage, and changing it builds the
 * stage again at once, with no reload (`App.tsx`, `stageBuild`).
 */
import { open, resetStage, say, settle } from "../harness.mjs";
await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
const state = () => page.evaluate(() => ({ engineCanvas: !!document.querySelector(".stage[data-engine] canvas.stage-engine"), engine: globalThis.__decksEngine?.stats().backend ?? null, stored: localStorage.getItem("decks:stage-engine"), boards: document.querySelectorAll(".board-node").length }));
const openSettings = async () => {
	await page.locator('button[aria-label="More"], .pill button[aria-haspopup="menu"]').last().click().catch(() => {});
	await page.getByRole("menuitem", { name: "Settings" }).click().catch(async () => page.getByText("Settings", { exact: true }).first().click());
	await page.waitForSelector('[role="dialog"][aria-label="Settings"]', { timeout: 4000 });
};
await openSettings();
const row = await page.evaluate(() => { const g = document.querySelector('.set-engine'); return g ? [...g.querySelectorAll("button")].map((b) => `${b.textContent}:${b.getAttribute("aria-checked")}`) : null; });
say("Settings has an Engine row of four choices, Rust among them", row?.length === 4 && row.some((one) => one.startsWith("Rust:")), JSON.stringify(row));
const before = await state();
await page.locator('.set-engine button:has-text("On")').click();
await settle(page, 3000);
const on = await state();
await page.locator('.set-engine button:has-text("Off")').click();
await settle(page, 3000);
const off = await state();
await page.locator('.set-engine button:has-text("On")').click();
await settle(page, 3000);
const again = await state();
say("Engine On draws the stage with the engine", on.engineCanvas && !!on.engine && on.stored === "on", JSON.stringify(on));
say("Engine Off goes back to the sheet", !off.engineCanvas && off.stored === "off", JSON.stringify(off));
say("and On again brings it back", again.engineCanvas && !!again.engine, JSON.stringify({ before, again }));
say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
