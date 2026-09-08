/**
 * The user's own Chrome, shared through the real Decks extension.
 *
 * This is the one hop the server's own test stands in for: `chrome.debugger`, inside a
 * Chromium that has the extension loaded. Everything else — the pairing code, the relay,
 * the status board, Stop — is the same code the unit test drives with a fake extension.
 *
 * The extension is driven from its service worker, through the `__decks` hooks it exposes
 * for exactly this: pair it with the server the harness is pointed at, share a tab holding
 * a small form, and watch the app's socket say the tab is connected. Then the status board
 * is asked for over the socket, opened on the canvas, and its own Stop button pressed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, boardReady, deckState, open, say, settle, socket, zoom } from "../harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "../../extension");
const FORM = `data:text/html,${encodeURIComponent("<!doctype html><title>Decks e2e form</title><label for=e>Email</label><input id=e><button>Go</button>")}`;

const link = await socket();
const until = async (what, check, ms = 20000) => {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 100));
	}
};
await until("the greeting's web.status", () => link.last("web.status")?.code);
const code = link.last("web.status").code;
say("the greeting carries the shared browser's status and the pairing code", typeof code === "string" && code.length >= 8 && link.last("web.status").status.connected === false, `code ${code}`);

// A Chromium of the user's own, with the extension loaded — a persistent context, which is
// the only kind Chrome loads extensions into.
const profile = mkdtempSync(join(tmpdir(), "decks-e2e-chrome-"));
const user = await chromium.launchPersistentContext(profile, {
	channel: "chromium",
	headless: true,
	args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
let worker = user.serviceWorkers()[0];
if (!worker) worker = await user.waitForEvent("serviceworker", { timeout: 15000 });
await worker.evaluate(() => new Promise((r) => setTimeout(r, 300)));

const paired = await worker.evaluate(async ({ address, code }) => {
	await globalThis.__decks.pair(address, code);
	return globalThis.__decks.status();
}, { address: API, code });
say("the extension pairs with the server's address and code", paired.paired === true && paired.connected === false, JSON.stringify(paired));

const tab = await user.newPage();
await tab.goto(FORM);
const tabId = await worker.evaluate(async () => {
	const tabs = await chrome.tabs.query({});
	return tabs.find((t) => t.title === "Decks e2e form")?.id ?? null;
});
say("the worker sees the tab to share", typeof tabId === "number", `tab ${tabId}`);

const shared = await worker.evaluate((id) => globalThis.__decks.share(id), tabId);
say("sharing attaches the debugger and opens the socket to the server", shared.connected === true && shared.tabs.length === 1, JSON.stringify(shared));

await until("the app to hear the tab is connected", () => link.last("web.status")?.status.connected === true);
const status = link.last("web.status").status;
say("the app's socket says the tab is connected, by title and address", status.tab?.title === "Decks e2e form" && status.tab?.url.startsWith("data:text/html"), JSON.stringify(status.tab));

// The tab is in a blue "Decks" group in the user's Chrome.
const groups = await worker.evaluate(async () => {
	const groups = await chrome.tabGroups.query({});
	return groups.map((g) => ({ title: g.title, color: g.color }));
});
say("the shared tab sits in a group called Decks", groups.some((g) => g.title === "Decks" && g.color === "blue"), JSON.stringify(groups));

// The status board, from the app's socket, on the canvas.
const { browser, page, errors } = await open({ width: 1400, height: 900 });
link.send({ type: "web.board" });
await until("the board to exist", () => link.received.some((m) => m.type === "board.changed" && m.path === "boards/your-chrome.html"));
await boardReady(page, "boards/your-chrome.html").catch(() => {});
await settle(page, 1500);
const card = page.frameLocator('.board-node[data-path="boards/your-chrome.html"] iframe').locator(".live.web");
const cardText = await card.textContent().catch(() => "");
say("the status board draws the shared tab, connected", /connected/.test(cardText) && /Decks e2e form/.test(cardText), cardText.slice(0, 120));

// Stop, from the board itself. Make it the only board on the canvas and fit the camera to
// it first: below half zoom a board takes no pointer events, and a click that lands on the
// canvas behind the button is not a press.
for (const board of (await deckState()).boards) {
	if (board.path !== "boards/your-chrome.html") link.send({ type: "board.hide", path: board.path });
}
await settle(page, 600);
await page.locator('[aria-label="Fit the boards on the canvas"]').first().click();
await settle(page, 900);
say("zoomed in far enough for the board to take a click", (await zoom(page)) >= 50, `${await zoom(page)}%`);
await card.locator("button.web-stop").click();
await until("the app to hear the stop", () => link.last("web.status")?.status.connected === false && link.last("web.status")?.status.closed === "stopped from the deck");
const after = await worker.evaluate(() => globalThis.__decks.status());
say("Stop on the board detaches: the app says why, and the extension shows nothing shared", after.connected === false && after.wanted === null, JSON.stringify(after));
await settle(page, 600);
const cardAfter = await card.textContent().catch(() => "");
say("the card now says not connected, and why", /not connected/.test(cardAfter) && /stopped from the deck/.test(cardAfter), cardAfter.slice(0, 160));

// A wrong code is refused at the upgrade, before any command.
const refused = await new Promise((resolveIt) => {
	const ws = new WebSocket(`${API.replace("http", "ws")}/api/web/relay?code=wrong`);
	ws.onopen = () => resolveIt("open");
	ws.onerror = () => resolveIt("refused");
	ws.onclose = () => resolveIt("refused");
});
say("a socket with the wrong code is refused", refused === "refused", refused);

say("no page errors", errors.length === 0, errors.join("; "));

link.send({ type: "board.delete", path: "boards/your-chrome.html" });
await settle(page, 300);
link.close();
await user.close();
await browser.close();
rmSync(profile, { recursive: true, force: true });
