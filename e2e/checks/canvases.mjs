import { open, say, settle } from "../harness.mjs";

/*
 * Canvases under workspaces, on both surfaces.
 *
 * The dashboard's shelf and the panel's Canvases tab are fed one `canvases` frame with three
 * projects and two unfiled canvases, and asked the questions a reader would: are the headings
 * the projects, A to Z with No workspace last; are the cards newest first; does New canvas
 * on a heading make one *in that project*; does the card's menu move and remove; and does
 * the panel's tab do the same with a `+` and a × that asks twice. Nothing here needs an
 * agent: the frames are the server's word, and what is checked is what the browser sends
 * back.
 */

const SHOTS = process.env.DECKS_E2E_SHOTS;
const { browser, page, errors } = await open({ width: 1400, height: 980, scheme: "light" });

await page.addInitScript(() => {
	if (window.top !== window.self) return;
	const Real = window.WebSocket;
	window.__sent = [];
	window.WebSocket = class extends Real {
		constructor(...args) {
			super(...args);
			window.__ws = this;
			const send = this.send.bind(this);
			this.send = (data) => {
				window.__sent.push(String(data));
				return send(data);
			};
		}
	};
});
await page.reload({ waitUntil: "load" });
await settle(page, 2000);
/* The dashboard, where the shelf is. A press of New canvas really makes one and opens it, which
   moves the app to a stage and replaces the fed list, so this is where the check returns to. */
const home = async () => {
	await page.evaluate(() => { location.hash = "#/canvases"; });
	await settle(page, 600);
};
await home();

const feed = (message) => page.evaluate((text) => window.__ws.dispatchEvent(new MessageEvent("message", { data: text })), JSON.stringify(message));
const sent = async (type) => (await page.evaluate(() => window.__sent)).map((raw) => JSON.parse(raw)).filter((message) => message.type === type);
const clearSent = () => page.evaluate(() => { window.__sent = []; });

const now = Date.now();
const canvas = (id, name, ago, workspace, agents = []) => ({ id, name, ...(workspace ? { workspace } : {}), boards: [], links: [], groups: [], changedAt: now - ago, openedAt: now, agents });
const canvases = [
	canvas("cv_p1", "Bench surfaces", 1_000, "political-llm", ["a1"]),
	canvas("cv_p2", "Neutral image", 9_000, "political-llm"),
	canvas("cv_d1", "Decks", 3_000, "decks", ["a2"]),
	canvas("cv_d2", "Canvas camera", 2_000, "decks"),
	canvas("cv_c1", "Cross-interviewer", 5_000, "cross-interviewer"),
	canvas("cv_n1", "Tech Week", 4_000),
	canvas("cv_n2", "Scratch", 8_000),
];
await feed({ type: "agent.identity", id: "a1", identity: { name: "Iris", color: "#6b4fd8", workspace: "political-llm" } });
await feed({ type: "agent.identity", id: "a2", identity: { name: "Wren", color: "#d99a1a", workspace: "decks" } });
await feed({ type: "canvases", canvases });
await settle(page, 600);

// --- the dashboard's shelf ------------------------------------------------------------
const headings = await page.evaluate(() => [...document.querySelectorAll(".canvas-shelf .canvas-ws h2")].map((h) => h.textContent));
say("the shelf's headings are the workspaces, A to Z, No workspace last", JSON.stringify(headings) === JSON.stringify(["cross-interviewer", "decks", "political-llm", "No workspace"]), JSON.stringify(headings));
const decksCards = await page.evaluate(() => [...document.querySelectorAll('.canvas-ws[data-workspace="decks"] .canvas-card-name')].map((n) => n.textContent?.trim()));
say("…and a workspace's cards are newest change first", JSON.stringify(decksCards) === JSON.stringify(["Canvas camera", "Decks"]), JSON.stringify(decksCards));
const sub = await page.evaluate(() => document.querySelector('.canvas-ws[data-workspace="decks"] .canvas-ws-sub')?.textContent);
say("…the heading counts who is in the project and how many rooms it has", sub === "1 agent · 2 canvases", String(sub));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shelf.png`, clip: { x: 264, y: 0, width: 1136, height: 620 } });

await clearSent();
const slot = page.locator('.canvas-slot:has(.canvas-card[data-canvas-id="cv_d2"])');
await slot.locator(".canvas-more").click({ force: true });
await page.waitForSelector(".popover", { timeout: 5000 });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu.png`, clip: { x: 264, y: 0, width: 1136, height: 620 } });
await page.locator(".popover [data-row]", { hasText: "Move to workspace" }).click();
await settle(page, 200);
const offered = await page.evaluate(() => [...document.querySelectorAll(".popover .canvas-menu-move [data-row] .lb")].map((lb) => lb.textContent?.trim()));
say("the card's menu offers every workspace in use, and none", JSON.stringify(offered) === JSON.stringify(["cross-interviewer", "decks", "political-llm", "No workspace"]), JSON.stringify(offered));
await page.locator(".popover .canvas-menu-move [data-row]", { hasText: "political-llm" }).click();
await settle(page, 300);
let moved = await sent("canvas.workspace");
say("…and moving sends the canvas to that workspace", moved.length === 1 && moved[0].id === "cv_d2" && moved[0].workspace === "political-llm", JSON.stringify(moved));
say("…the menu closed on the choice", (await page.locator(".popover").count()) === 0);

await clearSent();
await slot.locator(".canvas-more").click({ force: true });
await page.waitForSelector(".popover", { timeout: 5000 });
await page.locator(".popover .canvas-menu-remove").click();
await settle(page, 200);
say("Remove asks once", (await sent("canvas.remove")).length === 0 && (await page.locator(".popover .canvas-menu-remove").textContent())?.includes("again"));
await page.locator(".popover .canvas-menu-remove").click();
await settle(page, 300);
let removed = await sent("canvas.remove");
say("…and removes on the second press", removed.length === 1 && removed[0].id === "cv_d2", JSON.stringify(removed));

// --- the panel's Canvases tab -----------------------------------------------------------
if (!(await page.evaluate(() => document.querySelector(".panel-shell")?.dataset.open === "true"))) {
	await page.locator('.pill button[aria-label$="the boards panel"]').first().click();
	await page.waitForFunction(() => document.querySelector(".panel-shell")?.dataset.open === "true", null, { timeout: 6000 });
	await settle(page, 300);
}
const tabs = await page.evaluate(() => [...document.querySelectorAll('.panel-shell [role="tab"]')].map((tab) => tab.textContent));
say("the panel's tabs are Canvases, Agents, Boards", JSON.stringify(tabs) === JSON.stringify(["Canvases", "Agents", "Boards"]), JSON.stringify(tabs));
await page.locator('.panel-shell [role="tab"]', { hasText: "Canvases" }).click();
await settle(page, 400);
const panelHeadings = await page.evaluate(() => [...document.querySelectorAll('.panel-list[data-tab="canvases"] .panel-meta > .truncate')].map((h) => h.textContent));
say("the tab has the same headings in the same order", JSON.stringify(panelHeadings) === JSON.stringify(["cross-interviewer", "decks", "political-llm", "No workspace"]), JSON.stringify(panelHeadings));
const rows = await page.evaluate(() => [...document.querySelectorAll('.panel-list[data-tab="canvases"] .canvas-row .nm')].map((n) => n.textContent));
say("…every canvas once, newest first inside a heading", JSON.stringify(rows) === JSON.stringify(["Cross-interviewer", "Canvas camera", "Decks", "Bench surfaces", "Neutral image", "Tech Week", "Scratch"]), JSON.stringify(rows));
const faces = await page.evaluate(() => document.querySelectorAll('.canvas-row[data-canvas-row="cv_p1"] .canvas-row-face').length);
say("…a row wears the faces of who is working there", faces === 1, `${faces} face`);
const foot = await page.locator(".panel-foot .truncate").textContent();
say("…and the foot counts them", foot?.trim() === "7 canvases", String(foot));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/tab.png`, clip: { x: 0, y: 0, width: 264, height: 620 } });

await clearSent();
const row = page.locator('.board-act:has(.canvas-row[data-canvas-row="cv_n2"])');
await row.hover();
await row.locator(".board-del").click({ force: true });
await settle(page, 200);
say("× on a row asks once", (await sent("canvas.remove")).length === 0 && (await row.locator(".board-del").getAttribute("data-armed")) === "true");
await row.locator(".board-del").click({ force: true });
await settle(page, 300);
removed = await sent("canvas.remove");
say("…and removes on the second press", removed.length === 1 && removed[0].id === "cv_n2", JSON.stringify(removed));

await page.locator('.panel-shell .field input').fill("camera");
await settle(page, 300);
const found = await page.evaluate(() => [...document.querySelectorAll('.panel-list[data-tab="canvases"] .canvas-row .nm')].map((n) => n.textContent));
say("the search narrows the tab and keeps the heading", JSON.stringify(found) === JSON.stringify(["Canvas camera"]), JSON.stringify(found));

// --- making canvases, which really makes them and moves the app onto them ----------------
await page.locator('.panel-shell .field input').fill("");
await settle(page, 200);
await clearSent();
await page.locator('.panel-list[data-tab="canvases"] .panel-meta button[aria-label="New canvas in political-llm"]').click();
await settle(page, 800);
let made = await sent("canvas.create");
say("+ on a heading makes a canvas in that workspace, named after it while that name is free", made.length === 1 && made[0].workspace === "political-llm" && made[0].name === "political-llm", JSON.stringify(made));
say("…and the app went to it", await page.evaluate(() => location.hash.startsWith("#/canvas/")), await page.evaluate(() => location.hash));

await home();
await feed({ type: "canvases", canvases });
await settle(page, 400);
await clearSent();
await page.locator('.canvas-ws[data-workspace="decks"] .canvas-new').click();
await settle(page, 800);
made = await sent("canvas.create");
say("New canvas on the shelf's heading makes one in that workspace too, numbered when a canvas already wears the project's name", made.length === 1 && made[0].workspace === "decks" && made[0].name === "Canvas 1", JSON.stringify(made));
say("…and the app went to that one as well", await page.evaluate(() => location.hash.startsWith("#/canvas/")), await page.evaluate(() => location.hash));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
