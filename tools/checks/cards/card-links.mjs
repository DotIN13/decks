/**
 * A card's links to its canvas's files: Open opens the file in a tab, Download saves it.
 *
 * A link in a card is read against the card's own address (`items/card-surface.tsx`, `followLink`), so
 * `../../files/questionnaire.html` is the file in the card's canvas's `files/`. Before, it was read against
 * the page the card is drawn in, and any `.html` link was taken for a board to open beside the card, so
 * both links said the board does not exist; and `download` was never honoured. Here: a card with the two
 * links, as an agent writes them; Open puts the file in a tab, and Download saves it under its name with
 * its words in it. (Links to other cards, other sites and missing cards are `board-links`.)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { API, asPerson, canvasFrame, cardFile, flyToCard, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
// The file, in the fixture canvas's own files/.
const files = `${dirname(dirname(dirname(await cardFile("plan"))))}/files`;
mkdirSync(files, { recursive: true });
writeFileSync(`${files}/questionnaire.html`, "<!doctype html><title>Questionnaire</title><h1>Questionnaire: part one</h1>");
const row = (attrs, text, i) => `<a ${attrs} style="position:absolute;left:0;right:0;top:${i * 50}%;height:50%;display:flex;align-items:center;font-size:28px">${text}</a>`;
const html = `<div style="position:relative;height:300px">${row('href="../../files/questionnaire.html" target="_blank"', "Open", 0)}${row('href="../../files/questionnaire.html" download', "Download", 1)}</div>`;
const made = await call("canvas.insert", [{ type: "card", title: "Files", html, width: 600, height: 300 }]);
const CARD = made.value?.card;
say("a card with an Open and a Download link to a file of its canvas", made.ok === true && !!CARD, JSON.stringify(made).slice(0, 200));

const { browser, context, page, errors } = await open({ width: 1500, height: 1000 });
const canvas = await canvasFrame(page);
const rectOf = (path) => canvas.evaluate((wanted) => (window.__decksProbes?.cards?.() ?? []).find((one) => one.path === wanted)?.rect.toJSON() ?? null, path);
const press = async (n) => {
	await flyToCard(page, CARD);
	await settle(page, 400);
	// Awake, with its page and its links, not still its picture.
	await canvas.waitForFunction((wanted) => [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted)?.dataset.state === "live", CARD, { timeout: 8000 }).catch(() => {});
	await settle(page, 300);
	const r = await rectOf(CARD);
	await page.mouse.click(r.x + r.width * 0.15 + 40, r.y + r.height * (n * 0.5 + 0.25));
};
const notices = () => page.evaluate(() => [...document.querySelectorAll(".notice, [role=status], .toast")].map((one) => one.textContent ?? "").join(" | "));

// --- Open ---
let opened = "";
let words = "";
try {
	const tabbed = context.waitForEvent("page", { timeout: 8000 });
	await press(0);
	const tab = await tabbed;
	await tab.waitForLoadState().catch(() => {});
	opened = tab.url();
	words = (await tab.textContent("h1").catch(() => "")) ?? "";
	await tab.close();
} catch (error) {
	opened = `no tab: ${String(error).split("\n")[0]}`;
}
say("Open puts the canvas's file in a tab of its own", /\/files\/questionnaire\.html/.test(opened) && /part one/.test(words), JSON.stringify({ opened, words }));
say("…and says nothing about a board that does not exist", !/does not exist|no such board/i.test(await notices()), await notices());

// --- Download ---
let saved = "";
try {
	const downloading = page.waitForEvent("download", { timeout: 8000 });
	await press(1);
	const download = await downloading;
	const to = `${files}/../downloaded.html`;
	await download.saveAs(to);
	saved = `${download.suggestedFilename()}: ${readFileSync(to, "utf8")}`;
} catch (error) {
	saved = `no download: ${String(error).split("\n")[0]}`;
}
say("Download saves the file under its name, with its words", saved.startsWith("questionnaire.html: ") && /part one/.test(saved), saved.slice(0, 160));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
