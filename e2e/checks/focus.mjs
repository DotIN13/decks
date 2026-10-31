/**
 * The board pill's actions, and its Comment.
 *
 * This check used to be about the Focus view (the canvas as one scrollable page, its exit button,
 * its header and its key). Commit 62f57b32 removed the Focus view, the title bars and in-board
 * editing on purpose, so everything that tested them is gone. What is left still applies: the pill
 * over a selected board offers exactly Fit, New tab, Comment and Hide, and its Comment opens a
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
const onCanvas = await canvas.evaluate((path) => (window.__decksCards?.() ?? []).filter((one) => one.path === path).length, NOTES);
say("the flow board is on the canvas", onCanvas === 1, `${onCanvas} at ${NOTES}`);

await selectCard(page, NOTES);
const bar = await canvas.evaluate(() => [...document.querySelectorAll(".card-callout [role=menuitem], .bar-layer .chrome[data-selected] .acts > [data-act]:not([data-act=More])")].map((one) => one.dataset.act ?? one.getAttribute("aria-label") ?? ""));
// Delete is there because the canvas frame can delete a card's or board's file (`frame/frame.tsx`, `onDeleteBoard`).
say("the pill over the board offers fit, a tab, a comment, delete and going away, in that order", bar.join(",") === "Fit,New tab,Comment,Delete,Hide", JSON.stringify(bar));

// Last, since it leaves a comment over the input bar: the pill's Comment opens the comment box straight away, on the whole board, and Enter keeps it for the next message.
await pressCardAction(page, "Comment");
await canvas.waitForSelector(".comment-popup", { timeout: 4000 });
const straight = await canvas.locator(".comment-popup .comment-field").isVisible().catch(() => false);
say("the pill's Comment opens the box straight away, not the small button", straight);
// Opened by its button when it did not, so the rest is still checked.
if (!straight) await canvas.locator(".comment-popup .comment-start").click().catch(() => {});
await canvas.waitForSelector(".comment-popup .comment-field", { timeout: 4000 });
const whole = await canvas.evaluate(() => ({ focused: document.activeElement?.classList.contains("comment-field") ?? false, about: document.querySelector(".comment-popup .comment-quote")?.textContent?.trim() ?? "" }));
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
