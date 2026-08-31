/**
 * While a turn runs: the spine shows it, the composer offers stop, and the chat stays shut.
 *
 * Needs a model.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

// A fresh agent: whatever ran before may have left the focused one mid-conversation.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator('.chats .rail-head button[title="Start another agent"]').click();
await settle(page, 1200);
await page.mouse.move(800, 500);

await page.locator(".composer textarea").fill("Read boards/plan.html and say its title, nothing else.");
await page.locator(".composer textarea").press("Enter");

// Polled while the turn runs: both states have to be seen *during* it, not after.
let sawRunningBlock = false;
let sawBusyComposer = false;
for (let i = 0; i < 300; i += 1) {
	const now = await page.evaluate(() => ({
		running: document.querySelectorAll('.turnbar .turn[data-state="running"]').length,
		busy: document.querySelector(".composer .send")?.dataset.busy,
	}));
	if (now.running > 0) sawRunningBlock = true;
	if (now.busy === "true") sawBusyComposer = true;
	if (sawRunningBlock && sawBusyComposer) break;
	await settle(page, 100);
}
say("the live turn pulses on the spine while it runs", sawRunningBlock);
say("the send button turns into the stop button while working", sawBusyComposer);
say("and the chat still did not open itself", (await page.evaluate(() => document.querySelector(".chat")?.dataset.open)) === "false");

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
