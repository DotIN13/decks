/**
 * The dock: the last reply floating above the input bar (DESIGN §7).
 *
 * The conversation is away by default, which is the point of the app — but "you should not
 * need the transcript" is not "you should never see a word of it". This is the glimpse.
 */
import { ask, idle, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const dock = () =>
	page.evaluate(() => {
		const latest = document.querySelector(".latest");
		const body = document.querySelector(".latest .body");
		const composer = document.querySelector(".composer");
		const l = latest?.getBoundingClientRect();
		const c = composer?.getBoundingClientRect();
		return {
			present: Boolean(latest),
			text: body?.textContent ?? "",
			streaming: latest?.dataset.streaming,
			// Above the input bar, and close to it: one stack, not two floating things.
			aboveComposerBy: l && c ? Math.round(c.top - l.bottom) : null,
			insideDock: Boolean(document.querySelector(".dock .latest")),
			chatOpen: document.querySelector(".chat-float")?.dataset.open,
			// What is running now, on its own line under whatever was last said.
			working: Boolean(document.querySelector(".latest .working")),
			workingOn: document.querySelector(".latest .working .name")?.textContent ?? "",
		};
	});

say("nothing floats there before anything is said", (await dock()).present === false);

await ask(page, "Say exactly: alpha bravo charlie. Nothing else, and use no tools.");
await settle(page, 800);

const after = await dock();
say("the reply floats above the input bar", after.present, JSON.stringify(after.text.slice(0, 60)));
say("…in the dock, not loose over the canvas", after.insideDock);
say("…directly above it", after.aboveComposerBy !== null && after.aboveComposerBy >= 0 && after.aboveComposerBy < 24, `${after.aboveComposerBy}px`);
say("…carrying what the agent actually said", /alpha bravo charlie/i.test(after.text), JSON.stringify(after.text.slice(0, 80)));
say("…and marked as finished, not streaming", after.streaming === "false", `streaming=${after.streaming}`);
say("the conversation stayed away", after.chatOpen === "false");

// Clicking it is how you get the whole thing.
await page.locator(".latest .body").click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "true", null, { timeout: 8000 });
say("clicking it opens the conversation", (await dock()).chatOpen === "true");
say("…and the glimpse gets out of the way", (await dock()).present === false, "no duplicate of the same text");

/*
 * Closed on the ×, not by moving the cursor away.
 *
 * The conversation used to be a panel summoned by proximity to the right edge, so a mouse
 * move was enough to dismiss it. It is bubbles over the boards now, opened and closed
 * deliberately — which is the whole reason it can be scrolled and clicked in.
 */
await page.locator(".chat-float .fclose").click();
await page.waitForFunction(() => document.querySelector(".chat-float")?.dataset.open === "false", null, { timeout: 8000 });
await settle(page, 400);
say("it comes back when the conversation closes", (await dock()).present === true);

await page.locator(".latest .dismiss").click();
await settle(page, 300);
say("the dismiss button waves it away", (await dock()).present === false);

// A new reply is a new glimpse: dismissing one must not silence the next.
await ask(page, "Now say exactly: delta echo. Nothing else, and use no tools.");
await settle(page, 800);
const next = await dock();
say("the next reply shows even after dismissing the last", next.present && /delta echo/i.test(next.text), JSON.stringify(next.text.slice(0, 60)));

/*
 * What was said stays; what is happening goes underneath.
 *
 * The reply used to vanish the instant you sent the next message — the scan for it stopped at
 * the first user message it met — and vanish again for any turn that was all tool calls. So
 * the float went blank for the whole of a long turn, which is exactly when a person wants it,
 * and it went blank *because* work was happening, which read as the agent going quiet.
 */
const before = (await dock()).text;

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
	window.__dockWatch = watch;
	const look = () => {
		const working = document.querySelector(".latest .working");
		if (!working || watch.saw) return;
		watch.saw = true;
		watch.textAtWork = document.querySelector(".latest .body")?.textContent ?? "";
		watch.named = working.querySelector(".name")?.textContent ?? "";
	};
	new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
	look();
});

// Three reads rather than one, so there is more than one chance to be seen.
await page.locator(".composer textarea").fill("Read boards/plan.html, boards/risks.html and boards/sources.html, then give me the three titles on one line.");
await page.locator(".composer textarea").press("Enter");
await page.waitForFunction(() => document.querySelector(".composer .send")?.dataset.busy === "true", null, { timeout: 15000 });
await settle(page, 250);

const sending = await dock();
say("the last reply survives sending the next message", sending.present && sending.text === before, JSON.stringify(sending.text.slice(0, 40)));

await idle(page);
await settle(page, 800);

const watched = await page.evaluate(() => window.__dockWatch);
say("a running tool shows as a working line", watched.saw === true);
say("…naming the tool", watched.named.length > 0, JSON.stringify(watched.named));
say("…without displacing what was last said", watched.saw && watched.textAtWork === before, JSON.stringify(watched.textAtWork.slice(0, 40)));

const done = await dock();
say("the working line goes when the work does", done.working === false);
say("…and the text is the new reply", done.present && done.text !== before, JSON.stringify(done.text.slice(0, 50)));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
