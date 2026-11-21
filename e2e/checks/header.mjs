/**
 * Off a phone the top of the window is one header across the canvas's column: the agent, the tabs and
 * the + at its left, who is here, Present and ⋯ at its right, and, with a card, a document or an app
 * in front, what that tab offers (Reload, On canvas, the browser's tab).
 *
 * - the header runs from the side panel to the window's edge, as tall as the band the two bars floated in,
 *   so the top inset and the tool column under it are where they were; the side panel is no part of it,
 *   and stays the full height of the window beside it;
 * - the agent in it is its face and its name, not its runtime;
 * - an app's tab is named by the app's title;
 * - Reload loads the tab's page again; a document has none;
 * - On canvas goes to where the item sits: an app's window (put on the canvas when it has none), a card;
 * - the browser's tab opens at this window's address with the tab's after #;
 * - an app and a document run to the foot of the window, under the composer;
 * - a phone keeps its own bar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, CANVAS, canvasFrame, card, deckState, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
const OUT = process.env.LOOK_SHOTS;

await resetStage();
const deck = await deckState();
await call("apps.create", ["e2e-head", { title: "Head count", starter: "static" }]);
const file = join(deck.path, "apps", "e2e-head", "index.html");

const view = { width: 1500, height: 950 };
const { browser, page, errors } = await open({ ...view, scheme: "light" });
await settle(page, 900);
const link = await socket();
const agentId = await until(async () => link.last("agent.list")?.focused);
const shot = async (name) => OUT && (await settle(page, 400), await page.screenshot({ path: `${OUT}/header-${name}.png` }));
const rect = (selector) => page.locator(selector).first().evaluate((one) => { const r = one.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });

// --- the header itself, with the canvas in front ---------------------------------------------------------------------------
const head = await rect(".v3-header");
const panel = await rect(".panel-shell");
const left = await rect(".v3-topbar");
const right = await rect(".v3-topright");
say("the header runs from the side panel's edge to the window's, at the top, 56 px tall", Math.abs(head.x - panel.right) < 1.5 && Math.abs(head.right - view.width) < 1 && head.y === 0 && head.h === 56, JSON.stringify({ head, panel: panel.right }));
// The side panel is no part of it: the full height of the window beside the header, its edge between the two from top to foot, and its own head.
const lpHead = await rect(".v3-lp-head");
const edge = await page.locator(".panel-shell.v3-panel").evaluate((one) => getComputedStyle(one).borderRightWidth);
say("the side panel stays the full height of the window, apart from the header: its edge runs between them, and its head is its own", panel.x === 0 && panel.y === 0 && Math.abs(panel.bottom - view.height) < 1 && edge === "1px" && lpHead.y === 0 && lpHead.right <= head.x + 0.5 && lpHead.h !== head.h, JSON.stringify({ panel, lpHead, edge }));
say("the tabs are at its left end and who is here at its right, both inside it", left.x >= head.x && left.bottom <= head.bottom && right.right <= head.right && right.bottom <= head.bottom && right.x > left.right, JSON.stringify({ left, right }));
const agent = await page.locator(".v3-topbar .v3-agent-chip").first().evaluate((one) => ({ words: one.innerText.trim(), name: one.querySelector(".v3-agent-name")?.textContent?.trim() }));
say("the agent in the header is its face and its name, not its runtime", Boolean(agent.name) && agent.words.split("\n").at(-1) === agent.name && !/claude|opencode|antigravity/i.test(agent.words), JSON.stringify(agent));
const flat = await page.locator(".v3-topbar, .v3-topright").evaluateAll((all) => all.map((one) => { const s = getComputedStyle(one); return `${s.boxShadow}|${s.backgroundColor}`; }));
say("neither is a pill any more: no shadow, no ground of its own", flat.every((one) => one === "none|rgba(0, 0, 0, 0)"), JSON.stringify(flat));
const inset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-top").trim());
const tools = await rect(".pen-tools.v3-tools");
say("the top inset is the header's height, and the tool column sits 12 px under it, as it sat under the pills", inset === "56px" && Math.abs(tools.y - 68) < 1, `${inset} ${tools.y}`);
say("with a canvas in front the header offers nothing for a tab", (await page.locator(".tab-acts").count()) === 0);
await shot("canvas-light");

// --- an app in front ---------------------------------------------------------------------------------------------------------
await call("view.open", ["e2e-head", { kind: "app" }]);
const appFrame = () => page.frames().find((one) => !one.isDetached() && one.url().includes("/e2e-head/") && /kind=app/.test(one.parentFrame()?.url() ?? ""));
const heading = async () => appFrame()?.locator("h1").textContent({ timeout: 800 }).catch(() => undefined);
say("the app opens in a tab", (await until(async () => ((await heading()) === "Head count" ? true : undefined))) === true, String(await heading()));
const chip = await until(async () => (await page.locator('.v3-topbar .tab-chip[data-front="true"]').innerText()).trim());
say("its tab is named by the app's title, not its folder", (await until(async () => ((await page.locator('.v3-topbar .tab-chip[data-front="true"]').innerText()).trim() === "Head count" ? true : undefined))) === true, String(chip));
const acts = await page.locator(".tab-acts [aria-label]").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
say("the header offers Reload, On canvas and the browser's tab", JSON.stringify(acts) === JSON.stringify(["Reload", "On canvas", "Open in the browser's tab"]), JSON.stringify(acts));
const surface = await rect('.surface[data-surface="app"]');
say("the app starts right under the header", Math.abs(surface.y - 56) < 1 && Math.abs(surface.x - panel.right) < 1.5, JSON.stringify(surface));
const appBox = await (await appFrame()?.frameElement())?.boundingBox();
say("…and runs to the foot of the window, under the composer, which can be put away", !!appBox && Math.abs(appBox.y + appBox.height - view.height) < 1, JSON.stringify(appBox));
await shot("app-light");

writeFileSync(file, readFileSync(file, "utf8").replace(/<h1>[^<]*<\/h1>/, "<h1>Counted again</h1>"));
await page.locator('.tab-acts [data-act="reload"]').click();
say("Reload loads the app's page again", (await until(async () => ((await heading()) === "Counted again" ? true : undefined))) === true, String(await heading()));

const popup = page.context().waitForEvent("page", { timeout: 6000 }).catch(() => undefined);
await page.locator('.tab-acts [data-act="browser"]').click();
const opened = await popup;
say("the browser's tab opens at this window's address with the app's after #", !!opened && opened.url().endsWith("#app/e2e-head"), String(opened?.url()));
await opened?.close().catch(() => {});

const windows = async () => ((await call("canvas.read", [{ canvas: CANVAS, depth: 0 }])).value?.items ?? []).filter((one) => one.metadata?.type === "decks.app" && one.metadata.name === "e2e-head");
say("the app has no window on the canvas yet", (await windows()).length === 0);
await page.locator('.tab-acts [data-act="canvas"]').click();
const onCanvas = async () => (await page.evaluate(() => location.hash)).startsWith("#canvas/") || (await page.evaluate(() => location.hash)) === "";
say("On canvas brings the canvas forward", (await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) && (await page.locator(".tab-acts").count()) === 0 ? true : undefined))) === true, await page.evaluate(() => location.hash));
const placed = await until(async () => ((await windows()).length === 1 ? (await windows())[0] : undefined));
say("…puts a window for the app there, since it had none", !!placed, JSON.stringify(placed ?? (await windows())));
const picked = await until(async () => ((await (await canvasFrame(page)).locator(".stage-fixed > .card-callout:not([data-hidden])").count()) === 1 ? true : undefined), 6000);
say("…and selects it: its pill is showing", picked === true);
await shot("app-on-canvas");
void onCanvas;

// --- a card in front -------------------------------------------------------------------------------------------------------
await page.keyboard.press("Escape");
await call("view.open", [card("plan")]);
await until(async () => ((await page.locator('.surface[data-surface="card"]:not([data-kept])').count()) === 1 ? true : undefined));
const cardActs = await until(async () => {
	const now = await page.locator(".tab-acts [aria-label]").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
	return now.length ? now : undefined;
});
say("a card's tab has the same three", JSON.stringify(cardActs) === JSON.stringify(["Reload", "On canvas", "Open in the browser's tab"]), JSON.stringify(cardActs));
await shot("card-light");
const cardFrames = () => page.frames().filter((one) => !one.isDetached() && /kind=card/.test(one.url())).length;
const before = page.frames().find((one) => !one.isDetached() && /kind=card/.test(one.url()));
await page.locator('.tab-acts [data-act="reload"]').click();
say("Reload makes the card's frame again", (await until(async () => (before?.isDetached() && cardFrames() >= 1 ? true : undefined))) === true, String(cardFrames()));
await page.locator('.tab-acts [data-act="canvas"]').click();
const selected = await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) && (await (await canvasFrame(page)).locator(`.card-node[data-path="${card("plan")}"][data-selected="true"]`).count()) === 1 ? true : undefined), 8000);
say("On canvas goes to the card's canvas with the card selected", selected === true);

// --- a document in front ---------------------------------------------------------------------------------------------------
const doc = `canvases/${CANVAS}/files/head-notes.md`;
await call("canvas.insert", [{ type: "document", path: doc }, { canvas: CANVAS, at: { x1: 6000, y1: 6000 } }]);
await call("view.open", [doc, { kind: "document" }]);
const docActs = await until(async () => {
	const now = await page.locator(".tab-acts [aria-label]").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
	return now.length && !now.includes("Reload") ? now : undefined;
});
say("a document's tab has On canvas and the browser's tab, and no Reload: it is edited live", JSON.stringify(docActs) === JSON.stringify(["On canvas", "Open in the browser's tab"]), JSON.stringify(docActs));
const docFoot = await until(async () => {
	for (const one of page.frames()) {
		if (one.isDetached()) continue;
		const found = await one.evaluate(() => {
			const tab = document.querySelector(".document-tab");
			const scroll = document.querySelector(".document-tab .dp-scroll");
			return tab && scroll ? { bottom: tab.getBoundingClientRect().bottom, window: innerHeight, pad: parseFloat(getComputedStyle(scroll).paddingBottom) } : undefined;
		}).catch(() => undefined);
		if (found) return found;
	}
	return undefined;
});
say("a document runs to the foot of the window too, and its last lines scroll clear of the composer", !!docFoot && docFoot.bottom === docFoot.window && docFoot.pad > 40, JSON.stringify(docFoot ?? page.frames().map((one) => one.url().slice(-40))));
await shot("document-light");
await page.locator('.tab-acts [data-act="canvas"]').click();
say("On canvas goes to the document's place and selects it", (await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) && (await (await canvasFrame(page)).locator('.card-node[data-path^="item:"][data-selected="true"]').count()) === 1 ? true : undefined), 8000)) === true);

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
void agentId;

// --- the same in the dark, for a person's eyes; an iPad; a phone ---------------------------------------------------------------
{
	const dark = await open({ ...view, scheme: "dark" });
	await settle(dark.page, 900);
	if (OUT) await dark.page.screenshot({ path: `${OUT}/header-canvas-dark.png` });
	await call("view.open", ["e2e-head", { kind: "app" }]);
	await settle(dark.page, 1500);
	if (OUT) await dark.page.screenshot({ path: `${OUT}/header-app-dark.png` });
	await dark.browser.close();
}
{
	const pad = await open({ device: "iPad Pro 11 landscape", scheme: "light" });
	await settle(pad.page, 1200);
	const padHead = await pad.page.locator(".v3-header").first().evaluate((one) => one.getBoundingClientRect().height).catch(() => 0);
	const padInset = await pad.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--inset-top").trim());
	say("an iPad has the header too, 64 px tall under a finger, and its top inset is that", padHead === 64 && padInset === "64px", `${padHead} ${padInset}`);
	if (OUT) await pad.page.screenshot({ path: `${OUT}/header-ipad.png` });
	await pad.browser.close();
}
{
	const phone = await open({ device: "iPhone 14 Pro", scheme: "light" });
	await settle(phone.page, 1200);
	say("a phone keeps its own bar: no header, no actions for a tab", (await phone.page.locator(".v3-header").count()) === 0 && (await phone.page.locator(".tab-acts").count()) === 0);
	if (OUT) await phone.page.screenshot({ path: `${OUT}/header-phone.png` });
	await phone.browser.close();
}
