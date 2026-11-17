/**
 * Tabs on a phone: the row folded into one chip, and the device's budget for what stays alive
 * (`apps/web/src/tabs/TabStrip.tsx`, `tabs/budget.ts`).
 *
 * A phone's bar has no room for a chip per tab: the tabs beside home are one chip with their count,
 * which opens them as a list, home first, each with its ✕. The + is there as on a desktop. And a phone
 * keeps no app running behind the tab in front: an app's tab left for another is put away, and comes
 * back with what it saved.
 */
import { API, asPerson, card, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
await call("apps.create", ["phone-app", { title: "Phone app", starter: "static" }]);

const { browser, page, errors } = await open({ device: "iPhone 14 Pro", scheme: "light" });
await rest(page, { start: 0 });
const view = page.viewportSize();
const fold = page.locator(".v3-topbar .tab-fold");
const plus = page.locator('.v3-topbar [aria-label="Open a tab"]');
const within = async (locator) => {
	const box = await locator.boundingBox();
	return !!box && box.x >= 0 && box.x + box.width <= view.width + 0.5 && box.width > 20;
};
say("alone, a phone's bar has the + and no chip for tabs", (await plus.count()) === 1 && (await within(plus)) && (await fold.count()) === 0);

// --- tabs open: one chip with their count ---------------------------------------------------------------------
const plan = card("plan");
await call("view.open", [plan]);
say("a tab opened shows as one chip with the count, washed while it is in front, on the screen with the +", (await until(() => fold.count())) === 1 && (await fold.innerText()).trim() === "1" && (await fold.getAttribute("data-front")) === "true" && (await within(fold)) && (await within(plus)) && (await page.locator(".tab-chip[data-kind]").count()) === 0, await fold.innerText().catch(() => ""));
say("the card fills the screen under the bar", (await until(() => page.locator('.surface[data-surface="card"] iframe.card-frame').count())) === 1);
// A card wider than the phone is fitted to its width, whole; a button shows it at its own size.
const inCard = async (run) => {
	for (const one of page.frames()) {
		if (one === page.mainFrame()) continue;
		if (await one.evaluate(() => !!document.querySelector(".card-tab")).catch(() => false)) return one.evaluate(run);
	}
	return undefined;
};
const cardAt = () => inCard(() => {
	const box = document.querySelector(".card-tab-card").getBoundingClientRect();
	return { left: box.left, right: box.right, window: innerWidth, scale: Number(document.querySelector(".card-tab").dataset.scale), button: document.querySelector(".card-tab-fit")?.textContent ?? null };
});
const fitted = await until(async () => {
	const at = await cardAt();
	return at && at.scale < 1 ? at : undefined;
});
say("a card wider than the phone is fitted to its width, with nothing cut off at the edge", !!fitted && fitted.left >= 0 && fitted.right <= fitted.window && /%$/.test(fitted.button ?? ""), JSON.stringify(fitted));
await inCard(() => document.querySelector(".card-tab-fit").click());
const full = await until(async () => {
	const at = await cardAt();
	return at && at.scale === 1 ? at : undefined;
});
say("…and its button shows it at its own size, wider than the window, and offers Fit", !!full && full.right > full.window && full.button === "Fit", JSON.stringify(full));
await inCard(() => document.querySelector(".card-tab-fit").click());
await call("view.open", ["phone-app"]);
await until(async () => ((await fold.innerText()).trim() === "2" ? true : undefined));
const appFrame = () => page.frames().find((one) => !one.isDetached() && one.url().includes("/app/t/") && one.url().includes("/phone-app/"));
const loaded = await until(async () => (await appFrame()?.locator("#count").textContent({ timeout: 1000 }))?.includes("Pressed 0"));
say("an app's tab loads on the phone", !!loaded && (await fold.innerText()).trim() === "2");
await appFrame()?.evaluate(() => {
	document.getElementById("press").click();
	document.getElementById("press").click();
});
await until(async () => (await page.evaluate(() => localStorage.getItem("decks.app:phone-app:count"))) === "2");

// --- the chip opens the tabs as a list --------------------------------------------------------------------------
await fold.tap();
const rows = page.locator(".tab-row");
// The list is placed a frame after it is made: read once its first row can be seen.
await until(async () => ((await rows.count()) === 3 && (await rows.nth(0).innerText()).includes("Home") ? true : undefined));
say("the chip opens the tabs as a list: home first, then each, the one in front marked", (await rows.count()) === 3 && (await rows.nth(0).innerText()).includes("Home") && (await rows.nth(1).getAttribute("data-kind")) === "card" && (await rows.nth(2).getAttribute("data-kind")) === "app" && (await rows.nth(2).getAttribute("data-current")) === "true", (await rows.allInnerTexts()).join(" | "));
await rows.nth(0).tap();
say("home picked comes forward, and the chip is no longer washed", (await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) && (await fold.getAttribute("data-front")) === null ? true : undefined))) === true);

// --- the side panel open: the bars and the tool row go aside with it, the + still there ---------------------------
await page.locator('.v3-topbar [aria-label="Show the side panel"]').first().tap();
const aside = await until(async () => {
	const panel = await page.locator(".panel-shell").boundingBox();
	const row = await page.locator(".frame-tool-row").boundingBox();
	const bar = await page.locator(".v3-topbar").boundingBox();
	return panel && row && bar && panel.width > 200 && Math.abs(row.x - bar.x) <= 2 && row.x >= panel.x + panel.width ? { panel: panel.width, row: row.x, bar: bar.x } : undefined;
}, 6000);
say("with the side panel open the canvas's tool row goes aside with the bars, not over the panel", !!aside, JSON.stringify(aside ?? { row: await page.locator(".frame-tool-row").boundingBox(), panel: await page.locator(".panel-shell").boundingBox() }));
await page.locator('.panel-shell [aria-label="Hide the side panel"]').first().tap();
await until(async () => (((await page.locator(".v3-topbar").boundingBox())?.x ?? 99) < 20 ? true : undefined));

// --- the budget: no app runs behind the front tab on a phone ----------------------------------------------------
say("behind home the app is put away: a phone keeps none running", (await until(async () => ((await page.locator("iframe.app-frame").count()) === 0 ? true : undefined))) === true && (await fold.innerText()).trim() === "2");
await fold.tap();
await page.locator('.tab-row[data-kind="app"]').tap();
const back = await until(async () => (await appFrame()?.locator("#count").textContent({ timeout: 1000 }))?.includes("Pressed 2"));
say("picked again it loads anew, with what it saved", !!back);

// --- closed from the list ------------------------------------------------------------------------------------------
await fold.tap();
await page.locator('.tab-row-line:has(.tab-row[data-kind="card"]) .tab-chip-close').tap();
say("a tab's ✕ in the list closes it", (await until(async () => ((await fold.innerText()).trim() === "1" ? true : undefined))) === true);
await page.keyboard.press("Escape");
await settle(page, 200);
if (process.env.DECKS_E2E_SHOT) await page.screenshot({ path: process.env.DECKS_E2E_SHOT });

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
