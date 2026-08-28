/**
 * The floating panels: away by default, out when reached for (DESIGN §7).
 *
 * The reveal is proximity-based, so these are the one place a short fixed wait is right —
 * what is being waited on is a CSS transition, which has a duration and no event worth
 * subscribing to.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();

const isOpen = (selector) => page.evaluate((s) => document.querySelector(s)?.dataset.open === "true", selector);
const onScreen = (selector) =>
	page.evaluate((s) => {
		const element = document.querySelector(s);
		if (!element) return null;
		const box = element.getBoundingClientRect();
		return {
			left: Math.round(box.left),
			right: Math.round(box.right),
			visibleWidth: Math.round(Math.min(box.right, innerWidth) - Math.max(box.left, 0)),
		};
	}, selector);

say("the agent list is away by default", (await isOpen(".side")) === false, JSON.stringify(await onScreen(".side")));
say("the chat is away by default", (await isOpen(".chat")) === false, JSON.stringify(await onScreen(".chat")));
const sliver = await onScreen(".side");
say("a sliver of the agent list is still visible", sliver.visibleWidth > 4 && sliver.visibleWidth < 40, `${sliver.visibleWidth}px showing`);

await page.mouse.move(6, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
say("reaching the left edge brings out the agent list", await isOpen(".side"));

await page.mouse.move(700, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "false", null, { timeout: 4000 });
say("moving away puts it back", (await isOpen(".side")) === false);

// The palette must not sit under the panel that appears when you reach for the edge.
await page.evaluate(() => document.querySelector(".rail-item")?.click());
await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });
const palette = await onScreen(".palette");
say("the palette sits clear of the agent list", palette.left > 220, JSON.stringify(palette));

// A closed panel takes no clicks, so each press reaches for the edge first — which is
// what a hand has to do too.
const pressPin = async () => {
	await page.mouse.move(6, 480);
	await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
	await page.locator(".chats .pin").click();
	await settle(page, 200);
};

await pressPin();
await page.mouse.move(900, 480);
await settle(page, 400);
say("a pinned panel stays when the cursor leaves", await isOpen(".side"));

await pressPin();
await page.mouse.move(900, 480);
await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "false", null, { timeout: 4000 });
say("unpinning lets it hide again", (await isOpen(".side")) === false);
say("the pin is remembered", (await page.evaluate(() => localStorage.getItem("decks.panel.left"))) === "away");

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
