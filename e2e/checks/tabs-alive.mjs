/**
 * Open tabs stay alive: coming back to one is showing it, not starting it again.
 *
 * A tab put away starts from nothing when it comes forward: its frame, its code, its line, and for a
 * canvas its drawing engine and every picture, a second or so from a far device. So the canvas tabs
 * last in front keep their frames behind the one on screen (`@decks/canvas`, `frame/outside/surface.tsx`,
 * told which by `tabs/tabs.ts`, `canvasesBehind`), and cards and documents theirs (`tabs/kinds/card.tsx`),
 * within the device's budget (`tabs/budget.ts`).
 *
 * What is checked: a canvas opened as a tab leaves the one before it on the page, hidden, in a frame
 * of its own; going back shows that same frame, with what an agent drew there meanwhile already in
 * it; the page talks to the frame in front only (its zoom reading, its selection); a third and fourth
 * canvas keep no more frames than the budget, the one in front longest ago let go; closing a tab
 * lets its frame go; and a card's tab is the same frame after another tab was in front, hidden
 * meanwhile, not made again.
 */
import { API, CANVAS, asPerson, canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const names = [];
for (const title of ["Alive two", "Alive three", "Alive four"]) {
	const made = await call("canvas.create", [title]);
	names.push(made.value?.name);
	await call("canvas.insert", [{ type: "note", id: `note-${names.length}`, content: `On ${title}` }, { canvas: made.value?.name, at: { x1: 0, y1: 0 } }]);
}
say("three more canvases, each with a note of its own", names.every(Boolean), JSON.stringify(names));

// Wide enough for the row to show every tab as a chip.
const { browser, page, errors } = await open({ width: 2000, height: 900 });
await rest(page, { start: 0 });
const drawn = async () => (await canvasFrame(page)).evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).map((one) => one.id));
/** The canvas frames on the page: which is in front, which are kept, and whether a kept one is out of sight. */
const frames = () =>
	page.evaluate(() =>
		[...document.querySelectorAll("iframe.canvas-frame, iframe.canvas-frame-kept")].map((frame) => ({
			front: frame.classList.contains("canvas-frame"),
			mark: frame.dataset.mark ?? "",
			hidden: getComputedStyle(frame).visibility === "hidden",
			sized: frame.getBoundingClientRect().width > 200,
		})),
	);
const mark = (name) => page.evaluate((as) => void (document.querySelector("iframe.canvas-frame").dataset.mark = as), name);
const openCanvas = async (title) => {
	await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
	await page.locator(`.switcher-canvas:has-text("${title}")`).click();
};
const showTab = (title) => page.locator('.tab-chip[data-kind="canvas"]', { hasText: title }).locator(".tab-chip-name").click();
const firstTitle = (await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).trim();
const firstIds = await drawn();
await mark("first");

// --- a canvas opened as a tab: the one before it stays on the page, behind ---------------------------------
await openCanvas("Alive two");
const second = await until(async () => ((await drawn()).includes("note-1") ? true : undefined));
await mark("two");
const two = await frames();
say("the canvas opened shows in a frame of its own", !!second && two.filter((one) => one.front).length === 1 && two.find((one) => one.front)?.mark === "two", JSON.stringify(two));
say("…and the one before it is kept: on the page, out of sight, at its full size", two.some((one) => !one.front && one.mark === "first" && one.hidden && one.sized), JSON.stringify(two));

// --- an agent draws on the canvas kept behind; going back shows the same frame, with that in it --------------
const added = await call("canvas.insert", [{ type: "note", id: "while-behind", content: "Drawn while this canvas was behind" }, { canvas: CANVAS, at: { x1: 40, y1: 40 } }]);
await settle(page, 600);
const before = Date.now();
await showTab(firstTitle);
const back = await until(async () => {
	const now = await frames();
	return now.find((one) => one.front)?.mark === "first" ? now : undefined;
}, 3000);
const took = Date.now() - before;
say("going back shows the frame that was kept, not a new one", !!back && back.some((one) => !one.front && one.mark === "two"), JSON.stringify(back ?? (await frames())));
const there = await drawn();
say("…with what was drawn there meanwhile already in it", added.ok === true && there.includes("while-behind") && firstIds.every((id) => there.includes(id)), JSON.stringify({ added: added.ok, has: there.includes("while-behind") }));
say("…in well under half a second", took < 450, `${took} ms`);

// --- the page talks to the frame in front only ----------------------------------------------------------
const zoomReading = async () => Number((await page.locator(".v3-zoom-value").first().textContent()).replace(/[^0-9.]/g, ""));
const zoomFirst = await zoomReading();
await page.locator('.v3-zoom [aria-label="Zoom in"]').click();
await settle(page, 700);
const zoomedFirst = await zoomReading();
await showTab("Alive two");
await until(async () => ((await frames()).find((one) => one.front)?.mark === "two" ? true : undefined));
await settle(page, 700);
const zoomTwo = await zoomReading();
await showTab(firstTitle);
await until(async () => ((await frames()).find((one) => one.front)?.mark === "first" ? true : undefined));
await settle(page, 700);
const zoomBack = await zoomReading();
say("a zoom on one canvas is that canvas's: the other keeps its own, and it is there on coming back", zoomedFirst > zoomFirst && Math.abs(zoomTwo - zoomedFirst) > 0.5 && Math.abs(zoomBack - zoomedFirst) <= 1, JSON.stringify({ zoomFirst, zoomedFirst, zoomTwo, zoomBack }));

// --- the budget: two kept behind the one in front, the one in front longest ago let go ---------------------
await openCanvas("Alive three");
await until(async () => ((await drawn()).includes("note-2") ? true : undefined));
await mark("three");
await openCanvas("Alive four");
await until(async () => ((await drawn()).includes("note-3") ? true : undefined));
await mark("four");
await settle(page, 400);
const four = await frames();
say("with four canvas tabs open, three frames are held: the one in front and the two last in front", four.length === 3 && four.find((one) => one.front)?.mark === "four" && four.filter((one) => !one.front).map((one) => one.mark).sort().join() === "first,three", JSON.stringify(four));

// --- closing a tab lets its frame go ---------------------------------------------------------------------
await page.locator('.tab-chip[data-kind="canvas"]', { hasText: "Alive three" }).hover();
await page.locator('.tab-chip[data-kind="canvas"]', { hasText: "Alive three" }).locator(".tab-chip-close").click();
const closed = await until(async () => {
	const now = await frames();
	return now.some((one) => one.mark === "three") ? undefined : now;
}, 4000);
say("a canvas tab closed lets its frame go", !!closed && closed.find((one) => one.front)?.mark === "four", JSON.stringify(closed ?? (await frames())));

// --- a card's tab is kept too ----------------------------------------------------------------------------
const cards = (await call("card.list", [])).value ?? [];
const path = cards.find((one) => one.path.startsWith(`canvases/${CANVAS}/`))?.path;
await page.evaluate((at) => void (location.hash = `#card/${at}`), path);
const cardFrame = await until(async () => ((await page.locator('.surface[data-surface="card"] iframe').count()) === 1 ? true : undefined));
await settle(page, 800);
await page.evaluate(() => void (document.querySelector('.surface[data-surface="card"] iframe').dataset.mark = "card"));
await showTab("Alive four");
await until(async () => ((await page.locator('.tab-chip[data-kind="canvas"][data-front="true"]').count()) === 1 ? true : undefined));
const away = await page.evaluate(() => {
	const frame = document.querySelector('.surface[data-surface="card"] iframe');
	return frame ? { mark: frame.dataset.mark, hidden: getComputedStyle(frame).visibility === "hidden" } : undefined;
});
say("a card's tab stays on the page behind a canvas, out of sight", !!cardFrame && away?.mark === "card" && away.hidden === true, JSON.stringify(away));
await page.locator('.tab-chip[data-kind="card"] .tab-chip-name').first().click();
const again = await until(async () =>
	page.evaluate(() => {
		const frame = document.querySelector('.surface[data-surface="card"] iframe');
		return frame && getComputedStyle(frame).visibility !== "hidden" ? { mark: frame.dataset.mark } : undefined;
	}),
);
say("…and coming back to it is the same frame, not one made again", again?.mark === "card", JSON.stringify(again));

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
