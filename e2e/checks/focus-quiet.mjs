/**
 * A card an agent places and flies to does not open the properties panel (`frame/inside/events.ts`,
 * `selectCard`).
 *
 * An agent's `view focus` selects the card it flies to. It put the card in the drawing's own selection,
 * which is what the properties panel shows for, so every card an agent showed the person came with its
 * position, size and corners in a panel over the canvas; a press of the person's on a card never does
 * that, since it selects the card itself and nothing in the drawing. A focus, a row picked in the side
 * panel and a canvas opened again now select a card as a press does.
 *
 * What is checked: a new card placed and focused is the selected card, with nothing in the drawing's
 * selection and no properties panel on the page; a card picked from the side panel's list the same; a
 * press on a card the same, as before; and a drawn item selected still opens the panel.
 */
import { API, asPerson, canvasFrame, CANVAS, open, resetStage, rest, say, settle } from "../harness.mjs";

const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
const frame = await canvasFrame(page);
await rest(page);
const drawingSelection = async () => (await frame.evaluate(() => globalThis.__decksProbes?.frameTools?.() ?? {})).selection ?? [];
const selectedCards = () => frame.evaluate(() => [...document.querySelectorAll('.card-node[data-selected="true"]')].map((one) => one.getAttribute("data-path")));
const panel = () => page.locator(".props-panel").count();

// A new card, placed and then focused, as an agent shows its work.
const made = await call("canvas.insert", [{ type: "card", html: '<div class="doc"><h1>A new finding</h1></div>', title: "A new finding", width: 520, height: 300 }, { canvas: CANVAS, at: { x1: 1400, y1: -700 } }]);
const path = made.value?.card;
say("a new card is placed", made.ok === true && !!path, JSON.stringify(made).slice(0, 200));
await settle(page, 600);
const focused = await call("view.focus", [path]);
// Offered rather than moved when the canvas counts as in use: take the offer, as the person would.
const go = frame.getByRole("button", { name: "Go" });
if (await go.isVisible({ timeout: 1500 }).catch(() => false)) await go.click();
await rest(page);
const selected = await until(async () => (await selectedCards()).some((one) => path.endsWith(one)));
say("focused, the card is the selected card on the canvas", !!selected, JSON.stringify({ focused: focused.ok, cards: await selectedCards() }));
await settle(page, 600);
say("…as a press selects it: nothing in the drawing's selection, and no properties panel over it", (await drawingSelection()).length === 0 && (await panel()) === 0, JSON.stringify({ drawing: await drawingSelection(), panels: await panel() }));

// A press on a card, as it always was.
const box = await frame.evaluate((one) => {
	const r = document.querySelector(`.card-node[data-path$="${one}"]`)?.getBoundingClientRect();
	return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}, "a-new-finding/index.html");
if (box) await page.mouse.click(box.x, box.y);
await settle(page, 500);
say("a press on a card opens no properties panel, as before", (await panel()) === 0, JSON.stringify({ box, cards: await selectedCards(), panels: await panel() }));

// A card picked from the side panel's list.
await page.locator(".panel-shell [data-row]", { hasText: "Auth refresh — risks" }).first().click();
await rest(page);
const picked = await until(async () => (await selectedCards()).some((one) => one.includes("/risks/")));
say("a card picked in the side panel's list is the selected card, with no properties panel either", !!picked && (await drawingSelection()).length === 0 && (await panel()) === 0, JSON.stringify({ cards: await selectedCards(), drawing: await drawingSelection(), panels: await panel() }));

// A drawn item selected still opens it.
const note = await call("canvas.insert", [{ type: "note", id: "quiet-note", content: "A note of the drawing" }, { canvas: CANVAS, at: { x1: 1400, y1: -300 } }]);
await settle(page, 500);
await frame.evaluate(() => globalThis.__decksProbes.frameSelect(["quiet-note"]));
const opened = await until(async () => (await panel()) === 1, 4000);
say("a drawn item selected still opens its properties", note.ok === true && !!opened, JSON.stringify({ drawing: await drawingSelection(), panels: await panel() }));

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
