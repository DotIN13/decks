/**
 * A link on a board, which is never just a navigation.
 *
 * The frame a board is drawn in has no address bar and no back button, so following a link
 * inside it replaces the board being read with whatever the link points at — one board over
 * for a sibling board, and onto a foreign site for anything else. So `lib/board.js` refuses to
 * navigate and asks the app instead, and this check is the answers:
 *
 * - a link to **another board in the deck** puts that board on the canvas, beside the one that
 *   linked to it, with both in view;
 * - and a link to **somewhere else** — another site, or a file in the deck that is not a board —
 *   opens in a tab of its own.
 *
 * (There was a fourth, "in edit mode a link does nothing": a board's page is no longer edited from
 * the canvas, so there is no such mode to be inert in, and that case went with it.)
 *
 * The same assertion ends every case, and it is the point of the whole feature: the board that
 * carried the link is still the board in the frame.
 */
import { open, resetStage, say, settle, socket, stagePath } from "../harness.mjs";

const { browser, context, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);

/*
 * The canvas's copies (`canvases/<canvas>/boards/…`), which is what the stage shows: a board placed
 * on a canvas is copied into the canvas's folder, and a link to the library file lands on the copy.
 */
const SOURCE = await stagePath(page, "boards/plan.html");
const LINKED = await stagePath(page, "boards/risks.html");
const fileName = (path) => path.split("/").pop();
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
 * Opening the second board takes the camera to *that* board, so it stays above the threshold;
 * this runs again between the halves anyway, because each one starts from one board alone.
 */
const focus = async (path) => {
	for (const other of (await onCanvas()).filter((one) => one !== path)) link.send({ type: "board.hide", path: other });
	await settle(page, 500);
	await page.evaluate((wanted) => {
		[...document.querySelectorAll(".board-row")].find((row) => row.textContent?.includes(wanted))?.click();
	}, fileName(path));
	await settle(page, 900);
	for (let i = 0; i < 10; i++) {
		const level = await page.evaluate(() =>
			Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
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

// The copy's links are rewritten to reach the library from the canvas folder, so matched by their end.
await frame().locator('a[href$="risks.html"]').click();
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
/*
 * The copy arrives first where the server's own rule puts it and is then moved beside the source,
 * so the place is waited for — and then read again a second later, so a move that is undone by a
 * later frame still fails.
 */
const besideOf = (a, b) => Boolean(a && b) && Math.abs(b.left - (a.left + a.w + 32)) < 2 && Math.abs(b.top - a.top) < 2;
for (let i = 0; i < 20 && !besideOf(await nodeBox(SOURCE), await nodeBox(LINKED)); i++) await settle(page, 150);
await settle(page, 1000);
const source = await nodeBox(SOURCE);
const placed = await nodeBox(LINKED);
const beside = besideOf(source, placed);
say("…placed beside the board that linked to it", beside, JSON.stringify({ source, placed }));

/*
 * And framed: a board opened where the camera is not looking is a board nobody read.
 *
 * **The board that was asked for, and only it.** The camera used to fit the pair, so that you
 * could see what the new board had arrived beside — and two boards side by side fit at half the
 * zoom of one, which on this viewport is under the half-zoom line where a board stops taking
 * pointer events at all. So the thing the link was followed for landed too small to read and
 * too small to click into. Both halves are asserted, because "in view" alone passed before.
 */
const view = page.viewportSize();
const visible = async (path) => {
	const box = await page.locator(`.board-node[data-path="${path}"]`).boundingBox({ timeout: 2000 }).catch(() => null);
	return Boolean(box) && box.x < view.width && box.y < view.height && box.x + box.width > 0 && box.y + box.height > 0;
};
say("…with the board it opened in view", await visible(LINKED));
const zoom = () => page.evaluate(() => Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
const level = await zoom();
say("…and close enough to read and to click into, which the pair never was", level >= 50, `${level}%`);

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
await frame().locator('a[href$="not-written-yet.html"]').click();
await settle(page, 900);
const notice = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((one) => one.textContent).join(" | "));
const appeared = (await onCanvas()).some((path) => path.endsWith("/not-written-yet.html"));
say("a board link the deck cannot open says so, and opens nothing", notice.includes("not-written-yet.html") && !appeared, notice || "(no notice)");
say("…and that did not move the board either", (await where()) === `/api/board/${SOURCE}`);

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
