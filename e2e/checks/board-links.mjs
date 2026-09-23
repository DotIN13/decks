/**
 * A link on a board, which is never just a navigation.
 *
 * The frame a board is drawn in has no address bar and no back button, so following a link
 * inside it replaces the board being read with whatever the link points at — one board over
 * for a sibling board, and onto a foreign site for anything else. So `lib/board.js` refuses to
 * navigate and asks the app instead, and this check is the three answers:
 *
 * - a link to **another board in the deck** puts that board on the canvas, beside the one that
 *   linked to it, with both in view;
 * - a link to **somewhere else** — another site, or a file in the deck that is not a board —
 *   opens in a tab of its own;
 * - and in **edit mode** a link is part of the component under the pointer and does nothing,
 *   because a press there is how a component is dragged and a run of words is retyped.
 *
 * The same assertion ends every case, and it is the point of the whole feature: the board that
 * carried the link is still the board in the frame.
 */
import { editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

const { browser, context, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);

const SOURCE = "boards/plan.html";
const LINKED = "boards/risks.html";
const FILE = "assets/sketch.svg";

const link = await socket();

const onCanvas = () => page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path));
/** Where the frame is, as opposed to what it is *pointed* at: a navigation changes this and nothing else does. */
const where = () => page.evaluate((wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`).contentWindow.location.pathname, SOURCE);
const nodeBox = (path) =>
	page.evaluate((wanted) => {
		const node = document.querySelector(`.board-node[data-path="${wanted}"]`);
		return node ? { left: Number.parseFloat(node.style.left), top: Number.parseFloat(node.style.top), w: Number.parseFloat(node.style.width) } : null;
	}, path);
const frame = () => page.frameLocator(`.board-node[data-path="${SOURCE}"] iframe`);

/**
 * One board, alone, in front of the camera, and zoomed in far enough to click in it.
 *
 * Zoom is not politeness: below half zoom a board takes no pointer events at all — the frame is
 * inert so that a pan across it is a pan — so a click "inside" one lands on the canvas
 * underneath, and every assertion after it would be about a click that never reached the board.
 * That is not hypothetical here: opening the second board flies the camera out to hold both of
 * them, which is below the threshold, so this runs again before the tab half.
 */
const focus = async (path) => {
	for (const other of (await onCanvas()).filter((one) => one !== path)) link.send({ type: "board.hide", path: other });
	await settle(page, 500);
	await page.evaluate((wanted) => {
		const name = wanted.replace("boards/", "");
		[...document.querySelectorAll(".board-row")].find((row) => row.textContent?.includes(name))?.click();
	}, path);
	await settle(page, 900);
	for (let i = 0; i < 10; i++) {
		const level = await page.evaluate(() =>
			Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
		);
		if (level >= 70 && level <= 200) break;
		await page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
		await settle(page, 250);
	}
};

await focus(SOURCE);
const at = await where();
say("the fixture board is up, at its own address", at === `/api/board/${SOURCE}`, at);

// --- a link to another board -----------------------------------------------------------

await frame().locator('a[href="risks.html"]').click();
let arrived = true;
try {
	await page.waitForSelector(`.board-node[data-path="${LINKED}"]`, { timeout: 8000 });
} catch {
	arrived = false;
}
const shown = await onCanvas();
say("a link to a board puts that board on the canvas", arrived && shown.includes(LINKED), shown.join(" "));

/*
 * Beside the board that linked to it, not on top of it: 32px of canvas between the two, at the
 * same top. Both numbers come from the *record* rather than from the link, so this fails if the
 * board arrives anywhere else.
 */
const source = await nodeBox(SOURCE);
const placed = await nodeBox(LINKED);
const beside = Boolean(source && placed) && Math.abs(placed.left - (source.left + source.w + 32)) < 2 && Math.abs(placed.top - source.top) < 2;
say("…placed beside the board that linked to it", beside, JSON.stringify({ source, placed }));

/* And framed with it: a board opened where the camera is not looking is a board nobody read. */
const view = page.viewportSize();
const visible = async (path) => {
	const box = await page.locator(`.board-node[data-path="${path}"]`).boundingBox({ timeout: 2000 }).catch(() => null);
	return Boolean(box) && box.x < view.width && box.y < view.height && box.x + box.width > 0 && box.y + box.height > 0;
};
say("…with both boards in view", (await visible(SOURCE)) && (await visible(LINKED)));

const kept = await where();
say("…and the board that carried the link is still the board in the frame", kept === `/api/board/${SOURCE}`, kept);

// --- a link somewhere else --------------------------------------------------------------

/* Back to the one board: opening the other one zoomed out past the point a board takes clicks. */
await focus(SOURCE);

/**
 * A tab, and the URL it is pointed at. Never its load state: the fixture has no network.
 *
 * `context` rather than `page`, and that is the assertion working rather than a detail: one of
 * these tabs is opened by the *frame* — the app can only answer that a path is not a board, and
 * the frame is the half that still has the click's user activation — and the page-level popup
 * event is not promised for a page a frame opened.
 */
const tabFrom = async (selector) => {
	const opened = context.waitForEvent("page", { timeout: 8000 });
	await frame().locator(selector).click();
	const tab = await opened;
	await settle(page, 400);
	const url = tab.url();
	await tab.close();
	return url;
};

let external = "";
try {
	external = await tabFrom(`a[href^="https://"]`);
} catch (error) {
	external = `no tab: ${String(error).split("\n")[0]}`;
}
say("a link to another site opens in a tab, not in the board", external.startsWith("https://example.com"), external);

let file = "";
try {
	file = await tabFrom(`a[href$="${FILE}"]`);
} catch (error) {
	file = `no tab: ${String(error).split("\n")[0]}`;
}
say("a file that is not a board opens in a tab too", file.includes(FILE), file);

const after = await where();
say("…and neither of them moved the board", after === `/api/board/${SOURCE}`, after);

// --- a board link that leads nowhere ----------------------------------------------------

/*
 * A link to a board file the deck does not hold: a board the agent has not written yet, or a
 * file that is not a board at all. It is *not* opened in a tab — the frame decided it was a
 * board — so the app has to say what happened, in the one place it says anything briefly.
 */
await frame().locator('a[href="not-written-yet.html"]').click();
await settle(page, 900);
const notice = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((one) => one.textContent).join(" | "));
const appeared = (await onCanvas()).includes("boards/not-written-yet.html");
say("a board link the deck cannot open says so, and opens nothing", notice.includes("not-written-yet.html") && !appeared, notice || "(no notice)");
say("…and that did not move the board either", (await where()) === `/api/board/${SOURCE}`);

// --- and inert while editing ------------------------------------------------------------

link.send({ type: "board.hide", path: LINKED });
await settle(page, 600);
await editMode(page, true);
await frame().locator('a[href="risks.html"]').click({ force: true });
await settle(page, 1200);
const edited = await onCanvas();
say("in edit mode a link is part of the component, and does nothing", !edited.includes(LINKED), edited.join(" "));

// --- and from a presented board ---------------------------------------------------------

/*
 * The overlay draws its own frame rather than a `BoardFrame`, so it wires the same ask up
 * itself (`Present.tsx`) — and a board opened there has to end the presentation, because the
 * canvas it lands on is underneath the overlay.
 */
await editMode(page, false);
link.send({ type: "board.hide", path: LINKED });
await settle(page, 500);
await focus(SOURCE);
const presented = await page.evaluate((wanted) => {
	const button = document.querySelector(`.bar-layer .chrome[data-path="${wanted}"] .present-open`);
	if (!button) return false;
	button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
	button.click();
	return true;
}, SOURCE);
await settle(page, 900);
const overlay = await page.evaluate(() => Boolean(document.querySelector(".present")));
await page.frameLocator(".present .present-frame").locator('a[href="risks.html"]').click();
await settle(page, 1000);
const closed = await page.evaluate(() => !document.querySelector(".present"));
const landed = (await onCanvas()).includes(LINKED);
say("a link on a presented board opens it, and ends the presentation", presented && overlay && closed && landed, JSON.stringify({ presented, overlay, closed, landed }));

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
