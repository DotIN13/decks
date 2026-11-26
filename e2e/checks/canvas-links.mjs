/**
 * Links on the canvas to things in the deck (`packages/pen/src/link.ts`,
 * `apps/web/src/tabs/open.ts`).
 *
 * A link's address may be one of this window's own, the address a tab has after `#`: `#canvas/<name>`,
 * `#card/<path>`, `#doc/<path>`, `#app/<name>`. Followed on the canvas it opens that tab in this
 * window, in front, where a web link opens the browser's. Here, links in drawn words: a click opens a
 * card as a tab; a click on a canvas's opens it as another tab, the one left staying in the row; one
 * already open comes forward and no second is made; ⌘ asks for the browser's tab; and a link to
 * something that is not in the deck says so and opens nothing. And a link chip, a link as an item of
 * its own (`decks canvas insert --type link --to …`): a click opens it and leaves nothing selected,
 * Shift-click selects it and opens nothing, and a drag moves it and opens nothing. One is added by
 * hand from the card tool's menu (Link to…, the finder the row of tabs' + has), by pasting an address,
 * or by dragging a tab down from the row onto the canvas.
 * A link in a card's own HTML (`<a href="#app/budget">`) opens the tab too.
 * And a chip follows the canvas it points at: renamed, it says the new name; deleted, it is dimmed
 * and a click says so.
 */
import { API, CANVAS, asPerson, canvasFrame, card, flyToCard, open, resetStage, rest, say, settle } from "../harness.mjs";

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
const second = (await call("canvas.create", ["Tab two"])).value?.name;
await call("apps.create", ["budget", { title: "Budget", starter: "static" }]);
const plan = card("plan");

// --- links in drawn words ------------------------------------------------------------------------------------------
// Each a line of its own, a link from end to end, so a press in its middle is a press on the link.
const words = (id, content) => ({ type: "text", id, content, fontSize: 30, textGrowth: "fixed-width", width: 460, metadata: { type: "decks.markdown" } });
const placed = await call("canvas.batch", [
	[
		{ op: "insert", item: words("to-card", `[The plan, whole](#card/${plan}?open=tab)`), at: { x1: 0, y1: -400 } },
		{ op: "insert", item: words("to-card-fly", `[The plan, where it is](#card/${plan})`), at: { x1: 0, y1: -480 } },
		{ op: "insert", item: words("to-canvas", `[Over to tab two](#canvas/${second})`), at: { x1: 0, y1: -320 } },
		{ op: "insert", item: words("to-gone", "[A canvas long gone](#canvas/nowhere-at-all)"), at: { x1: 0, y1: -240 } },
	],
	{ canvas: CANVAS },
]);
say("four lines of words, each a link to something in the deck", placed.ok === true, JSON.stringify(placed).slice(0, 240));

// Wide, so the row shows every tab this opens.
const { browser, page, errors } = await open({ width: 1800, height: 900, scheme: "light" });
await rest(page, { start: 0 });
// The side panel folded, so the canvas has the window and what is brought into view is not under it.
await page.locator('.panel-shell [aria-label="Hide the side panel"]').first().click();
await settle(page, 500);
/** Bring drawn items into view, as the agent on screen shows them: its offer is taken when the canvas was just touched. Until the first of them is on screen. */
const show = async (ids) => {
	const view = page.viewportSize();
	const seen = async () => {
		const frame = await canvasFrame(page);
		for (const id of ids) {
			const box = await frame.evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), id);
			// Clear of the tool column on the left, the top bar and the composer.
			if (!box || box.x + box.width * 0.3 < 80 || box.y < 70 || box.x + box.width / 2 > view.width - 20 || box.y + box.height > view.height - 130) return false;
		}
		return true;
	};
	for (let tries = 0; tries < 4 && !(await seen()); tries++) {
		await call("view.focus", [ids, { canvas: CANVAS }]);
		const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
		if (await until(() => go.isVisible(), 1200)) await go.click();
		await until(seen, 2500);
	}
	await settle(page, 600);
};
await show(["to-card-fly", "to-card", "to-canvas", "to-gone"]);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-words.png` });
/** A point on a drawn item, on screen: the canvas's frame fills the window, so its points are the page's. */
const middle = async (id) => {
	const box = await until(async () => (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), id));
	// A third of the way along: the words end before their box does, and the side panel lies over its start.
	return box ? { x: box.x + box.width * 0.3, y: box.y + box.height / 2 } : undefined;
};
const press = async (id, mods = []) => {
	const at = await middle(id);
	if (!at) return false;
	for (const key of mods) await page.keyboard.down(key);
	await page.mouse.click(at.x, at.y);
	for (const key of mods) await page.keyboard.up(key);
	return true;
};
const row = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const cameraName = async () => (await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).trim();
const toCanvas = async () => {
	await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
	await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
	await settle(page, 300);
};
const firstTitle = await cameraName();

say("a press on a link to a card that says open=tab opens the card as a tab, in front", (await press("to-card")) && JSON.stringify(await until(async () => ((await row()).includes("card*") ? row() : undefined))) === '["canvas","card*"]' && (await page.evaluate(() => location.hash)) === `#card/${plan}`, JSON.stringify(await row()));
await toCanvas();
say("pressed again it comes forward, and no second tab is made", (await press("to-card")) && JSON.stringify(await until(async () => ((await row()).includes("card*") ? row() : undefined))) === '["canvas","card*"]', JSON.stringify(await row()));
await toCanvas();

// --- a link to a card that says nothing: the view flies to the card on its canvas; with ⌘, a tab ---------------------
const camera = () => canvasFrame(page).then((frame) => frame.evaluate(() => ({ ...globalThis.__decksProbes.rust.camera })));
const planBox = (await call("canvas.read", [{ canvas: CANVAS, of: plan, depth: 0 }])).value?.items?.[0]?.box;
const cameraBefore = await camera();
await press("to-card-fly");
const flown = await until(async () => {
	const now = await camera();
	return planBox && now.x > planBox.x1 && now.x < planBox.x2 && now.y > planBox.y1 && now.y < planBox.y2 ? now : undefined;
}, 5000);
say("a press on a link to a card, opening unsaid, flies the view to the card on its canvas and opens no tab", !!flown && JSON.stringify(await row()) === '["canvas*","card"]', `${JSON.stringify({ cameraBefore, now: await camera(), planBox })} ${JSON.stringify(await row())}`);
await show(["to-card-fly", "to-card", "to-canvas", "to-gone"]);
await press("to-card-fly", ["Meta"]);
say("with ⌘ held the same link opens a tab of this window, whatever it says", JSON.stringify(await until(async () => ((await row()).includes("card*") ? row() : undefined))) === '["canvas","card*"]', JSON.stringify(await row()));
await toCanvas();
await show(["to-card-fly", "to-card", "to-canvas", "to-gone"]);

// --- a link to nothing -----------------------------------------------------------------------------------------------
await press("to-gone");
const notice = await until(async () => {
	const text = await page.locator(".notice").allInnerTexts();
	return text.find((one) => /not in the deck any more/.test(one));
});
say("a link to a canvas that is not in the deck says so, and opens nothing", !!notice && JSON.stringify(await row()) === '["canvas*","card"]', notice ?? JSON.stringify(await page.locator(".notice").allInnerTexts()));

// --- a link to a canvas: another tab ---------------------------------------------------------------------------------
say("a press on a link to a canvas opens that canvas as another tab: the camera is on it, and the canvas left stays in the row", (await press("to-canvas")) && (await until(async () => ((await cameraName()) === "Tab two" ? true : undefined))) === true && JSON.stringify(await row()) === '["canvas","card","canvas*"]' && (await page.locator(".v3-topbar .tab-chip[data-tab]").first().innerText()).trim() === firstTitle, `${await cameraName()} ${JSON.stringify(await row())}`);

// --- a link chip -------------------------------------------------------------------------------------------------------
// Back on the first canvas, with the row as it is: both canvases, the card, the first in front.
await page.locator(".v3-topbar .tab-chip[data-tab]").first().locator(".tab-chip-name").click();
await until(async () => ((await cameraName()) === firstTitle ? true : undefined));
const chip = (await call("canvas.insert", [{ type: "link", to: "Tab two" }, { canvas: CANVAS, at: { x1: 0, y1: -140 } }])).value;
const appChip = (await call("canvas.insert", [{ type: "link", to: "budget" }, { canvas: CANVAS, at: { x1: 320, y1: -140 } }])).value;
say("a chip is placed by what it opens: a canvas by its title, an app by its name", chip?.type === "link" && chip.to === `#canvas/${second}` && chip.title === "Tab two" && appChip?.to === "#app/budget", JSON.stringify([chip, appChip]).slice(0, 300));
await show([chip.id, appChip.id]);
const whole = async (id) => {
	const box = await until(async () => (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), id));
	return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2, left: box.x } : undefined;
};
const selected = async () => (await canvasFrame(page)).evaluate(() => document.querySelectorAll(".pen-selection:not([data-page])").length);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-chips.png` });

// Shift-click selects, and opens nothing.
let at = await whole(appChip.id);
await page.keyboard.down("Shift");
await page.mouse.click(at.x, at.y);
await page.keyboard.up("Shift");
await settle(page, 400);
say("Shift-click on a chip selects it and opens nothing", (await selected()) === 1 && !(await row()).includes("app*") && !(await row()).includes("app"), `${await selected()} ${JSON.stringify(await row())}`);
await page.keyboard.press("Escape");

// A drag moves it, and opens nothing.
at = await whole(appChip.id);
await page.mouse.move(at.x, at.y);
await page.mouse.down();
for (let step = 1; step <= 6; step++) {
	await page.mouse.move(at.x - step * 20, at.y + step * 10);
	await new Promise((resolve) => setTimeout(resolve, 30));
}
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-drag.png` });
await page.mouse.up();
await settle(page, 600);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-drag-after.png` });
const moved = await until(async () => {
	const now = await whole(appChip.id);
	return now && Math.abs(now.x - at.x) > 60 ? now : undefined;
});
say("a drag moves a chip and opens nothing", !!moved && !(await row()).some((one) => one.startsWith("app")), JSON.stringify([at, moved, await row()]));
// A press on bare canvas, between the two chips, lets the selection go.
const other = await whole(chip.id);
at = await whole(appChip.id);
await page.mouse.click((other.x + at.x) / 2, Math.min(other.y, at.y) - 90);
await until(async () => ((await selected()) === 0 ? true : undefined), 3000);

// A click opens it, as a tab, and leaves nothing selected.
await page.mouse.click(at.x, at.y);
say("a click on a chip opens what it points at, as a tab, in front", JSON.stringify(await until(async () => ((await row()).includes("app*") ? row() : undefined))) === '["canvas","card","canvas","app*"]' && (await page.evaluate(() => location.hash)) === "#app/budget", JSON.stringify(await row()));
await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
await settle(page, 400);
say("…and back on the canvas the chip is not left selected", (await selected()) === 0, String(await selected()));
// --- adding one by hand: the tool column's "Link to…", and a pasted address ------------------------------------------
const links = async () => ((await call("canvas.read", [{ canvas: CANVAS }])).value?.items ?? []).filter((item) => item.type === "link").map((item) => `${item.to}|${item.title}`);
const before = await links();
const tabsBefore = JSON.stringify(await row());
await page.locator('.pen-tools [data-tool="card"]').first().click();
await page.locator(".v3-menu-row", { hasText: "Link to" }).first().click();
const finder = page.locator('input[aria-label="Link to a canvas, an app, a card or a document"]');
say("the card tool's menu has Link to…, which opens the finder the row of tabs' + has, with the select tool back in hand", (await until(() => finder.count())) === 1 && (await page.locator('.pen-tools [data-tool="select"]').first().getAttribute("data-on")) === "true" && (await page.locator('.popover .switcher-canvas:has-text("Tab two")').count()) === 1 && (await page.locator(".popover", { hasText: "New canvas" }).count()) === 0);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-finder.png` });
await finder.fill("plan");
await page.locator('.popover .open-offer[data-kind="card"]').first().click();
const made = await until(async () => {
	const now = await links();
	return now.length === before.length + 1 ? now.find((one) => !before.includes(one)) : undefined;
});
say("a pick puts a chip on the canvas that points at it, and opens nothing", !!made && made.startsWith(`#card/${plan}|`) && JSON.stringify(await row()) === tabsBefore && (await finder.count()) === 0, `${made} ${JSON.stringify(await row())}`);
// An address pasted with the keyboard on the canvas: a chip, where words would be a note.
const frame = await canvasFrame(page);
const pasting = (text) =>
	frame.evaluate((words) => {
		const data = new DataTransfer();
		data.setData("text/plain", words);
		document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
	}, text);
await pasting("#app/budget");
const pasted = await until(async () => ((await links()).filter((one) => one.startsWith("#app/budget|")).length === 2 ? true : undefined));
say("an address pasted on the canvas lands as a chip", pasted === true, JSON.stringify(await links()));
await pasting("just some words");
const notes = await until(async () => (((await call("canvas.read", [{ canvas: CANVAS }])).value?.items ?? []).some((item) => item.type === "note" && item.content === "just some words") ? true : undefined));
say("…and words that are no address are still a note", notes === true);
await page.mouse.click((other.x + at.x) / 2, Math.min(other.y, at.y) - 90);

// The pointer shows it is a link.
at = await whole(chip.id);
await page.mouse.move(at.x - 3, at.y);
await page.mouse.move(at.x, at.y, { steps: 3 });
const cursor = () => canvasFrame(page).then((frame) => frame.evaluate(() => getComputedStyle(document.querySelector(".stage")).cursor));
say("over a chip the pointer is a link's", (await until(async () => ((await cursor()) === "pointer" ? true : undefined), 2000)) === true, await cursor());
await page.mouse.click(at.x, at.y);
say("a chip to a canvas takes the camera there", (await until(async () => ((await cameraName()) === "Tab two" ? true : undefined))) === true, await cameraName());

// --- a tab dragged from the row onto the canvas ------------------------------------------------------------------------
await page.locator(".v3-topbar .tab-chip[data-tab]").first().locator(".tab-chip-name").click();
await until(async () => ((await cameraName()) === firstTitle ? true : undefined));
await settle(page, 400);
const cardTab = page.locator('.v3-topbar .tab-chip[data-kind="card"] .tab-chip-name').first();
const from = await cardTab.boundingBox();
const linksWas = await links();
const rowWas = JSON.stringify(await row());
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
for (let step = 1; step <= 8; step++) {
	// Down to bare canvas, under the chips and over the composer.
	await page.mouse.move(from.x + from.width / 2 + step * 10, from.y + from.height / 2 + step * 78);
	await new Promise((resolve) => setTimeout(resolve, 25));
}
const ghost = await page.locator(".tab-ghost").evaluate((one) => ({ over: one.dataset.over, text: one.textContent })).catch(() => undefined);
if (process.env.LOOK_SHOTS) await page.screenshot({ path: `${process.env.LOOK_SHOTS}/links-drag-tab.png` });
await page.mouse.up();
const dropped = await until(async () => {
	const now = await links();
	return now.length === linksWas.length + 1 ? now.filter((one) => one.startsWith(`#card/${plan}|`)).length : undefined;
});
say("a tab dragged down from the row shows a copy of itself that follows the pointer, marked over the canvas", ghost?.over === "true" && (ghost.text ?? "").length > 3, JSON.stringify(ghost));
say("let go on the canvas it leaves a chip that points at it, and the tab itself is not pressed", dropped === 2 && JSON.stringify(await row()) === rowWas && (await page.locator(".tab-ghost").count()) === 0, `${dropped} ${JSON.stringify(await row())}`);

// --- a link in a card's own HTML ---------------------------------------------------------------------------------------
await page.locator(".v3-topbar .tab-chip[data-tab]").first().locator(".tab-chip-name").click();
await until(async () => ((await cameraName()) === firstTitle ? true : undefined));
// Two links, each half of the card, so a press can find one by where it is: the card's root is closed.
const half = (href, text, i) => `<a href="${href}" style="position:absolute;left:0;right:0;top:${i * 50}%;height:50%;display:flex;align-items:center;font-size:28px">${text}</a>`;
const htmlCard = (await call("canvas.insert", [{ type: "card", title: "Links out", html: `<div style="position:relative;height:300px">${half("#app/budget", "The budget", 0)}${half(`#canvas/${second}`, "Tab two", 1)}</div>`, width: 500, height: 300 }, { canvas: CANVAS, at: { x1: 0, y1: -900 } }])).value?.card;
await flyToCard(page, htmlCard);
const pressIn = async (n) => {
	await settle(page, 500);
	const r = await (await canvasFrame(page)).evaluate((wanted) => (window.__decksProbes?.cards?.() ?? []).find((one) => one.path === wanted)?.rect.toJSON() ?? null, htmlCard);
	await page.mouse.click(r.x + r.width * 0.3, r.y + r.height * (n * 0.5 + 0.25));
};
await pressIn(0);
say("a link in a card's own HTML to an app opens the app's tab", (await until(async () => ((await row()).includes("app*") ? true : undefined))) === true && (await page.evaluate(() => location.hash)) === "#app/budget", JSON.stringify(await row()));
await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
await pressIn(1);
say("…and one to a canvas takes the camera there", (await until(async () => ((await cameraName()) === "Tab two" ? true : undefined))) === true, await cameraName());

// The same card whole, in a tab of its own: its link opens the app's tab from there too.
await call("view.open", [htmlCard]);
// The tab in front: a card's tab left behind keeps its frame, out of sight (`tabs/kinds/card.tsx`, `data-kept`).
const cardFrame = page.locator('.surface[data-surface="card"]:not([data-kept]) iframe.card-frame');
const inTab = await until(async () => {
	const outer = await cardFrame.boundingBox();
	const shown = await (await cardFrame.elementHandle())?.contentFrame();
	if (!outer || !shown) return undefined;
	for (const one of [shown, ...shown.childFrames()]) {
		const inner = await one.evaluate(() => document.querySelector(".card-tab .card-surface")?.getBoundingClientRect().toJSON()).catch(() => undefined);
		if (inner && inner.width > 100 && inner.height > 100) return { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height };
	}
	return undefined;
});
if (inTab) await page.mouse.click(inTab.x + inTab.width * 0.3, inTab.y + inTab.height * 0.25);
say("in the card's own tab its link opens the app's tab as well", !!inTab && (await until(async () => ((await page.evaluate(() => location.hash)) === "#app/budget" ? true : undefined))) === true, JSON.stringify([inTab, await page.evaluate(() => location.hash)]));
await page.locator('.tab-chip[data-kind="card"]').last().locator(".tab-chip-close").click().catch(() => {});

// --- kept in step with the canvas it points at ------------------------------------------------------------------------
await page.locator(".v3-topbar .tab-chip[data-tab]").first().locator(".tab-chip-name").click();
await until(async () => ((await cameraName()) === firstTitle ? true : undefined));
await call("canvas.rename", ["Second tab", { canvas: second }]);
say("the canvas called something else: its chip says the new name", (await until(async () => ((await links()).includes(`#canvas/${second}|Second tab`) ? true : undefined))) === true, JSON.stringify(await links()));
const removed = await call("canvas.remove", [second]);
const dimmed = await until(async () => (((await call("canvas.read", [{ canvas: CANVAS }])).value?.items ?? []).find((item) => item.type === "link" && item.to === `#canvas/${second}`)?.opacity === 0.45 ? true : undefined));
say("the canvas deleted: its chip stays, dimmed", removed.ok === true && dimmed === true, JSON.stringify(removed).slice(0, 200));
await show([chip.id]);
at = await whole(chip.id);
await page.mouse.click(at.x, at.y);
const gone = await until(async () => (await page.locator(".notice").allInnerTexts()).find((one) => one.includes(second) && /not in the deck any more/.test(one)));
say("…and a click on it says the canvas is not in the deck any more", !!gone, gone ?? JSON.stringify(await page.locator(".notice").allInnerTexts()));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
