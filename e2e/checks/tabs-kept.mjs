/**
 * The row kept, the window's address, and an agent's `view open` (`apps/web/src/tabs/remember.ts`,
 * `server/src/calls/view.ts`).
 *
 * The tab in front is named after `#` in the window's address (`#card/<path>`, `#canvas/<name>`,
 * `#doc/<path>`, `#app/<name>`; home has none). The row is remembered for the deck on this device: the
 * deck opened again in another page finds the tabs as they were left, the same one in front. An
 * address with a tab after `#` opens that tab in front, and so does the address changed by hand. An
 * agent's `decks view open` opens a tab, in front, when its chat is the one on screen, and from
 * another chat only offers a button. And the + lists what every kind offers: the apps at once, cards
 * and documents by typing.
 */
import { API, CANVAS, asPerson, canvasFrame, card, deckState, open, resetStage, rest, say, socket } from "../harness.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args, more = {}) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, ...more }, body: JSON.stringify({ args }) })).json();
const deck = (await deckState())?.path;
const second = (await call("canvas.create", ["Tab two"])).value?.name;
mkdirSync(join(deck, "docs"), { recursive: true });
writeFileSync(join(deck, "docs", "kept.md"), "# Kept\n\nA document on no canvas.\n");
const plan = card("plan");
await call("apps.create", ["kept-app", { title: "Kept app", starter: "static" }]);

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const hash = (on = page) => on.evaluate(() => location.hash);
const chips = (on = page) => on.locator(".tab-chip").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
say("on home the address names no tab", (await hash()) === "");

// --- the + lists what every kind offers ---------------------------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
const offers = (kind) => page.locator(`.open-offer[data-kind="${kind}"]`);
say("the + lists the deck's apps after the canvases, before anything is typed", (await until(() => offers("app").count())) === 1 && (await offers("app").innerText()).includes("Kept app") && (await offers("card").count()) === 0 && (await offers("document").count()) === 0, await page.locator('[role="menu"], .popover').first().innerText().catch(() => ""));
await page.locator('input[aria-label="Find a canvas, an app, a card or a document"]').fill("kept");
say("typed words find a document by its name, wherever it is in the deck", (await until(() => offers("document").count())) === 1 && (await offers("document").innerText()).includes("kept.md"), await offers("document").allInnerTexts().then((all) => all.join(" | ")));
await page.locator('input[aria-label="Find a canvas, an app, a card or a document"]').fill("plan");
say("…and a card by its title or its path", (await until(() => offers("card").count())) >= 1 && (await offers("card").first().getAttribute("data-kind")) === "card", await offers("card").allInnerTexts().then((all) => all.join(" | ")));
await page.locator('input[aria-label="Find a canvas, an app, a card or a document"]').fill("kept.md");
await offers("document").first().click();
say("a pick opens it as a tab, in front, and shuts the list", JSON.stringify(await until(async () => ((await chips()).length ? chips() : undefined))) === '["document*"]' && (await hash()) === "#doc/docs/kept.md" && (await page.locator(".open-offer").count()) === 0, JSON.stringify([await chips(), await hash()]));
await page.locator('.tab-chip[data-kind="document"] .tab-chip-close').click();
await until(async () => ((await chips()).length === 0 ? true : undefined));

// --- an agent's view open, from the chat on screen: the tab opens, in front -----------------------------------
const opened = await call("view.open", [plan]);
say("view open on a card's path opens it as a tab, in front, and says so", opened.ok === true && opened.value?.kind === "card" && opened.value?.opened === true && JSON.stringify(await until(async () => ((await chips()).length ? chips() : undefined))) === '["card*"]', JSON.stringify([opened, await chips()]).slice(0, 300));
say("the address names the tab in front", (await hash()) === `#card/${plan}`, await hash());
const canvasTab = await call("view.open", [second]);
say("…on a canvas's name, a canvas tab; nobody moved", canvasTab.value?.kind === "canvas" && JSON.stringify(await until(async () => ((await chips()).length === 2 ? chips() : undefined))) === '["card","canvas*"]' && (await hash()) === `#canvas/${second}` && ((await call("canvas.list", [])).value ?? []).find((one) => one.name === second)?.open.length === 0, JSON.stringify([canvasTab.value, await chips(), await hash()]));
const doc = await call("view.open", ["docs/kept.md"]);
say("…on a document's path, the document, though no canvas places it", doc.value?.kind === "document" && JSON.stringify(await until(async () => ((await chips()).length === 3 ? chips() : undefined))) === '["card","canvas","document*"]' && (await hash()) === "#doc/docs/kept.md", JSON.stringify([doc.value, await chips(), await hash()]));
const words = await until(async () => {
	for (const one of page.frames()) if (await one.evaluate(() => document.querySelector(".document-tab .document-surface")?.innerText.includes("A document on no canvas")).catch(() => false)) return true;
	return undefined;
});
say("…and its words show: it opened on a pass of its own", !!words);
const none = await call("view.open", ["nothing-by-that-name"]);
say("something that is nothing is refused with a sentence", none.ok === false && /Nothing to open is called/.test(none.error ?? ""), JSON.stringify(none).slice(0, 160));

// --- from another chat: a button, and nothing opens until it is pressed ---------------------------------------
const link = await socket();
const other = await call("agent.create", [{ name: "Backstage", kind: "pi" }]);
const otherId = other.value?.id ?? (await until(() => link.last("agent.list")?.agents?.find((one) => one.name === "Backstage")?.id));
// The new agent's chat comes on screen when it is made (`new-agent-opens`): the first one is the one in the background now.
const focused = await until(() => link.last("agent.list")?.focused);
const background = (link.last("agent.list")?.agents ?? []).map((one) => one.id).find((id) => id !== focused) ?? otherId;
const offered = await call("view.open", ["kept-app"], { "x-decks-agent": background });
const offer = page.locator(".notice .notice-action", { hasText: "Open" });
say("from a chat that is not on screen, view open offers a button and opens nothing", offered.value?.opened === false && /offered a button/.test(offered.value?.note ?? "") && (await until(() => offer.count())) === 1 && !(await chips()).some((one) => one.startsWith("app")), JSON.stringify([offered.value, await chips(), focused, background]).slice(0, 300));
await offer.click();
say("…pressed, the app's tab opens in front", JSON.stringify(await until(async () => ((await chips()).length === 4 ? chips() : undefined))) === '["card","canvas","document","app*"]' && (await hash()) === "#app/kept-app", JSON.stringify([await chips(), await hash()]));

// --- the row is kept: the deck opened again in another page of this browser ------------------------------------
// (The checks' first page clears its storage at every load; a second page of the same browser reads what the first kept.)
await page.locator('.tab-chip[data-kind="canvas"] .tab-chip-name').click();
await until(async () => ((await hash()) === `#canvas/${second}` ? true : undefined));
const base = page.url().split("#")[0];
const again = await page.context().newPage();
await again.goto(base);
await canvasFrame(again);
say("opened again, the row is as it was left, the same tab in front", JSON.stringify(await until(async () => ((await chips(again)).length === 4 ? chips(again) : undefined))) === '["card","canvas*","document","app"]' && (await hash(again)) === `#canvas/${second}`, JSON.stringify([await chips(again), await hash(again)]));
await again.close();

// --- an address with a tab after # opens that tab, in front ---------------------------------------------------
const addressed = await page.context().newPage();
await addressed.goto(`${base}#doc/docs/kept.md`);
say("an address that names a document opens it in front, beside the row kept", JSON.stringify(await until(async () => ((await chips(addressed)).some((one) => one === "document*") ? chips(addressed) : undefined))) === '["card","canvas","document*","app"]', JSON.stringify(await chips(addressed)));
// Changed by hand: the tab it names comes forward.
await addressed.evaluate((path) => (location.hash = `#card/${path}`), plan);
say("the address changed by hand brings the tab it names forward", (await until(async () => ((await chips(addressed)).some((one) => one === "card*") ? true : undefined))) === true, JSON.stringify(await chips(addressed)));
await addressed.close();

// --- closed, a tab leaves the row kept ---------------------------------------------------------------------------
for (const kind of ["app", "document", "card"]) await page.locator(`.tab-chip[data-kind="${kind}"] .tab-chip-close`).click();
await until(async () => ((await chips()).length === 1 ? true : undefined));
const last = await page.context().newPage();
await last.goto(base);
await canvasFrame(last);
say("tabs closed are gone from the row kept", JSON.stringify(await until(async () => ((await chips(last)).length ? chips(last) : undefined))) === '["canvas*"]', JSON.stringify(await chips(last)));
await last.close();

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
link.close();
await browser.close();
