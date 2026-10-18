/**
 * Zoomed in briefly and out again, every board out of the live zoom is drawn by its picture.
 *
 * A page that went to sleep in the same moment it came up said "off" before its "on" reached the
 * stage's count of live boards: the off found nothing to take away and was dropped, the on landed,
 * and the board stayed counted live with a sleeping page. The engine leaves a live board to its
 * page, so it drew nothing there at all, until a reload. Zooming in for 300 ms and back out left
 * one to three boards empty every time.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deckState, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

// More boards than a desktop keeps pages for (`KEPT_PAGES`, 32), so pages come and go as the camera moves.
const deck = await deckState();
const page0 = readFileSync(`${deck.path}/boards/notes.html`, "utf8");
const made = Array.from({ length: 40 }, (_, i) => `boards/many-${String(i).padStart(2, "0")}.html`);
for (const path of made) writeFileSync(`${deck.path}/${path}`, page0);
await resetStage();
{
	const link = await socket();
	made.forEach((path, i) => {
		link.send({ type: "board.play", path });
		link.send({ type: "board.move", path, x: 3000 + (i % 8) * 1100, y: (i >> 3) * 900 });
	});
	await new Promise((resolve) => setTimeout(resolve, 1500));
	link.close();
}
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
await page.waitForFunction(() => window.__decksRust?.page && (window.__decksBoards?.().length ?? 0) > 0, null, { timeout: 30000 });
await settle(page, 1500);

const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform).a);
const zoomTo = async (target, x, y, step, gap) => {
	await page.mouse.move(x, y);
	for (let i = 0; i < 200; i++) {
		const z = await zoomNow();
		if (Math.abs(Math.log(z / target)) < 0.04) break;
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, z < target ? -Math.min(step, 400 * Math.log(target / z)) : Math.min(step, 400 * Math.log(z / target)));
		await page.keyboard.up("Control");
		await page.waitForTimeout(gap);
	}
};
/** Boards the engine leaves to their page while that page is asleep or gone: drawn as nothing. */
const holes = () =>
	page.evaluate(() =>
		window.__decksRust.boards
			.filter((board) => board.live)
			.filter((board) => {
				const frame = document.querySelector(`.world iframe[data-path="${CSS.escape(board.path)}"]`);
				return !frame || !!frame.closest("[data-dormant]") || getComputedStyle(frame.closest(".surface") ?? frame).contentVisibility === "hidden";
			})
			.map((board) => board.path),
	);

// Every board in view, as the canvas looks fitted: far below the live zoom.
await page.keyboard.press("Control+0");
await settle(page, 3000);
const spots = [[0.3, 0.3], [0.7, 0.6], [0.5, 0.5], [0.2, 0.7], [0.8, 0.3], [0.4, 0.4]];
const found = [];
for (const [fx, fy] of spots) {
	await zoomTo(0.35, 1400 * fx, 900 * fy, 40, 30);
	await page.waitForTimeout(300);
	await zoomTo(0.06, 1400 * fx, 900 * fy, 60, 16);
	await settle(page, 3000);
	found.push(...(await holes()));
}
say("below the live zoom, no board is left to a sleeping page", found.length === 0, JSON.stringify([...new Set(found)]));

say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
