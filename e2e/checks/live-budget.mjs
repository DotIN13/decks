/**
 * One live-page budget, with each device's numbers (`packages/canvas/src/device.ts`): at most six
 * board pages show at once on a computer and one on an iPad or a phone, and none below the live zoom.
 *
 * The iPad is this browser told it is one, the way iPadOS tells a page: a Mac's platform with a
 * touch screen, which no Mac has.
 */
import { liveZoom, open, resetStage, say, settle } from "../harness.mjs";

const asIPad = () => {
	Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
	Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 });
};

for (const [kind, most, init] of [
	["a computer", 6, undefined],
	["an iPad", 1, asIPad],
]) {
	await resetStage();
	const { browser, page, errors } = await open({ width: 1500, height: 950, ...(init ? { init } : {}) });
	say(`${kind}: the boards are live pages`, await liveZoom(page));
	await settle(page, 2500);
	const shown = await page.evaluate(() => ({
		pages: document.querySelectorAll(".board-node:not([data-hidden-page]) iframe.plain-board-page").length,
		near: window.__decksBoards().filter((b) => b.rect.right > 0 && b.rect.left < innerWidth && b.rect.bottom > 0 && b.rect.top < innerHeight).length,
	}));
	say(`${kind}: at most ${most} page${most > 1 ? "s" : ""} showing, with ${shown.near} boards in view`, shown.pages >= Math.min(most, shown.near) && shown.pages <= most, JSON.stringify(shown));

	await page.mouse.move(750, 475);
	for (let i = 0; i < 14 && (await page.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")); i++) {
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, 40);
		await page.keyboard.up("Control");
		await settle(page, 400);
	}
	await settle(page, 1500);
	const out = await page.evaluate(() => document.querySelectorAll(".board-node:not([data-hidden-page]) iframe.plain-board-page").length);
	say(`${kind}: below the live zoom no page shows`, out === 0, `${out} showing`);
	say(`${kind}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}
