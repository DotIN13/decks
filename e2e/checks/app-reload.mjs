/**
 * An app's page loads again when it is told to: by an agent's `decks apps reload`, by the person's
 * Reload on a window's pill, and by Reload in the Apps tab.
 *
 * - a change to a static app's file shows nowhere by itself;
 * - `apps.reload` loads the page again in its window on the canvas and in its tab, both;
 * - the pill's Reload loads that window again, and that window alone;
 * - the Apps tab's ⋯ Reload does what the call does.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const view = { width: 1500, height: 1000 };
const { browser, page, errors } = await open(view);
await resetStage(page);
await settle(page, 900);
const link = await socket();
const deck = await deckState();
const agentId = await until(async () => link.last("agent.list")?.focused);
const stageName = await until(async () => link.last("canvas.list")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);

const made = await call("apps.create", ["e2e-reload", { title: "E2E reload", starter: "static" }]);
const file = join(deck.path, "apps", "e2e-reload", "index.html");
/** Change what the app's page says: its heading. */
const write = (heading) => writeFileSync(file, readFileSync(file, "utf8").replace(/<h1>[^<]*<\/h1>/, `<h1>${heading}</h1>`));

// Its window on the canvas, at 60%, right of the side panel.
const id = (await call("canvas.insert", [made.value?.item, { canvas: stageName, at: { x1: 4000, y1: 4000 } }])).value?.id;
const boxOf = async () => (await canvasFrame(page)).evaluate((path) => globalThis.__decksProbes?.cards?.().find((one) => one.path === path)?.rect.toJSON(), `item:${id}`);
const seen = async () => {
	const box = await boxOf();
	return box && Math.abs(box.width - 660) < 2 && box.x > 380 && box.y > 150 ? box : undefined;
};
await until(boxOf, 5000);
for (let tries = 0; tries < 4 && !(await seen()); tries++) {
	await fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()), "x-decks-agent": agentId }, body: JSON.stringify({ args: [{ x: 4550 - 300, y: 4380 - 60, zoom: 0.6 }] }) });
	await until(seen, 3000);
}
await settle(page, 700);
const box = await seen();

/** What the app's page says in each place it shows: its window on the canvas (the frame inside the canvas's), and its tab (inside an app frame). */
const headings = async () => {
	const out = {};
	for (const one of page.frames()) {
		if (one.isDetached() || !one.url().includes("/e2e-reload/")) continue;
		const where = /kind=canvas/.test(one.parentFrame()?.url() ?? "") ? "window" : "tab";
		out[where] = await one.locator("h1").textContent({ timeout: 800 }).catch(() => undefined);
	}
	return out;
};
const says = (want) =>
	until(async () => {
		const now = await headings();
		return now.window === want.window && now.tab === want.tab ? true : undefined;
	}, 8000);

say("the app's window is on the canvas, running", !!box && (await says({ window: "E2E reload" })) === true, JSON.stringify(await headings()));

// --- an agent's reload ---------------------------------------------------------------------------------------------------
write("Version 1");
await settle(page, 1200);
say("a change to a static app's file shows nowhere by itself", JSON.stringify(await headings()) === '{"window":"E2E reload"}', JSON.stringify(await headings()));
const reloaded = await call("apps.reload", ["e2e-reload"]);
say("apps.reload loads its window's page again", reloaded.ok && reloaded.value?.reloaded === "e2e-reload" && (await says({ window: "Version 1" })) === true, JSON.stringify([reloaded, await headings()]));

// Its tab too: opened, then back to the canvas, where the tab stays alive behind.
await call("view.open", ["e2e-reload", { kind: "app" }]);
say("the app opens as a tab as well", (await says({ window: "Version 1", tab: "Version 1" })) === true, JSON.stringify(await headings()));
write("Version 2");
await call("apps.reload", ["e2e-reload"]);
say("apps.reload loads it again in its window and in its tab, both", (await says({ window: "Version 2", tab: "Version 2" })) === true, JSON.stringify(await headings()));
await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
await settle(page, 500);

// --- the person's Reload, on the window's pill -----------------------------------------------------------------------------
write("Version 3");
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
const canvas = await canvasFrame(page);
await until(() => canvas.locator(".stage-fixed > .card-callout:not([data-hidden])").count());
await settle(page, 300);
await canvas.locator('.stage-fixed > .card-callout:not([data-hidden]) [aria-label="Reload"]').click();
say("the pill's Reload loads that window again, and that window alone", (await says({ window: "Version 3", tab: "Version 2" })) === true, JSON.stringify(await headings()));
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-pill-reload.png` });
say("…and the window is still selected, with its pill", (await canvas.locator(".stage-fixed > .card-callout:not([data-hidden])").count()) === 1);

// --- Reload in the Apps tab ------------------------------------------------------------------------------------------------
write("Version 4");
await page.locator(".panel-shell button", { hasText: /^Apps$/ }).first().click();
const row = page.locator(".v3-app-row", { hasText: "E2E reload" });
await until(() => row.count());
await row.locator(".v3-app-more").click();
await settle(page, 300);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/apps-tab-menu.png` });
const rows = await page.locator('[role="menuitem"] .row-label').allInnerTexts();
say("the Apps tab's ⋯ has Reload, and Delete…", rows.includes("Reload") && rows.includes("Delete…"), JSON.stringify(rows));
await page.locator('[role="menuitem"]', { hasText: /^Reload$/ }).click();
say("its Reload loads the app again everywhere it shows", (await says({ window: "Version 4", tab: "Version 4" })) === true, JSON.stringify(await headings()));

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
