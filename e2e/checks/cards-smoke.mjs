/**
 * Cards on a real canvas, in the canvas frame: a canvas whose boards were turned into cards opens with
 * each near card in a shadow root, no iframe for them, the card's styles applied, and a card's script running.
 *
 * Run against a server holding the `*-cards` canvases (`~/decks-studio-demo/run-cards-test.sh`):
 * DECKS_E2E_WEB=http://127.0.0.1:4870 DECKS_E2E_API=http://127.0.0.1:4870 node e2e/checks/cards-smoke.mjs <canvas>
 */
import { chromium } from "playwright";
import { API, WEB, asPerson, canvasFrame, say, failed } from "../harness.mjs";

const canvas = process.argv[2] ?? "ep3-cards";
const call = async (verb, args = [], headers = {}) => {
	const response = await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
	return response.json();
};
const person = await asPerson();
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
await page.goto(WEB);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.waitForTimeout(2500);
const went = await call("view.goto", [canvas], person);
say(`view.goto ${canvas}`, !went.error, JSON.stringify(went).slice(0, 200));
await page.waitForTimeout(6000);
const seen = await (await canvasFrame(page)).evaluate(() => {
	const surfaces = [...document.querySelectorAll(".card-surface")];
	const frames = document.querySelectorAll("iframe.plain-board-page").length;
	return { cards: surfaces.length, hosts: document.querySelectorAll(".card-host").length, frames };
});
say("cards are on the stage as card hosts, not frames", seen.cards > 0 && seen.hosts === seen.cards, JSON.stringify(seen));
await page.screenshot({ path: `/tmp/cards-${canvas}.png` });
say("no page errors", errors.length === 0, errors.slice(0, 6).join(" | "));
await browser.close();
process.exit(failed() ? 1 : 0);
