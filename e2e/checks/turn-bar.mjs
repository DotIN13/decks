/**
 * The turn spine: one block per turn, click to open the chat around it.
 *
 * Needs a model: the blocks are turns.
 */
import { ask, idle, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

// A fresh agent, so the spine starts empty however much this deck has been talked to.
await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
await page.locator('.chats .rail-head button[title="Start another agent"]').click();
await settle(page, 1200);
await page.mouse.move(800, 500);
say("no spine before anything is said", (await page.locator(".turnbar .turn").count()) === 0);

// Polled, not sampled: a fast turn can be over before a single look, and a check that
// falls back to "well, it is idle now" is a check that never fails.
await page.locator(".composer textarea").fill("Say the single word: alpha");
await page.locator(".composer textarea").press("Enter");
let sawRunning = false;
for (let i = 0; i < 200 && !sawRunning; i += 1) {
	sawRunning = (await page.locator('.turnbar .turn[data-state="running"]').count()) > 0;
	if (!sawRunning) await settle(page, 100);
}
await idle(page);
await settle(page, 800);

const working = await page.evaluate(() => ({
	blocks: document.querySelectorAll(".turnbar .turn").length,
	chatOpen: document.querySelector(".chat")?.dataset.open,
	composerBusy: document.querySelector(".composer .send")?.dataset.busy,
}));
say("a turn appears on the spine", working.blocks === 1, `${working.blocks} block(s)`);
say("the live turn shows as running", sawRunning);
say("the chat does not barge in", working.chatOpen === "false");
say("the send button is back to send", working.composerBusy === "false", `busy=${working.composerBusy}`);

await ask(page, "Now say the single word: omega");
await settle(page, 800);
const after = await page.evaluate(() => ({
	blocks: document.querySelectorAll(".turnbar .turn").length,
	unseen: document.querySelectorAll('.turnbar .turn[data-unseen="true"]').length,
}));
say("each turn is its own block", after.blocks === 2, `${after.blocks} blocks`);
say("turns you have not seen are marked", after.unseen >= 1, `${after.unseen} unseen`);

// Click the first block: the panel comes out at that turn, not at the bottom.
await page.locator(".turnbar .turn").first().click();
await page.waitForFunction(() => document.querySelector(".chat")?.dataset.open === "true", null, { timeout: 8000 });
await settle(page, 600);
const opened = await page.evaluate(() => {
	const chat = document.querySelector(".chat");
	const stream = chat?.querySelector(".stream");
	const first = stream?.querySelector('.bubble[data-who="user"]');
	const streamBox = stream?.getBoundingClientRect();
	const firstBox = first?.getBoundingClientRect();
	return {
		open: chat?.dataset.open,
		current: document.querySelectorAll('.turnbar .turn[data-current="true"]').length,
		offset: firstBox && streamBox ? Math.round(firstBox.top - streamBox.top) : null,
	};
});
say("clicking a block opens the chat", opened.open === "true");
say("…marks that block as the one shown", opened.current === 1);
say("…and opens around that turn rather than at the bottom", opened.offset !== null && Math.abs(opened.offset) < 80, `${opened.offset}px from the top`);

await page.mouse.move(700, 500);
await page.waitForFunction(() => document.querySelector(".chat")?.dataset.open === "false", null, { timeout: 8000 });
say("moving away closes it again", true);
say("the marks clear once seen", (await page.evaluate(() => document.querySelectorAll('.turnbar .turn[data-unseen="true"]').length)) === 0);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
