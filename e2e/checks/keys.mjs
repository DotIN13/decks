/**
 * Camera shortcuts keep working with focus inside a board.
 *
 * A board frame is its own document, so a keydown over it never reaches the stage. This
 * is the check that caught every shortcut dying the moment you clicked a board.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();
const zoom = async () => Number((await page.locator('.pill [aria-label^="Zoom"]').first().textContent()).replace("%", ""));
const waitForZoomChange = async (was) => {
	await page.waitForFunction(
		(previous) => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "").replace(/[^0-9.]/g, "")) !== previous,
		was,
		{ timeout: 5000 },
	);
	return zoom();
};

await page.evaluate(() => document.querySelector(".board-row")?.click());
await page.waitForFunction(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) > 40, null, { timeout: 8000 });

// Empty board space, not a component: clicking a component is handled by the editor,
// which calls preventDefault and so keeps focus where it was. Bare board gives the
// iframe focus, which is the case that used to swallow every shortcut.
//
// The frame to click is the one the row-click above flew to, not the first in the DOM.
// The panel lists "on the canvas" boards in the agent's held order, which is most-recently-
// touched first, so the row you clicked is a different board from the first frame on a deck
// that has been reset to show everything. The camera centres the clicked board, so the
// frame nearest the viewport centre is the one whose empty corner we want.
const box = await page.evaluate(() => {
	const frames = [...document.querySelectorAll(".board-node iframe")];
	const cx = innerWidth / 2;
	const cy = innerHeight / 2;
	let best;
	let distance = Infinity;
	for (const frame of frames) {
		const r = frame.getBoundingClientRect();
		const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
		if (d < distance) {
			distance = d;
			best = r;
		}
	}
	if (!best) throw new Error("no board frame to click");
	return { x: best.right, y: best.bottom };
});
await page.mouse.click(box.x - 30, box.y - 30);
await page.waitForFunction(() => document.activeElement?.tagName === "IFRAME", null, { timeout: 4000 });
say("focus is inside the board", (await page.evaluate(() => document.activeElement?.tagName)) === "IFRAME");

const z0 = await zoom();
await page.keyboard.press("0");
const z1 = await waitForZoomChange(z0);
say("0 fits all, with focus in a board", z1 < z0, `${z0}% → ${z1}%`);

await page.keyboard.press("1");
const z2 = await waitForZoomChange(z1);
say("1 fits the selected board", z2 > z1, `${z1}% → ${z2}%`);

await page.keyboard.press("-");
const z3 = await waitForZoomChange(z2);
say("- zooms out", z3 < z2, `${z2}% → ${z3}%`);

await page.keyboard.press("=");
const z4 = await waitForZoomChange(z3);
say("= zooms in", z4 > z3, `${z3}% → ${z4}%`);

// Typing into a component must keep its own keys: "0" belongs to the text, not the camera.
// This used to assert `before !== undefined`, which is true of everything.
const zoomBefore = await zoom();
const typed = await page.evaluate(() => {
	const frame = document.querySelector(".board-node iframe");
	const doc = frame.contentDocument;
	const element = doc.querySelector("[data-id]");
	element.contentEditable = "true";
	element.focus();
	element.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
	const editing = doc.activeElement === element;
	element.contentEditable = "false";
	return { editing };
});
await settle(page, 300);
say("a key typed into a component does not move the camera", typed.editing && (await zoom()) === zoomBefore, `still ${zoomBefore}%`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
