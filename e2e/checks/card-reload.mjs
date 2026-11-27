/**
 * Reload on the pill's ⋯: a card loads again from its files, in this window, as a person presses it
 * (select the card, ⋯, Reload). The proof is the card mounted once more, after the press.
 */
import { canvasFrame, card, open, say, selectCard, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 950, scheme: "light", panelTab: "canvas" });
const canvas = await canvasFrame(page);
const NOTES = card("notes");

await page.locator('.panel-shell [title^="What the survey round found"]').first().click();
await settle(page, 900);
await selectCard(page, NOTES);
await settle(page, 700);

const pill = canvas.locator(".canvas-fixed > .card-callout:not([data-hidden])").first();
await pill.locator('[aria-label="More"]').click({ timeout: 4000 });
await settle(page, 150);
const items = (await pill.locator(".callout-more [role=menuitem]").allInnerTexts()).map((one) => one.trim());
say("⋯ holds Reload, first", items[0] === "Reload", JSON.stringify(items));

// A card drawn again from its files is mounted once more (`items/card-surface.tsx`, `made`).
const mounts = () => canvas.evaluate((path) => globalThis.__decksProbes?.made?.[path]?.mounts ?? -1, NOTES);
const before = await mounts();
await pill.locator('.callout-more [role=menuitem]:has-text("Reload")').click({ timeout: 4000 });
await settle(page, 1500);
say("Reload mounts the card once more", (await mounts()) === before + 1, `mounts ${before} -> ${await mounts()}`);
say("the menu closes after the press", (await canvas.locator(".callout-more").count()) === 0);
say("the card is still there", (await canvas.locator(`.card-node[data-path="${NOTES}"]`).count()) === 1);
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
