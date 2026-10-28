/**
 * A page opens on its canvas's boards at once, not 3 s later.
 *
 * The arrival waited for a deck frame sent after it began, which a switch needs (the frame on hand may
 * still be the canvas being left) but the page's first landing does not: its deck frame came before
 * it began, so it waited out its 3 s cap over the empty origin (`App.tsx`, `landOn`).
 */
import { open, resetStage, say } from "../harness.mjs";

await resetStage();
// Opened without waiting for the canvas, then loaded again on the clock: the harness clears this browser's
// storage at each load, so there is no view kept from before to land on at once.
const { browser, page, errors } = await open({ width: 1400, height: 900, boards: false });
const started = Date.now();
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => typeof globalThis.__decksCameraTransform === "function", null, { timeout: 30000 });
await page.waitForFunction(() => (globalThis.__decksBoards?.().length ?? 0) > 0, null, { timeout: 30000 });
const boardsAt = Date.now() - started;
// Landed: the camera has left the origin it opens at (0, 0, 100%).
const landedAt = await page
	.waitForFunction(() => !/scale\(1\) translate\(-?0px, -?0px\)/.test(globalThis.__decksCameraTransform()), null, { timeout: 8000, polling: 25 })
	.then(() => Date.now() - started)
	.catch(() => undefined);
say("the page lands on its boards", landedAt !== undefined, `${landedAt} ms`);
say("…within 1.5 s of its boards arriving, not after the 3 s cap", landedAt !== undefined && landedAt - boardsAt < 1500, `boards at ${boardsAt} ms, landed at ${landedAt} ms`);
const inView = await page.evaluate(() => globalThis.__decksBoards().filter((b) => b.rect.right > 0 && b.rect.left < innerWidth && b.rect.bottom > 0 && b.rect.top < innerHeight).length);
say("…with its boards in view", inView > 0, `${inView} in view`);
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
