/**
 * An app whole, in a tab of its own: the app kind of the one frame (`@decks/frame`,
 * `@decks/canvas` `frame/app/`, `apps/web/src/tabs/kinds/app.tsx`).
 *
 * The pill's New tab on an app opens it as a tab of this window, where it opened the browser's. The
 * app runs in a frame inside the one frame, sandboxed, at an address with its app pass in the path
 * (`server/src/auth/passes.ts`, a window's): its page loads, it cannot reach the Decks page, what it
 * saves is kept by the page under the app's name, and it goes on running behind another tab.
 */
import { API, CANVAS, asPerson, canvasFrame, focusCanvas, open, pressCardAction, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

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
const made = await call("apps.create", ["tab-counter", { title: "Tab counter", starter: "static" }]);
const placed = await call("canvas.insert", [{ ...made.value?.item, id: "tab-app", width: 520, height: 380 }, { canvas: CANVAS, at: { x1: 200, y1: 1400 } }]);
say("an app on the canvas", made.ok === true && placed.ok === true, JSON.stringify(placed).slice(0, 200));

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const canvas = await canvasFrame(page);
await until(() => canvas.evaluate(() => !!globalThis.__decksProbes?.rust?.placed?.has("tab-app")));

// --- the pill's New tab opens the app as a tab of this window ------------------------------------------------
await focusCanvas(page);
await selectCard(page, "item:tab-app");
await pressCardAction(page, "Fit");
await rest(page);
const pagesBefore = page.context().pages().length;
await pressCardAction(page, "New tab");
const chip = page.locator('.tab-chip[data-kind="app"]');
// Named by the app's own title, which comes a moment after the tab when the deck's apps had not been read yet.
say("New tab on the app's pill opens it as a tab of this window, in front, named by the app's title", (await until(() => chip.count())) === 1 && (await chip.getAttribute("data-front")) === "true" && (await until(async () => ((await chip.innerText()).includes("Tab counter") ? true : undefined))) === true, await chip.innerText().catch(() => ""));
say("…and not the browser's tab", page.context().pages().length === pagesBefore);
const frameEl = page.locator('.surface[data-surface="app"] iframe.app-frame');
say("the app is in a frame of its own, sandboxed as the canvas's is", (await until(() => frameEl.count())) === 1 && !(await frameEl.getAttribute("sandbox")).includes("allow-same-origin") && (await frameEl.getAttribute("sandbox")) === (await page.locator("iframe.canvas-frame").getAttribute("sandbox")));
say("the canvas is out of sight, and its tools with it", !(await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await page.locator(".pen-tools").count()) === 0);

// The app's own page: the frame inside the tab's frame, told from the one on the canvas by what holds it.
const appFrame = async () => {
	for (const one of page.frames()) {
		if (one.isDetached() || !one.url().includes("/app/t/") || !one.url().includes("/tab-counter/")) continue;
		if (await one.parentFrame()?.evaluate(() => !!document.querySelector(".app-tab")).catch(() => false)) return one;
	}
	return undefined;
};
const counted = await until(async () => (await (await appFrame())?.locator("#count").textContent({ timeout: 1000 }))?.includes("Pressed 0"));
say("its page loads there, on the pass in its path, scripts and all", !!counted, page.frames().map((one) => one.url().slice(0, 60)).join(" | "));
const granted = await (await appFrame())?.evaluate(() => {
	let reachesPage = true;
	try {
		void top.document.body;
	} catch {
		reachesPage = false;
	}
	return { origin, reachesPage };
});
say("it keeps a blank origin and cannot reach the Decks page", granted?.origin === "null" && granted?.reachesPage === false, JSON.stringify(granted));
const box = await frameEl.boundingBox();
say("it fills the canvas's column, beside the side panel", !!box && box.x > 100 && box.width > 600 && box.height > 400, JSON.stringify(box));

// --- what it saves is the page's to keep ----------------------------------------------------------------------
await (await appFrame())?.evaluate(() => {
	document.getElementById("press").click();
	document.getElementById("press").click();
});
const kept = await until(async () => (await page.evaluate(() => localStorage.getItem("decks.app:tab-counter:count"))) === "2");
say("a press saves through localStorage, which the page keeps under the app's name", !!kept, String(await page.evaluate(() => localStorage.getItem("decks.app:tab-counter:count"))));

// --- behind another tab it goes on running --------------------------------------------------------------------
await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
say("the home chip brings the canvas forward, the app's tab still in the row", (await until(async () => ((await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await chip.getAttribute("data-front")) !== "true" ? true : undefined))) === true);
const behind = await (await appFrame())?.evaluate(() => {
	document.getElementById("press").click();
	return document.getElementById("count").textContent;
});
say("behind the canvas the app is still there, as it was, and still runs", /Pressed 3/.test(behind ?? ""), String(behind));
await chip.click();
say("brought forward again, it is the same page, not loaded anew", !!(await until(async () => ((await frameEl.isVisible()) && /Pressed 3/.test((await (await appFrame())?.locator("#count").textContent({ timeout: 1000 })) ?? "") ? true : undefined))));

// --- closed ------------------------------------------------------------------------------------------------------
await chip.locator(".tab-chip-close").click();
say("the ✕ closes it: its frame is gone, and the canvas is back with its tools", (await until(async () => ((await page.locator('.tab-chip[data-kind="app"]').count()) === 0 && (await frameEl.count()) === 0 && (await page.locator('.surface[data-surface="canvas"]').isVisible()) && (await page.locator(".pen-tools").count()) === 1 ? true : undefined))) === true);
await settle(page, 200);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
