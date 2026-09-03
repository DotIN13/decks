/**
 * The one boards panel: two tabs, a button, and folded means gone.
 *
 * It replaced three surfaces — a floating context rail, a floating agents panel that could
 * not be open at the same time, and a full-screen browser over the canvas. The first two
 * being mutually exclusive in code and unrelated on screen is what this design calls a tab
 * strip with the strip left out, so the strip is the thing to assert.
 *
 * The other half is the camera. A panel *beside* the canvas declares `data-inset="left"`
 * and the camera subtracts it; a sheet *over* the canvas must not, because subtracting one
 * once fitted a 1600px board into the strip beside it at 3.7%. Both are checked, because
 * the difference is invisible until a fit goes wrong.
 */
import { open, say, zoom, ZOOM_IN_PAGE } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-left").trim());
	const mounted = () => page.locator("[data-inset='left']").count();

	say("the panel is up, and declares its width", (await mounted()) === 1 && (await inset()) === "276px", await inset());

	const tabs = await page.getByRole("tab").allTextContents();
	say("two tabs, context first because it is the canvas", tabs.length === 2 && /context/i.test(tabs[0]) && /deck/i.test(tabs[1]), tabs.join(" | "));
	say("no agents tab — a list you switch with is a selector", !tabs.some((t) => /agent/i.test(t)));

	// The Deck tab is where the full-screen browser went.
	await page.getByRole("tab", { name: /deck/i }).click();
	await page.waitForTimeout(200);
	const rows = await page.locator(".board-row").count();
	say("the deck tab lists every board", rows >= 4, String(rows));
	await page.locator('[data-inset="left"] input').fill("risk");
	await page.waitForTimeout(250);
	say("…and the field filters it", (await page.locator(".board-row").count()) === 1, String(await page.locator(".board-row").count()));
	await page.locator('[data-inset="left"] input').fill("");

	/*
	 * Folded means gone, and the camera is told.
	 *
	 * There is no 40px strip. It existed because a hover-summoned panel needed something to
	 * aim at, and a button is that something — so the panel draws nothing, which is also
	 * what makes the inset zero without anybody having to remember to say so.
	 */
	const toggle = page.locator('.pill button[aria-label$="the boards panel"]').first();
	await toggle.click();
	await page.waitForFunction(() => !document.querySelector("[data-inset='left']"), null, { timeout: 4000 });
	say("folded, the panel is not in the document at all", (await mounted()) === 0);
	say("…and the inset it declared goes with it", (await inset()) === "0px", await inset());
	say("no 40px strip left behind", (await page.locator(".panel-strip, .strip").count()) === 0);

	// ⌘K brings it back on the Deck tab with the cursor in the field: what the modal became.
	await page.keyboard.press("Meta+k");
	await page.waitForSelector("[data-inset='left']", { timeout: 4000 });
	const focused = await page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
	say("⌘K opens it on the deck tab with the cursor in the search field", /search/i.test(focused), focused);

	/*
	 * Under 1100px it is a sheet, and a sheet is not an inset.
	 *
	 * The camera check is the point: a fit that subtracts a surface covering the canvas
	 * frames the boards into the sliver beside it.
	 */
	await page.setViewportSize({ width: 900, height: 900 });
	await page.waitForTimeout(400);
	say("as a sheet it is still there", (await page.locator(".panel-shell, [data-sheet='true']").count()) >= 1);
	say("…but it declares no inset", (await mounted()) === 0 && (await inset()) === "0px", `${await mounted()} / ${await inset()}`);
	await page.keyboard.press("0");
	await page.waitForFunction(`${ZOOM_IN_PAGE} > 5`, null, { timeout: 6000 });
	say("…so fit still frames the deck at a workable zoom", (await zoom(page)) > 5, `${await zoom(page)}%`);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
