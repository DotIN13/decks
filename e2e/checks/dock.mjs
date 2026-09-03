/**
 * The input bar: three buttons inside the box, and what the turn cost underneath it.
 *
 * The shape is borrowed from picone and the borrowing is the point — the controls live
 * *inside* the box because they change what the next turn does, and the hints and the
 * context dial live *outside* it because they report on the turn you already have.
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

	// The dock is centred on the canvas column — the window minus the panels — rather than on
	// the window, so it is centred on what you are looking at instead of half under a panel.
	const centred = await page.evaluate(() => {
		const dock = document.querySelector(".dock").getBoundingClientRect();
		const left = Number(getComputedStyle(document.documentElement).getPropertyValue("--inset-left").replace("px", "")) || 0;
		const right = Number(getComputedStyle(document.documentElement).getPropertyValue("--inset-right").replace("px", "")) || 0;
		return { dockMid: Math.round(dock.x + dock.width / 2), columnMid: Math.round(left + (innerWidth - left - right) / 2) };
	});
	say("the dock is centred on the canvas column", Math.abs(centred.dockMid - centred.columnMid) <= 2, JSON.stringify(centred));

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
	 * The dial draws nothing while the app cannot say how full the context is — the window
	 * right after a compaction, and before the first turn. A ring at zero would read as an
	 * empty context rather than an unknown one, which is a different and much better fact.
	 */
	const dial = await page.locator(".dock .context-dial, .dock [aria-label*='context' i]").count();
	say("no dial before there is a reading to show", dial === 0, String(dial));

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
