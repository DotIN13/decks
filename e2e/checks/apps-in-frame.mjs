/**
 * An app placed on your own canvas runs inside the canvas frame, as a sandboxed iframe on the app pass in
 * its path (`server/src/routes/apps.ts`, `apps/route.ts`), and keeps what it saves in this browser through
 * `decks-storage.js`: the page keeps it, and the app reads it back after a reload.
 *
 * - the app item's body is the app itself, at `/app/t/<pass>/<name>/`, not the bar and Open alone;
 * - before the item is selected the app takes no pointer, and after it does;
 * - a press in the app saves through `localStorage`, which the page keeps under `decks.app:<name>:`;
 * - after a reload the app opens with what it saved;
 * - a made-up pass in the path is refused.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);
const link = await socket();
const deck = await deckState();
const agentId = await until(async () => link.last("agents")?.focused);
const stageName = await until(async () => link.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);

const made = await call("apps.create", ["e2e-counter", { title: "E2E counter", starter: "static" }]);
say("a static app is made from the starter, which asks for decks-storage.js", made.ok && /decks-storage\.js/.test(readFileSync(join(deck.path, "apps", "e2e-counter", "index.html"), "utf8")), JSON.stringify(made.error ?? ""));
const placed = await call("canvas.insert", [made.value?.item, { canvas: stageName, at: { x1: 0, y1: 0 } }]);
const id = placed.value?.id;
await call("view.focus", [id, { canvas: stageName }]);
await settle(page, 1200);

const appFrameOf = (on) => on.frames().find((one) => !one.isDetached() && one.url().includes("/app/t/") && one.url().includes("/e2e-counter/"));
const appFrame = () => appFrameOf(page);
const found = await until(async () => appFrame());
say("the app runs inside the canvas frame, on the pass in its path", !!found, page.frames().map((one) => one.url().slice(0, 80)).join(" | "));
const counted = await until(async () => (await appFrame()?.locator("#count").textContent())?.includes("Pressed 0"));
say("…and its page loads there, scripts and all", !!counted);

const canvas = await canvasFrame(page);
const takes = () => canvas.evaluate(() => getComputedStyle(document.querySelector(".app-surface-frame")).pointerEvents);
say("before it is selected the app takes no pointer, so a wheel over it pans the canvas", (await takes()) === "none", await takes());
// On screen first: an agent's view.focus waits while the canvas is in use, so the item may not be in view yet.
const frameBox = await page.locator("iframe.canvas-frame").boundingBox();
const inView = async () => {
	const box = await canvas.locator(".app-surface").boundingBox();
	return box && box.x >= 0 && box.y >= 0 && box.x + box.width <= frameBox.width && box.y + box.height <= frameBox.height ? box : undefined;
};
let box = await until(inView, 4000);
if (!box) {
	await call("view.focus", [id, { canvas: stageName }]);
	box = await until(inView, 6000);
}
box ??= await canvas.locator(".app-surface").boundingBox();
await page.mouse.click(frameBox.x + box.x + box.width / 2, frameBox.y + box.y + box.height * 0.6);
say("…selected, it takes the pointer", !!(await until(async () => (await takes()) === "auto")), await takes());

// Pressed by the app's own script: what is tested here is where its save goes, not where the pointer lands.
await appFrame()?.evaluate(() => {
	document.getElementById("press").click();
	document.getElementById("press").click();
});
const kept = await until(async () => (await page.evaluate(() => localStorage.getItem("decks.app:e2e-counter:count"))) === "2");
say("a press saves through localStorage, which the page keeps under the app's name", !!kept, String(await page.evaluate(() => localStorage.getItem("decks.app:e2e-counter:count"))));

// A second page of the same browser (the checks' own first page clears its storage at every load): the app opens there with what it saved.
const again = await page.context().newPage();
await again.goto(page.url());
await canvasFrame(again);
await call("view.focus", [id, { canvas: stageName }]);
const back = await until(async () => (await appFrameOf(again)?.locator("#count").textContent())?.includes("Pressed 2"));
say("opened again, the app has what it saved", !!back, String(await appFrameOf(again)?.locator("#count").textContent().catch(() => "")));
await again.close();

const wrong = await fetch(`${API}/app/t/dk_ap_e30.bm90LWEtcGFzcw/e2e-counter/`, { headers: { origin: "null", "sec-fetch-site": "cross-site" } });
say("a made-up pass in the path is refused", wrong.status === 401, String(wrong.status));

say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
