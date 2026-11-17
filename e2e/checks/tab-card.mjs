/**
 * A card whole, in a tab of its own: the card kind of the one frame (`@decks/frame`,
 * `@decks/canvas` `frame/card/`, `apps/web/src/tabs/kinds/card.tsx`).
 *
 * The pill's New tab on a card opens it as a tab of this window, where it opened the browser's. The
 * card runs in a sandboxed frame, as on its canvas, with the same carrier for its calls: its button,
 * which adds a note to its canvas through `card.decks`, works there, where a card on a page of its own
 * could call nothing. Its file changed shows in the tab. With ⌘ held the pill opens the browser's
 * tab, on Decks at the card's address; the canvas is as it was left when the tab is closed.
 */
import { API, CANVAS, asPerson, canvasFrame, deckState, flyToCard, focusCanvas, open, pressCardAction, resetStage, rest, say, selectCard, settle } from "../harness.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const html = (words) => `<h1>${words}</h1><p>A card with a button of its own.</p><button type="button" id="add">Add a note</button><p id="said"></p>
<script type="module">
	export default function (card) {
		card.root.getElementById("add").addEventListener("click", async () => {
			const said = card.root.getElementById("said");
			try {
				const made = await card.decks.canvas.insert({ type: "note", content: "from the card's tab" });
				said.textContent = "added " + made.id;
			} catch (error) {
				said.textContent = "refused: " + (error?.message ?? error);
			}
		}, { signal: card.signal });
	}
</script>`;
const made = await call("canvas.insert", [{ type: "card", title: "Button card", html: html("In a tab of its own"), width: 560, height: 320 }]);
const path = made.value?.card;
say("a card with a button that calls Decks", made.ok === true && !!path, JSON.stringify(made).slice(0, 200));
const notes = async () => (((await call("canvas.read", [{ canvas: CANVAS }])).value?.items ?? []).filter((one) => one.type === "note" && one.content === "from the card's tab")).length;

const { browser, page, errors, context } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
await flyToCard(page, path);
await settle(page, 500);

// --- the pill's New tab opens the card as a tab of this window --------------------------------------------
await focusCanvas(page);
await selectCard(page, path);
const pagesBefore = (context ?? page.context()).pages().length;
await pressCardAction(page, "New tab");
const chip = page.locator('.tab-chip[data-kind="card"]');
say("New tab on the card's pill opens it as a tab of this window, in front", (await until(() => chip.count())) === 1 && (await chip.getAttribute("data-front")) === "true" && (await chip.innerText()).includes("Button card"), await chip.innerText().catch(() => ""));
say("…and not the browser's tab", (context ?? page.context()).pages().length === pagesBefore);
const frameEl = page.locator('.surface[data-surface="card"] iframe.card-frame');
say("the card is in a frame of its own, sandboxed as the canvas's is", (await until(() => frameEl.count())) === 1 && !(await frameEl.getAttribute("sandbox")).includes("allow-same-origin") && (await frameEl.getAttribute("sandbox")) === (await page.locator("iframe.canvas-frame").getAttribute("sandbox")));
say("the canvas is out of sight, and its tools with it", !(await page.locator('.surface[data-surface="stage"]').isVisible()) && (await page.locator(".pen-tools").count()) === 0);
// The card's frame is the second frame of the canvas-frame page: found by what it shows.
const inCard = async (run, arg) => {
	for (const one of page.frames()) {
		if (one === page.mainFrame()) continue;
		const found = await one.evaluate(() => !!document.querySelector(".card-tab")).catch(() => false);
		if (found) return one.evaluate(run, arg);
	}
	return undefined;
};
// The card's root is closed: it is read through the surface's size and a press at its button, as a person would.
const shown = await until(async () => ((await inCard(() => document.querySelector(".card-tab .card-host")?.getBoundingClientRect().height ?? 0)) > 100 ? true : undefined));
say("the card is drawn in it", !!shown);

// --- its button works there: the call takes the road it takes on the canvas ---------------------------------
const box = await frameEl.boundingBox();
const cardBox = await inCard(() => { const r = document.querySelector(".card-tab-card").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// The button is the third block: under the heading and the paragraph.
let pressed = false;
for (const dy of [96, 104, 88, 112, 80, 120]) {
	await page.mouse.click(box.x + cardBox.x + 40, box.y + cardBox.y + dy);
	if (await until(async () => ((await notes()) > 0 ? true : undefined), 1200)) { pressed = true; break; }
}
say("the card's button, pressed in its tab, adds a note to its canvas", pressed && (await notes()) >= 1, String(await notes()));

// --- its file changed shows in the tab ----------------------------------------------------------------------
const deck = (await deckState())?.path;
if (deck) {
	const before = await inCard(() => document.querySelector(".card-tab .card-host") && globalThis.__decksProbes?.made);
	writeFileSync(join(deck, path), `<title>Button card</title><meta name="card" content='{"w":560}' />${html("Written again")}`);
	const again = await until(async () => {
		const now = await inCard(() => globalThis.__decksProbes?.made);
		const key = Object.keys(now ?? {})[0];
		return key && before && now[key].mounts > before[key].mounts ? true : undefined;
	}, 8000);
	say("its file written again is loaded again in the tab", !!again);
}

// --- closed, the canvas is as it was -------------------------------------------------------------------------
await chip.locator(".tab-chip-close").click();
say("the ✕ closes it, and the canvas is back with its tools", (await until(async () => ((await page.locator('.tab-chip[data-kind="card"]').count()) === 0 && (await page.locator('.surface[data-surface="stage"]').isVisible()) && (await page.locator(".pen-tools").count()) === 1 ? true : undefined))) === true);
const canvas = await canvasFrame(page);
say("…the same canvas frame, not one made anew", (await canvas.evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).length)) > 0);

// --- with ⌘ held, the browser's tab -------------------------------------------------------------------------
await focusCanvas(page);
await selectCard(page, path);
const popup = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => undefined);
await page.keyboard.down("Meta");
await pressCardAction(page, "New tab");
await page.keyboard.up("Meta");
const opened = await popup;
say("with ⌘ held, New tab opens the browser's tab, and no tab here", !!opened && (await page.locator('.tab-chip[data-kind="card"]').count()) === 0);
// The browser's tab is this window's address with the card's after #: Decks there, with the card's tab in front.
say("…at this window's address with the card's after #, where the card's tab is in front", !!opened && opened.url().endsWith(`#card/${path}`) && (await until(() => opened.locator('.tab-chip[data-kind="card"][data-front="true"]').count())) === 1, opened?.url());
await opened?.close().catch(() => {});

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
