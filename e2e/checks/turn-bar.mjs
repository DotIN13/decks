/**
 * The turn spine: one block per turn, click to open the conversation around it.
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
	chatOpen: document.querySelector(".chat-float")?.dataset.open ?? "false",
	composerBusy: document.querySelector(".composer .send")?.dataset.busy,
}));
say("a turn appears on the spine", working.blocks === 1, `${working.blocks} block(s)`);
say("the live turn shows as running", sawRunning);
say("the conversation does not barge in", working.chatOpen === "false");
say("the send button is back to send", working.composerBusy === "false", `busy=${working.composerBusy}`);

await ask(page, "Now say the single word: omega");
await settle(page, 800);
const after = await page.evaluate(() => ({
	blocks: document.querySelectorAll(".turnbar .turn").length,
	unseen: document.querySelectorAll('.turnbar .turn[data-unseen="true"]').length,
}));
say("each turn is its own block", after.blocks === 2, `${after.blocks} blocks`);
say("turns you have not seen are marked", after.unseen >= 1, `${after.unseen} unseen`);

/*
 * A reply long enough that the history can actually scroll.
 *
 * Everything below is about *where* the history is scrolled to, and with three one-word turns
 * there is nowhere to be: "at the turn you clicked" and "at the bottom" are the same pixel,
 * and the assertions pass whatever the code does. That is not hypothetical — this check
 * asserted "opens around that turn rather than at the bottom" for a long time while the
 * feature was in fact landing at the bottom, because it could never scroll.
 *
 * It also has to come *before* the first click, and the history must not be opened in the
 * meantime: the defect below only reproduces on a jump that starts from the bottom of a long
 * transcript, which is the ordinary case and was the one nobody could measure.
 */
await ask(page, "Count from 1 to 60. Just the numbers, one per line, nothing else.");
await settle(page, 800);
say("three turns, three blocks", (await page.locator(".turnbar .turn").count()) === 3);

// Click the first block: the history comes out at that turn, not at the bottom.
await page.locator(".turnbar .turn").first().click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "true", null, { timeout: 8000 });
await settle(page, 900);
const opened = await page.evaluate(() => {
	const chat = document.querySelector(".chat-float");
	const stream = chat?.querySelector(".fsroll");
	const first = stream?.querySelector('.fbubble[data-who="user"]');
	const streamBox = stream?.getBoundingClientRect();
	const firstBox = first?.getBoundingClientRect();
	return {
		open: chat?.dataset.open,
		current: document.querySelectorAll('.turnbar .turn[data-current="true"]').length,
		offset: firstBox && streamBox ? Math.round(firstBox.top - streamBox.top) : null,
		overflow: stream ? Math.round(stream.scrollHeight - stream.clientHeight) : 0,
	};
});
say("clicking a block opens the conversation", opened.open === "true");
say("…marks that block as the one shown", opened.current === 1);
say("the transcript is taller than the history, so the rest means something", opened.overflow > 300, `${opened.overflow}px of overflow`);
say("…and opens around that turn rather than at the bottom", opened.offset !== null && Math.abs(opened.offset) < 80, `${opened.offset}px from the top`);

// The title bar's button is the way out now: the conversation is not summoned by proximity
// any more, so moving the cursor away leaves it exactly where it is, and the same control
// that opened it is what closes it.
await page.locator('.titlebar button[title="The conversation"]').click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "false", null, { timeout: 8000 });
say("the title bar's button puts it away again", true);
say("the marks clear once seen", (await page.evaluate(() => document.querySelectorAll('.turnbar .turn[data-unseen="true"]').length)) === 0);

/*
 * The jump happens once, not every time the history opens.
 *
 * `scrollTo` is not a one-shot: the spine reads it to mark which block you are looking at,
 * so `App` keeps it set and only clears it when the agent changes. The scrolling effect also
 * depended on `open` and on the item count, so every reopen — and every arriving message —
 * replayed the jump to a turn clicked long ago. Scrolling down was pointless, because the
 * next frame threw you back up, and that is what made the transcript unusable.
 */
const stream = () =>
	page.evaluate(() => {
		const box = document.querySelector(".chat-float .fsroll");
		if (!box) return null;
		return { top: Math.round(box.scrollTop), slack: Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) };
	});
const openColumn = async () => {
	await page.locator('.titlebar button[title="The conversation"]').click();
	await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "true", null, { timeout: 8000 });
	await settle(page, 700);
};
const closeColumn = async () => {
	await page.locator('.titlebar button[title="The conversation"]').click();
	await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "false", null, { timeout: 8000 });
};

await openColumn();
// Read to the end, the way somebody would after being dropped at an old turn.
await page.evaluate(() => {
	const box = document.querySelector(".chat-float .fsroll");
	if (box) box.scrollTop = box.scrollHeight;
});
await settle(page, 400);
say("you can scroll to the end from there", ((await stream())?.slack ?? 999) < 60, `${(await stream())?.slack}px from the bottom`);

await closeColumn();
await openColumn();
say("reopening does not drag you back to that turn", ((await stream())?.slack ?? 999) < 60, `${(await stream())?.slack}px from the bottom`);

await closeColumn();
await openColumn();
say("…and still does not, however many times it is opened", ((await stream())?.slack ?? 999) < 60, `${(await stream())?.slack}px from the bottom`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
