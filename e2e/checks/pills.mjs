/**
 * The pills: what each agent is doing, in the corner the list comes out of (DESIGN §7).
 *
 * The conversation is away by default, which is the point of the app — but "you should not
 * need the transcript" is not "you should never see a word of it". This is the glimpse.
 *
 * It used to float above the input bar and show the *focused* agent only, because that was
 * the one transcript the client was handed. Every rule below is inherited from it and one is
 * not: the pills stay while the conversation is open. That one was there because the two
 * shared the dock and said the same thing twice; they are on opposite edges now, and a pill
 * carries agents the conversation is not showing.
 */
import { ask, idle, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const pill = () =>
	page.evaluate(() => {
		const pill = document.querySelector(".pill");
		const body = document.querySelector(".pill .body");
		const bar = document.querySelector(".titlebar");
		const p = pill?.getBoundingClientRect();
		const b = bar?.getBoundingClientRect();
		return {
			present: Boolean(pill),
			text: body?.textContent ?? "",
			streaming: pill?.dataset.state,
			// Under the title bar, in the corner the panel comes out of.
			belowBarBy: p && b ? Math.round(p.top - b.bottom) : null,
			onTheLeft: p ? Math.round(p.left) : null,
			chatOpen: document.querySelector(".chat-float")?.dataset.open,
			// What is running now, on its own line under whatever was last said.
			working: Boolean(document.querySelector(".pill .working")),
			workingOn: document.querySelector(".pill .working span:nth-child(2)")?.textContent ?? "",
		};
	});

say("nothing floats there before anything is said", (await pill()).present === false);

await ask(page, "Say exactly: alpha bravo charlie. Nothing else, and use no tools.");
await settle(page, 800);

const after = await pill();
say("a pill appears for the agent that spoke", after.present, JSON.stringify(after.text.slice(0, 60)));
say("…in the corner the agent list comes out of", after.onTheLeft !== null && after.onTheLeft < 40, `${after.onTheLeft}px from the left`);
say("…level with where the panel's own top edge is", after.belowBarBy !== null && after.belowBarBy >= 0 && after.belowBarBy < 20, `${after.belowBarBy}px below the bar`);
say("…carrying what the agent actually said", /alpha bravo charlie/i.test(after.text), JSON.stringify(after.text.slice(0, 80)));
say("…and marked as finished, not streaming", after.streaming === "idle", `state=${after.streaming}`);
say("the conversation stayed away", after.chatOpen === "false");

// Clicking the words is how you get the whole thing.
await page.locator(".pill .body").click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "true", null, { timeout: 8000 });
say("clicking it opens the conversation", (await pill()).chatOpen === "true");
say("…and the pill stays, because it is not in the way of it", (await pill()).present === true, "opposite edges");

/*
 * Closed from the title bar, not by moving the cursor away.
 *
 * The conversation used to be a panel summoned by proximity to the right edge, so a mouse
 * move was enough to dismiss it. It is bubbles over the boards now, opened and closed
 * deliberately — which is the whole reason it can be scrolled and clicked in. The one
 * button does both: the column has no × of its own to compete with it.
 */
await page.locator('.titlebar button[title="The conversation"]').click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "false", null, { timeout: 8000 });
await settle(page, 400);
say("and it is still there with the conversation closed", (await pill()).present === true);

await page.locator(".pill .dismiss").click();
await settle(page, 300);
say("the dismiss button waves it away", (await pill()).present === false);

// A new reply is a new glimpse: dismissing one must not silence the next.
await ask(page, "Now say exactly: delta echo. Nothing else, and use no tools.");
await settle(page, 800);
const next = await pill();
say("the next reply shows even after dismissing the last", next.present && /delta echo/i.test(next.text), JSON.stringify(next.text.slice(0, 60)));

/*
 * What was said stays; what is happening goes underneath.
 *
 * The reply used to vanish the instant you sent the next message — the scan for it stopped at
 * the first user message it met — and vanish again for any turn that was all tool calls. So
 * the float went blank for the whole of a long turn, which is exactly when a person wants it,
 * and it went blank *because* work was happening, which read as the agent going quiet.
 */
const before = (await pill()).text;

/*
 * Watched, not polled.
 *
 * A file read is over in milliseconds: the first version of this polled every 100ms and never
 * once saw the tool in flight, though the transcript proved it had run. A `MutationObserver`
 * catches a line that exists for one frame, and records the body text *at that moment*, so
 * "the reply was still there while work was showing" is one observation rather than two
 * hopeful ones.
 */
await page.evaluate(() => {
	const watch = { saw: false, textAtWork: "", named: "" };
	window.__pillWatch = watch;
	const look = () => {
		const working = document.querySelector(".pill .working");
		if (!working || watch.saw) return;
		watch.saw = true;
		watch.textAtWork = document.querySelector(".pill .body")?.textContent ?? "";
		watch.named = working.querySelector("span:nth-child(2)")?.textContent ?? "";
	};
	new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
	look();
});

// Three reads rather than one, so there is more than one chance to be seen.
await page.locator(".composer textarea").fill("Read boards/plan.html, boards/risks.html and boards/sources.html, then give me the three titles on one line.");
await page.locator(".composer textarea").press("Enter");
await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy === "true", null, { timeout: 15000 });
await settle(page, 250);

const sending = await pill();
say("the last reply survives sending the next message", sending.present && sending.text === before, JSON.stringify(sending.text.slice(0, 40)));

await idle(page);
await settle(page, 800);

const watched = await page.evaluate(() => window.__pillWatch);
say("a running tool shows as a working line", watched.saw === true);
say("…naming the tool", watched.named.length > 0, JSON.stringify(watched.named));
say("…without displacing what was last said", watched.saw && watched.textAtWork === before, JSON.stringify(watched.textAtWork.slice(0, 40)));

const done = await pill();
say("the working line goes when the work does", done.working === false);
say("…and the text is the new reply", done.present && done.text !== before, JSON.stringify(done.text.slice(0, 50)));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
