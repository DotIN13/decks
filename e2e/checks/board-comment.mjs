/**
 * A comment on words selected in a board.
 *
 * Words selected in a board's page offer a Comment button over them (`board.js` says what is
 * selected, `plain-board.tsx` draws the button); pressing it opens the popup, and a kept comment
 * goes over the input bar for the next message, with its words left marked in the page.
 */
import { flyToBoard, liveZoom, open, resetStage, say, settle, stagePath } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const { browser, page } = await open({ width: 1400, height: 900, boards: false });
await settle(page, 1200);
const path = await stagePath(page, "boards/plan.html");
await flyToBoard(page, path);
await liveZoom(page);
await settle(page, 800);

const frameSel = `iframe[data-path="${path}"]`;
const board = page.frameLocator(frameSel);
const words = board.locator("p, li, h1, h2").first();
await words.waitFor({ timeout: 10000 });
// Selected the way a reader does: a double-click on a word.
await words.dblclick({ position: { x: 14, y: 10 } });
const button = page.locator(".plain-board-comment");
const offered = await until(() => button.isVisible().catch(() => false));
say("selected words in a board offer a Comment button", offered);

if (offered) {
	await button.click();
	const popup = page.locator(".comment-popup");
	const opened = await until(() => popup.isVisible().catch(() => false));
	const quote = opened ? await popup.locator(".comment-quote").innerText().catch(() => "") : "";
	say("pressing it opens the popup on those words", opened && quote.trim().length > 0, quote);

	if (opened) {
		await popup.locator(".comment-field").fill("A note on these words");
		await page.keyboard.press("Enter");
		const kept = await until(async () => !(await popup.isVisible().catch(() => false)) && (await page.locator(".dock").innerText().catch(() => "")).includes(quote.trim().slice(0, 12)));
		say("kept, it goes over the input bar with the next message", kept);

		const marked = await until(() => page.frameLocator(frameSel).locator("body").evaluate(() => (globalThis.CSS?.highlights?.size ?? 0) > 0).catch(() => false));
		say("its words stay marked in the board", marked);
	}
}

await browser.close();
