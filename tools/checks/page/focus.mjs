/**
 * The board pill's actions, and its Comment.
 *
 * This check used to be about the Focus view (the canvas as one scrollable page, its exit button,
 * its header and its key). Commit 62f57b32 removed the Focus view, the title bars and in-board
 * editing on purpose, so everything that tested them is gone. What is left still applies: the pill
 * over a selected board offers exactly Fit, New tab, Comment, Hide and More (a menu of Export, Copy
 * path and Delete), and its Comment opens a
 * focused box about the whole board whose Enter puts a pill over the composer.
 */
import { canvasFrame, card, open, pressCardAction, say, selectCard, settle } from "../harness.mjs";

// The panel opens on Canvas, where a board on the canvas has its row (`panel/LeftPanel.tsx`, `itemRow`).
const { browser, page, errors } = await open({ width: 1440, height: 1000, panelTab: "canvas" });

/* Its row in the panel's Canvas tab flies the camera to the board. */
await page.locator('.panel-shell [title^="What the survey round found"]').first().click();
await settle(page, 900);
const NOTES = card("notes");
const canvas = await canvasFrame(page);
const onCanvas = await canvas.evaluate((path) => (window.__decksProbes?.cards?.() ?? []).filter((one) => one.path === path).length, NOTES);
say("the flow board is on the canvas", onCanvas === 1, `${onCanvas} at ${NOTES}`);

await selectCard(page, NOTES);
const bar = await canvas.evaluate(() => [...document.querySelectorAll(".card-callout [role=menuitem], .bar-layer .chrome[data-selected] .acts > [data-act]:not([data-act=More])")].map((one) => one.dataset.act ?? one.getAttribute("aria-label") ?? ""));
// Delete is there because the canvas frame can delete a card's or board's file (`frame/frame.tsx`, `onDeleteBoard`).
say("the pill over the board offers fit, a tab, a comment, hide and more, in that order", bar.join(",") === "Fit,New tab,Comment,Hide,More", JSON.stringify(bar));

// More opens the card's menu under the pill: the two exports, its path, and Delete; Escape shuts it and keeps the card selected.
await pressCardAction(page, "More");
const menu = await canvas.evaluate(() => [...document.querySelectorAll(".card-callout .callout-more [role=menuitem]")].map((one) => one.getAttribute("aria-label") ?? ""));
say("More opens a menu of Export as PNG, Export as PDF, Copy path and Delete", menu.join(",") === "Export as PNG,Export as PDF,Copy path,Delete", JSON.stringify(menu));
// It hangs down from the ⋯ button, whole on the screen.
await settle(page, 200);
const hang = await canvas.evaluate(() => {
	const pill = document.querySelector(".stage-fixed > .card-callout");
	const menu = pill?.querySelector(".callout-more");
	const more = pill?.querySelector('[aria-label="More"]');
	if (!pill || !menu || !more) return null;
	const [p, m, b] = [pill, menu, more].map((one) => one.getBoundingClientRect());
	const below = pill.dataset.below === "true";
	return { below, away: m.top >= p.bottom, under: Math.abs(m.left - (b.left - 4)) < 2, onScreen: m.left >= 0 && m.right <= innerWidth && m.top >= 0 && m.bottom <= innerHeight, pill: [Math.round(p.left), Math.round(p.top), Math.round(p.bottom)], menu: [Math.round(m.left), Math.round(m.top), Math.round(m.bottom)] };
});
say("the menu hangs down from ⋯, whole on the screen", !!hang && hang.away && hang.under && hang.onScreen, JSON.stringify(hang));
await page.keyboard.press("Escape");
const shut = await canvas.evaluate(() => ({ menu: !!document.querySelector(".card-callout .callout-more"), pill: !!document.querySelector(".stage-fixed > .card-callout") }));
say("Escape shuts the menu and leaves the card selected", !shut.menu && shut.pill, JSON.stringify(shut));
// Export as PNG downloads a picture of the card, taken on the server.
await pressCardAction(page, "More");
const download = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
await pressCardAction(page, "Export as PNG");
const saved = await download;
const file = saved ? await saved.path().catch(() => null) : null;
const bytes = file ? (await import("node:fs")).readFileSync(file) : null;
say("Export as PNG downloads a PNG of the card", !!bytes && bytes.length > 1000 && bytes.subarray(1, 4).toString() === "PNG", saved ? `${saved.suggestedFilename()} ${bytes?.length ?? 0} bytes` : "no download");

// Last, since it leaves a comment over the input bar: the pill's Comment opens the comment box straight away, on the whole board, and Enter keeps it for the next message.
await pressCardAction(page, "Comment");
// The page draws the box (`pageComments`), over the canvas frame, so its Send now is a press of yours.
await page.waitForSelector(".comment-popup", { timeout: 4000 });
const straight = await page.locator(".comment-popup .comment-field").isVisible().catch(() => false);
say("the pill's Comment opens the box straight away, not the small button", straight);
// Opened by its button when it did not, so the rest is still checked.
if (!straight) await page.locator(".comment-popup .comment-start").click().catch(() => {});
await page.waitForSelector(".comment-popup .comment-field", { timeout: 4000 });
const whole = await page.evaluate(() => ({ focused: document.activeElement?.classList.contains("comment-field") ?? false, about: document.querySelector(".comment-popup .comment-quote")?.textContent?.trim() ?? "" }));
say("the pill's Comment opens the box focused, about the whole board", whole.focused && whole.about.startsWith("On the whole card"), JSON.stringify(whole));
await page.keyboard.type("Shorter, please.");
await page.keyboard.press("Enter");
const chip = await page
	.waitForSelector('.composer-box [data-component="mention-pill"][data-kind="comment"]', { timeout: 4000 })
	.then((el) => el.evaluate((pill) => ({ text: pill.textContent?.trim() ?? "", from: pill.dataset.from ?? "", name: pill.dataset.mentionName ?? "" })))
	.catch(() => null);
// A comment from the canvas is as short as any comment's pill: the board's name, marked `data-from`, its note in its card.
say("…and Enter puts it over the input bar, named by its board", !!chip && chip.from === "canvas" && chip.text.length <= 30 && !chip.text.includes("Shorter") && chip.name !== "", JSON.stringify(chip));
await page.evaluate(() => localStorage.removeItem("decks.comments"));


say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
