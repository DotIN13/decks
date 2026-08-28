/**
 * The dock: the last reply floating above the input bar (DESIGN §7).
 *
 * The chat column is away by default, which is the point of the app — but "you should not
 * need the transcript" is not "you should never see a word of it". This is the glimpse.
 */
import { ask, open, say, settle } from "../harness.mjs";

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
			chatOpen: document.querySelector(".chat")?.dataset.open,
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
say("the chat column stayed away", after.chatOpen === "false");

// Clicking it is how you get the whole thing.
await page.locator(".latest .body").click();
await page.waitForFunction(() => document.querySelector(".chat")?.dataset.open === "true", null, { timeout: 8000 });
say("clicking it opens the column", (await dock()).chatOpen === "true");
say("…and the glimpse gets out of the way", (await dock()).present === false, "no duplicate of the same text");

// Away again, then dismissed.
await page.mouse.move(700, 400);
await page.waitForFunction(() => document.querySelector(".chat")?.dataset.open === "false", null, { timeout: 8000 });
await settle(page, 400);
say("it comes back when the column closes", (await dock()).present === true);

await page.locator(".latest .dismiss").click();
await settle(page, 300);
say("the × waves it away", (await dock()).present === false);

// A new reply is a new glimpse: dismissing one must not silence the next.
await ask(page, "Now say exactly: delta echo. Nothing else, and use no tools.");
await settle(page, 800);
const next = await dock();
say("the next reply shows even after dismissing the last", next.present && /delta echo/i.test(next.text), JSON.stringify(next.text.slice(0, 60)));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
