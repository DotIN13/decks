/**
 * The row of tabs is one row: every tab the same, none of them the bar's own (`apps/web/src/tabs/TabStrip.tsx`).
 *
 * The canvas the chat's camera is on was the bar's chip, darker, with an arrow and no ✕, and the
 * other tabs were lesser chips after it; it took the first place whichever canvas it was, so the
 * tabs changed places as the camera moved. Now each tab is the same chip, its kind's mark, its name
 * and its ✕, in the order they were opened, and the one in front is washed. Here: the tabs are drawn
 * alike; a press moves the wash and no tab; with more tabs than the bar has room for the row shows
 * the first of them and the one in front, and a count lists them all; and in that list a row and
 * its ✕ are one box, so the wash under the pointer is under both.
 */
import { API, asPerson, card, open, resetStage, rest, say, settle } from "../harness.mjs";

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
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
await call("canvas.create", ["Launch plan"]);
await call("canvas.create", ["Research notes"]);
await call("apps.create", ["tracker", { title: "Tracker", starter: "static" }]);
await call("apps.create", ["budget", { title: "Budget", starter: "static" }]);

/** How long the harness's words take to reach the page: raised for a moment below, to stand in for a harness far away. */
let lag = 0;
const { browser, page, errors } = await open({
	width: 1500,
	height: 800,
	before: (made) =>
		made.routeWebSocket(/\/api\/v1\/socket/, (ws) => {
			const server = ws.connectToServer();
			server.onMessage((message) => (lag ? setTimeout(() => ws.send(message), lag) : ws.send(message)));
			server.onClose(() => ws.close().catch(() => {}));
			ws.onClose(() => server.close().catch(() => {}));
			ws.onMessage((message) => server.send(message));
		}),
});
await rest(page, { start: 0 });
const row = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.dataset.kind}:${one.innerText.trim()}${one.dataset.front ? "*" : ""}`));
/** How each tab is drawn: its parts, its size, its type and its ground. */
const drawn = () =>
	page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) =>
		all.map((one) => {
			const name = one.querySelector(".tab-chip-name");
			const style = getComputedStyle(one);
			const type = getComputedStyle(one.querySelector(".v3-canvas-name"));
			return { front: one.dataset.front === "true", height: one.getBoundingClientRect().height, radius: style.borderRadius, color: style.color, ground: style.backgroundColor, weight: type.fontWeight, size: type.fontSize, mark: name.querySelectorAll("svg").length, arrow: one.querySelectorAll(".v3-chev").length, close: one.querySelectorAll(".tab-chip-close").length, left: getComputedStyle(name).paddingLeft };
		}),
	);

// --- a few tabs: every one the same -------------------------------------------------------------------------------
await call("view.open", ["launch-plan"]);
await call("view.open", [card("plan")]);
await call("view.open", ["tracker"]);
const four = await until(async () => ((await row()).length === 4 ? row() : undefined));
say("four tabs, in the order they were opened, the last in front", JSON.stringify(four?.map((one) => one.split(":")[0])) === '["canvas","canvas","card","app"]' && four?.[3].endsWith("*") && four.filter((one) => one.endsWith("*")).length === 1, JSON.stringify(four));
await settle(page, 300);
const look = await drawn();
const alike = (list, keys) => list.every((one) => keys.every((key) => one[key] === list[0][key]));
say("every tab is the same chip: one height and corner, one size and weight of type, a mark, a ✕, and no arrow", alike(look, ["height", "radius", "weight", "size", "left"]) && look.every((one) => one.mark === 1 && one.close === 1 && one.arrow === 0), JSON.stringify(look));
const behind = look.filter((one) => !one.front);
say("…the one in front washed, and the others, the canvas the chat is on among them, plain and alike", look.filter((one) => one.front).length === 1 && look.find((one) => one.front).ground !== behind[0].ground && alike(behind, ["color", "ground"]), JSON.stringify(look.map((one) => [one.front, one.color, one.ground])));
say("the bar has no chip of its own beside them", (await page.locator(".v3-topbar .v3-canvas-chip").count()) === 0);

// --- a press moves the wash, and no tab ------------------------------------------------------------------------------
const names = (list) => list.map((one) => one.replace(/\*$/, ""));
for (const at of [0, 2, 1]) {
	await page.locator(".v3-topbar .tab-chip[data-tab]").nth(at).locator(".tab-chip-name").click();
	const now = await until(async () => ((await row())[at]?.endsWith("*") ? row() : undefined));
	say(`a press on tab ${at + 1} brings it in front, and every tab stays in its place`, !!now && JSON.stringify(names(now)) === JSON.stringify(names(four)) && now.filter((one) => one.endsWith("*")).length === 1, JSON.stringify(now));
}

// --- a canvas tab, then at once a card's: the card stays in front when the harness answers ---------------------
// The page moves the camera at once and the harness says so a moment later; that word is no news, and must not put the canvas back in front.
await page.locator(".v3-topbar .tab-chip[data-tab]").nth(0).locator(".tab-chip-name").click();
await until(async () => ((await row())[0]?.endsWith("*") ? true : undefined));
await settle(page, 600);
lag = 700;
await page.locator(".v3-topbar .tab-chip[data-tab]").nth(1).locator(".tab-chip-name").click();
await page.locator(".v3-topbar .tab-chip[data-tab]").nth(2).locator(".tab-chip-name").click();
await settle(page, 1800);
const after = await row();
say("a canvas tab picked and then, before the harness answers, a card's: the card stays in front, over the canvas picked", after[2]?.endsWith("*") && after.filter((one) => one.endsWith("*")).length === 1 && (await page.locator(".v3-topbar .tab-chip[data-tab]").nth(1).getAttribute("data-camera")) === "true", JSON.stringify(after));
lag = 0;
await settle(page, 300);

// --- more tabs than the bar has room for -----------------------------------------------------------------------------
// Opened by the + as the person opens them: an app, then a canvas, which comes in front.
const plus = async (pick) => {
	await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
	await page.locator(pick).first().click();
};
await plus('.open-offer[data-kind="app"]:has-text("Budget")');
await plus('.switcher-canvas:has-text("Research notes")');
const fold = page.locator(".v3-topbar .tab-fold");
say("with more tabs than fit, a count of them all stands after the row", (await until(async () => ((await fold.count()) === 1 && (await fold.innerText()).trim() === "6" ? true : undefined))) === true, await fold.innerText().catch(() => ""));
const few = await until(async () => ((await row()).some((one) => one === "canvas:Research notes*") ? row() : undefined));
say("…and the row shows the first of them, then the one in front, though it is the last", !!few && few.length < 6 && few.at(-1) === "canvas:Research notes*" && JSON.stringify(names(few).slice(0, -1)) === JSON.stringify(names(four).slice(0, few.length - 1)), JSON.stringify(few));
say("…every one still the same chip", alike(await drawn(), ["height", "radius", "weight", "size", "left"]));

// --- the list: a row and its ✕ are one box ---------------------------------------------------------------------------
await fold.click();
const boxes = page.locator(".popover .row-act:has(> .tab-row)");
await until(async () => ((await boxes.count()) === 6 && (await boxes.nth(0).innerText()).trim().length > 0 ? true : undefined));
say("the count lists every tab, in the row's order, the one in front marked", (await boxes.count()) === 6 && JSON.stringify(await boxes.locator(".tab-row").evaluateAll((all) => all.map((one) => one.dataset.kind))) === '["canvas","canvas","card","app","app","canvas"]' && (await boxes.nth(5).locator(".tab-row").getAttribute("data-current")) === "true");
// The canvas list changing (here a canvas renamed) builds nothing in the bar again: the list stays open.
await call("canvas.rename", ["Research log", { canvas: "research-notes" }]);
say("the list stays open while the canvases change under it, and follows them", (await until(async () => ((await boxes.nth(5).innerText()).includes("Research log") ? true : undefined))) === true && (await boxes.count()) === 6, await boxes.nth(5).innerText().catch(() => "gone"));
const second = boxes.nth(1);
await second.locator(".tab-row").hover();
await settle(page, 250);
const wash = await second.evaluate((box) => {
	const within = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
	const close = box.querySelector(".close");
	const clear = (color) => color === "rgba(0, 0, 0, 0)" || color === "transparent";
	return { inside: !!close && within(close.getBoundingClientRect(), box.getBoundingClientRect()), box: getComputedStyle(box).backgroundColor, row: getComputedStyle(box.querySelector(".tab-row")).backgroundColor, close: getComputedStyle(close).backgroundColor, shown: Number(getComputedStyle(close).opacity), clear: [getComputedStyle(box).backgroundColor, getComputedStyle(box.querySelector(".tab-row")).backgroundColor, getComputedStyle(close).backgroundColor].map(clear) };
});
say("a row's ✕ is inside the row's box, and under the pointer the wash is the box's: under the name and the ✕ alike", wash.inside && wash.shown === 1 && JSON.stringify(wash.clear) === "[false,true,true]", JSON.stringify(wash));
await second.locator(".close").hover();
await settle(page, 250);
say("…and still the box's with the pointer on the ✕", (await second.evaluate((box) => getComputedStyle(box).backgroundColor)) === wash.box);
await second.locator(".close").click();
say("the ✕ closes that tab and leaves the list open", (await until(async () => ((await boxes.count()) === 5 ? true : undefined))) === true && (await fold.innerText()).trim() === "5", String(await boxes.count()));
await boxes.nth(2).locator(".tab-row").click();
say("a row picked brings its tab in front, into the row, and shuts the list", (await until(async () => ((await row()).at(-1)?.startsWith("app:") && (await row()).at(-1).endsWith("*") && (await boxes.count()) === 0 ? true : undefined))) === true, JSON.stringify(await row()));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
