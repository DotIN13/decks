/**
 * The board pill's actions, and its Comment.
 *
 * This check used to be about the Focus view (the canvas as one scrollable page, its exit button,
 * its header and its key). Commit 62f57b32 removed the Focus view, the title bars and in-board
 * editing on purpose, so everything that tested them is gone. What is left still applies: the pill
 * over a selected board offers exactly Fit, New tab, Comment and Hide, and its Comment opens a
 * focused box about the whole board whose Enter puts a pill over the composer.
 */
import { open, pressBoardAction, say, selectBoard, settle, stagePath } from "../harness.mjs";

// The panel opens on Canvas, where a board on the canvas has its row (`panel/LeftPanel.tsx`, `itemRow`).
const { browser, page, errors } = await open({ width: 1440, height: 1000, panelTab: "canvas" });

/* Its row in the panel's Canvas tab flies the camera to the board. */
await page.locator('.panel-shell [title^="What the survey round found"]').first().click();
await settle(page, 900);
const NOTES = await stagePath(page, "boards/notes.html");
const onCanvas = await page.locator(`.board-node[data-path="${NOTES}"]`).count();
say("the flow board is on the canvas", onCanvas === 1, `${onCanvas} node(s) at ${NOTES}`);

await selectBoard(page, NOTES);
const bar = await page.evaluate(() => [...document.querySelectorAll(".board-callout [role=menuitem], .bar-layer .chrome[data-selected] .acts > [data-act]:not([data-act=More])")].map((one) => one.dataset.act ?? one.getAttribute("aria-label") ?? ""));
say("the pill over the board offers fit, a tab, a comment and going away, in that order", bar.join(",") === "Fit,New tab,Comment,Hide", JSON.stringify(bar));

// Last, since it leaves a comment over the input bar: the pill's Comment opens the comment box straight away, on the whole board, and Enter keeps it for the next message.
await pressBoardAction(page, "Comment");
await page.waitForSelector(".comment-popup .comment-field", { timeout: 4000 });
const whole = await page.evaluate(() => ({ focused: document.activeElement?.classList.contains("comment-field") ?? false, about: document.querySelector(".comment-popup .comment-quote")?.textContent?.trim() ?? "" }));
say("the pill's Comment opens the box focused, about the whole board", whole.focused && whole.about.startsWith("On the whole board"), JSON.stringify(whole));
await page.keyboard.type("Shorter, please.");
await page.keyboard.press("Enter");
const chip = await page
	.waitForSelector('.composer-box [data-component="mention-pill"][data-kind="comment"]', { timeout: 4000 })
	.then((el) => el.textContent())
	.catch(() => null);
say("…and Enter puts it over the input bar, named by its board", chip?.trim() === NOTES.split("/").pop(), String(chip));
await page.evaluate(() => localStorage.removeItem("decks.comments"));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
