/**
 * A link on a card, which is never just a navigation.
 *
 * A card is drawn in the canvas frame, in a root of its own, with no address bar and no back button,
 * so following a link inside it would replace the canvas. So a card asks instead, and this check is
 * the answers (boards are only pictures now, so the links are a card's):
 *
 * - a link to **another board in the deck** puts that board on the canvas, beside the card that
 *   linked to it, and brings it into view close enough to read;
 * - a link to **somewhere else** — another site, or a file in the deck that is not a board — opens
 *   in a tab of its own;
 * - a link to a board the deck does not have says so, and opens nothing.
 *
 * The card is still there, where it was, after each.
 */
import { API, asPerson, canvasFrame, flyToCard, open, rest, card as cardPath, resetStage, say, settle, socket, zoom } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
/* Four links, each a quarter of the card, so a press can find one by where it is: the card's root is closed. */
const row = (href, text, i) => `<a href="${href}" style="position:absolute;left:0;right:0;top:${i * 25}%;height:25%;display:flex;align-items:center;font-size:28px">${text}</a>`;
const html = `<div style="position:relative;height:400px">${row("../risks/index.html", "Risks", 0)}${row("https://example.com/elsewhere", "Elsewhere", 1)}${row("../../assets/sketch.svg", "Sketch", 2)}${row("../not-written-yet/index.html", "Nowhere", 3)}</div>`;
const made = await call("canvas.insert", [{ type: "card", title: "Links", html, width: 600, height: 400 }]);
const CARD = made.value?.card;
say("a card of links", made.ok === true && !!CARD, JSON.stringify(made).slice(0, 200));

const { browser, context, page, errors } = await open({ width: 1500, height: 1000 });
const LINKED = cardPath("risks");
const link = await socket();
// The linked board off the canvas first, so the link is what brings it back.
link.send({ type: "card.hide", path: LINKED });
const canvas = await canvasFrame(page);
const onCanvas = () => canvas.evaluate(() => (window.__decksCards?.() ?? []).map((one) => one.path));
await canvas.waitForFunction((path) => !(window.__decksCards?.() ?? []).some((one) => one.path === path), LINKED, { timeout: 8000 }).catch(() => {});
say("the linked board is off the canvas to begin with", !(await onCanvas()).includes(LINKED), (await onCanvas()).join(" "));

const rectOf = (path) => canvas.evaluate((wanted) => (window.__decksCards?.() ?? []).find((one) => one.path === wanted)?.rect.toJSON() ?? null, path);
/** The card framed, then its `n`th link pressed where it is on screen. */
const press = async (n) => {
	await flyToCard(page, CARD);
	await settle(page, 400);
	const r = await rectOf(CARD);
	await page.mouse.click(r.x + r.width * 0.15 + 40, r.y + r.height * (n * 0.25 + 0.125));
};

// --- a link to another board ---
await press(0);
await canvas.waitForFunction((path) => (window.__decksCards?.() ?? []).some((one) => one.path === path), LINKED, { timeout: 8000 }).catch(() => {});
say("a link to a board puts that board on the canvas", (await onCanvas()).includes(LINKED), (await onCanvas()).join(" "));
await rest(page).catch(() => {});
await settle(page, 1200);
const card = await rectOf(CARD);
const placed = await rectOf(LINKED);
const scale = (await zoom(page)) / 100;
const beside = !!card && !!placed && Math.abs(placed.x - (card.x + card.width + 32 * scale)) < 4 && Math.abs(placed.y - card.y) < 4;
say("…placed beside the card that linked to it", beside, JSON.stringify({ card, placed, scale }));
const view = page.viewportSize();
const seen = !!placed && placed.x < view.width && placed.y < view.height && placed.x + placed.width > 0 && placed.y + placed.height > 0;
say("…with the board it opened in view", seen, JSON.stringify(placed));
say("…and close enough to read", (await zoom(page)) >= 50, `${await zoom(page)}%`);

// --- links somewhere else ---
const tabFrom = async (n) => {
	const opened = context.waitForEvent("page", { timeout: 8000 });
	await press(n);
	const tab = await opened;
	await settle(page, 300);
	const url = tab.url();
	await tab.close();
	return url;
};
let external = "";
try {
	external = await tabFrom(1);
} catch (error) {
	external = `no tab: ${String(error).split("\n")[0]}`;
}
say("a link to another site opens in a tab", external.startsWith("https://example.com"), external);
let file = "";
try {
	file = await tabFrom(2);
} catch (error) {
	file = `no tab: ${String(error).split("\n")[0]}`;
}
say("a file that is not a board opens in a tab too", file.includes("sketch.svg"), file);

// --- a board link that leads nowhere ---
await press(3);
await settle(page, 900);
const notice = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((one) => one.textContent).join(" | "));
const appeared = (await onCanvas()).some((path) => path.includes("/not-written-yet"));
say("a board link the deck cannot open says so, and opens nothing", notice.includes("not-written-yet") && !appeared, notice || "(no notice)");
say("…and the card is still on the canvas", (await onCanvas()).includes(CARD));

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
