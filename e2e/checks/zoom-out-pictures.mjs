/**
 * Zooming out past the live zoom, the boards go from pages to their pictures with no white between.
 *
 * Each change of the boards the engine draws (the zoom crossing the live zoom is one) used to throw
 * away every server picture: the address it fetched carries a size (`&w=480`) and was compared with
 * the board's own, so they never matched, and each board was drawn as white paper until its picture
 * came back. A picture is now let go only when the board's own address changes, and the old one is
 * drawn until the new one arrives.
 */
import { liveZoom, open, resetStage, say, settle, rest } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
say("the boards are live pages to start", await liveZoom(page));
await page.waitForFunction(() => window.__decksRust?.page, null, { timeout: 15000 });
// Long enough for every live board's picture to be fetched and kept ready.
await settle(page, 2500);

const counts = await page.evaluate(() => {
	const page = window.__decksRust.page;
	window.__forgot = 0;
	window.__put = 0;
	const forget = page.forgetPicture.bind(page);
	page.forgetPicture = (...args) => {
		window.__forgot++;
		return forget(...args);
	};
	const put = page.putPicture.bind(page);
	page.putPicture = (...args) => {
		if (String(args[0]).startsWith("board:")) window.__put++;
		return put(...args);
	};
	return typeof page.forgetPicture === "function";
});
say("the engine's pictures can be watched", counts);

await page.mouse.move(700, 450);
for (let i = 0; i < 12 && (await page.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")); i++) {
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, 40);
	await page.keyboard.up("Control");
	await settle(page, 450);
}
const below = await page.evaluate(() => document.querySelector(".stage")?.dataset.live !== "true");
say("the camera is below the live zoom", below);
await settle(page, 1500);
const after = await page.evaluate(() => ({ forgot: window.__forgot, put: window.__put }));
say("no board's picture is thrown away on the way out", after.forgot === 0, JSON.stringify(after));

say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
