/**
 * The input bar: three buttons inside the box, and the keyboard hints underneath it.
 *
 * The shape is borrowed from picone and the borrowing is the point — the controls live
 * *inside* the box because they change what the next turn does, and the hints live
 * *outside* it because they change nothing at all.
 *
 * The context dial used to be the other half of that second register, at the right end of
 * the hint row. It is in the corner's `⋯` now (`chrome/ContextSummary.tsx`), which is why
 * this file asserts its *absence* from the dock rather than its shape.
 *
 * Three native `<select>`s were the least Decks-like thing on screen, so their absence is
 * asserted rather than assumed: a regression here would look like nothing at all until
 * someone opened the app on a platform whose chevrons are ugly.
 */
import { open, say } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	say("no native dropdowns anywhere in the dock", (await page.locator(".dock select").count()) === 0);

	const shape = await page.evaluate(() => {
		const dock = document.querySelector(".dock");
		const box = dock?.querySelector(".dockbox");
		const hints = dock?.querySelector(".hintrow");
		const inBox = box ? [...box.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.title ?? "") : [];
		return {
			boxTop: box ? Math.round(box.getBoundingClientRect().y) : null,
			hintsTop: hints ? Math.round(hints.getBoundingClientRect().y) : null,
			inBox,
			hintsInBox: box && hints ? box.contains(hints) : null,
		};
	});
	say("the hint row is outside the box, and below it", shape.hintsInBox === false && shape.hintsTop > shape.boxTop, JSON.stringify(shape));
	say("the controls are inside the box", shape.inBox.length >= 2, JSON.stringify(shape.inBox));

	/*
	 * A long model name must not push the send button out of the bar.
	 *
	 * `.chipbtn` is `flex: none` in `chrome.css` — right for the corner's pill, which is
	 * `w-max`, and wrong for a fixed-width card with a model name in it. A name is whatever
	 * the runtime calls it, and `claude-opus-4-1-20250805-extended-thinking` made a 357px
	 * chip that pushed the send button 153px past the right edge of the box on a phone: the
	 * one control in the row that has to be reachable, off the screen.
	 *
	 * The label is written from here rather than switched through the picker, because the
	 * name has to be longer than any model this fixture has, and what is under test is the
	 * geometry rather than the runtime's catalogue. Restored afterwards, since every check
	 * after this one shares the page.
	 */
	const long = await page.evaluate(() => {
		// The last chip in the row is the model's. Not `:last-of-type`, which counts
		// *buttons* and so lands on send — the trap this line fell into once already.
		const label = [...document.querySelectorAll(".dockrow .chipbtn")].at(-1)?.querySelector("span:not(.sub)");
		const was = label.textContent;
		label.textContent = "claude-opus-4-1-20250805-extended-thinking-preview";
		const row = document.querySelector(".dockrow");
		const box = document.querySelector(".dockbox").getBoundingClientRect();
		const send = document.querySelector(".sendbtn").getBoundingClientRect();
		const chip = label.closest(".chipbtn").getBoundingClientRect();
		const out = {
			overflow: Math.round(row.scrollWidth - row.clientWidth),
			sendPastBox: Math.round(send.right - box.right),
			chip: Math.round(chip.width),
			clipped: label.clientWidth < label.scrollWidth,
		};
		label.textContent = was;
		return out;
	});
	say("a long model name does not overflow the row", long.overflow === 0, JSON.stringify(long));
	say("…and the send button stays inside the box", long.sendPastBox < 0, JSON.stringify(long));
	say("…the name is what gives, capped and ellipsised", long.chip <= 280 && long.clipped, JSON.stringify(long));

	// The dock is centred on the canvas column — the window minus the panels — rather than on
	// the window, so it is centred on what you are looking at instead of half under a panel.
	const centred = await page.evaluate(() => {
		const dock = document.querySelector(".dock").getBoundingClientRect();
		const left = Number(getComputedStyle(document.documentElement).getPropertyValue("--inset-left").replace("px", "")) || 0;
		const right = Number(getComputedStyle(document.documentElement).getPropertyValue("--inset-right").replace("px", "")) || 0;
		return { dockMid: Math.round(dock.x + dock.width / 2), columnMid: Math.round(left + (innerWidth - left - right) / 2) };
	});
	say("the dock is centred on the canvas column", Math.abs(centred.dockMid - centred.columnMid) <= 2, JSON.stringify(centred));

	/*
	 * And it paints over the conversation, which stops 8px above it and overlaps the moment a
	 * card is mid-slide or the window is short. The dock had no `z-index` at all, so a
	 * positioned element at 0 sat under a column at 9: the transcript covered the input bar.
	 */
	const stack = await page.evaluate(() => ({
		dock: Number(getComputedStyle(document.querySelector(".dock")).zIndex) || 0,
		stream: Number(getComputedStyle(document.querySelector(".stream")).zIndex) || 0,
	}));
	say("the input bar is above the conversation", stack.dock > stack.stream, JSON.stringify(stack));

	// The model picker: a chip that says the model, and a real popover behind it.
	const model = page.locator(".dockrow .chipbtn").last();
	await model.click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	const items = await page.locator(".popover [data-row]").count();
	say("the model chip opens a popover with the models in it", items >= 1, String(items));
	// One dismissal rule for all five popovers, and it is not "press the trigger again".
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);
	say("Escape dismisses it", (await page.locator(".popover").count()) === 0);

	/*
	 * The context reading is back in the dock — on a fine pointer.
	 *
	 * It was a ring and a percentage here; it moved to the corner's overflow on the argument
	 * that a reading nobody acts on does not belong in the place that is about the turn you
	 * are *about* to take. That was half right. On a phone there is genuinely no room under
	 * the box, and it stays in `⋯` there. On a desktop a reading you glance at twenty times
	 * an hour should not be behind a menu you have to open to take the glance.
	 *
	 * The reading-dependent half — the dial appearing, its popover, the `⋯` row and the modal
	 * on a touchscreen — is `context.mjs`, which drives a usage frame. What is checked here is
	 * the row's shape, which holds whether or not an agent has reported.
	 */
	const dialSlot = await page.evaluate(() => Boolean(document.querySelector(".hintrow")));
	say("the hint row is still there on a fine pointer", dialSlot, String(dialSlot));
	/*
	 * The hints, then a spacer, then the dial's own slot at the right end. Two children before
	 * an agent has reported anything: nothing is drawn for an unknown reading, because a ring
	 * at zero would claim the context is empty rather than unknown.
	 */
	const second = await page.evaluate(() => document.querySelector(".hintrow")?.children.length ?? -1);
	say("the hint row is the hints and the dial's slot", second === 2, String(second));

	// Ranked hints: whole phrases drop out as the bar narrows, because half a hint is worse
	// than none. The lowest-ranked one goes first.
	const wide = await page.locator(".hintrow .hint").count();
	await page.setViewportSize({ width: 440, height: 900 });
	await page.waitForTimeout(400);
	const narrow = await page.evaluate(() => [...document.querySelectorAll(".hintrow .hint")].filter((el) => getComputedStyle(el).display !== "none").length);
	say("the hints shed whole phrases as the bar narrows", narrow < wide, `${wide} -> ${narrow}`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
