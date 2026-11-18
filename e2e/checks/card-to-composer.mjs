/**
 * A card dragged onto the composer is mentioned there, with the caret in the composer when the drag
 * starts (`frame/inside/options.ts`, `composer.mark`; `frame/outside/focus.ts`).
 *
 * The page takes a draft from the canvas frame only while the frame has the focus. A press that starts
 * a drag does not move the focus into the frame, so a card dragged in while the person was writing in
 * the composer, which is when a card is dragged in, was let go over a composer that said it would take
 * it, and nothing was added. The frame now takes the focus as the drag comes over the composer.
 *
 * What is checked: with words typed in the composer and the caret there, a card dragged from the
 * canvas onto the composer marks it as the place it will land, and let go it is a card's pill in the
 * composer, after the words; the card has not moved; and the composer has the caret again.
 */
import { canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1500, height: 950 });
const frame = await canvasFrame(page);
await rest(page);
// Zoomed out until the cards are pictures, as on a canvas with many cards: a press on one carries it.
for (let i = 0; i < 6 && (await page.evaluate(() => Number((document.querySelector(".v3-zoom-value")?.textContent ?? "0").replace(/[^0-9.]/g, "")))) > 40; i++) {
	await page.locator('[aria-label="Zoom out"]').click();
	await settle(page, 300);
}
await rest(page);
const cards = () => frame.evaluate(() => globalThis.__decksProbes.cards().map((one) => ({ path: one.path, x: one.rect.x, y: one.rect.y, w: one.rect.width, h: one.rect.height })));
const composer = await page.locator(".composer-box").boundingBox();
// A card whose picture is in the open: on the canvas, clear of the page's panel, bars and composer.
const pick = await until(async () => {
	for (const one of await cards()) {
		const at = { x: one.x + one.w / 2, y: one.y + one.h * 0.3 };
		if (at.x < 440 || at.x > 1420 || at.y < 100 || at.y > composer.y - 60) continue;
		const open = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.matches("iframe.canvas-frame") === true, [at.x, at.y]);
		const pictured = await frame.evaluate(([x, y, path]) => globalThis.__decksProbes.pictureAt(x, y) === path, [at.x, at.y, one.path]);
		if (open && pictured) return { ...one, at };
	}
});
say("a card's picture is on the canvas to drag", !!pick, JSON.stringify(pick ?? (await cards()).slice(0, 3)));

// The person is writing: words in the composer, the caret there.
const field = page.locator('.composer-box [data-slot="composer-input"]').first();
await field.click();
await page.keyboard.type("about ");
// For longer than the moment the page still counts the canvas as just left (`FOCUS_GRACE`, 2 s): writing takes that long.
await settle(page, 2600);
const writing = await page.evaluate(() => ({ inComposer: !!document.activeElement?.closest(".composer-box"), frame: document.activeElement?.tagName === "IFRAME" }));
say("the caret is in the composer, not on the canvas", writing.inComposer && !writing.frame, JSON.stringify(writing));

if (pick) {
	await page.mouse.move(pick.at.x, pick.at.y);
	await page.mouse.down();
	await page.mouse.move(pick.at.x + 20, pick.at.y + 30, { steps: 4 });
	await page.mouse.move(composer.x + composer.width / 2, composer.y + 20, { steps: 14 });
	// Held over it for a moment, as a hand is.
	await settle(page, 300);
	say("held over the composer, the composer says the card would be mentioned here", (await page.evaluate(() => document.querySelector(".composer-box")?.dataset.refer ?? null)) === "true");
	await page.mouse.up();
	const pill = await until(() => page.evaluate(() => {
		const one = document.querySelector('.composer-box [data-component="mention-pill"][data-kind="card"]');
		return one ? { id: one.dataset.mentionId, label: one.dataset.mentionLabel } : undefined;
	}), 4000);
	say("let go, the card is a pill in the composer", pill?.id === pick.path, JSON.stringify({ pill, wanted: pick.path }));
	const text = await page.evaluate(() => document.querySelector('.composer-box [data-slot="composer-input"]')?.textContent ?? "");
	say("…after the words that were there", /^about\s/.test(text), JSON.stringify(text.slice(0, 80)));
	const now = (await cards()).find((one) => one.path === pick.path);
	say("…and the card did not move: that was a mention, not a drag", !!now && Math.abs(now.x - pick.x) < 1 && Math.abs(now.y - pick.y) < 1, JSON.stringify({ was: [pick.x, pick.y], now: [now?.x, now?.y] }));
	await settle(page, 300);
	say("…and the composer has the caret again", await page.evaluate(() => !!document.activeElement?.closest(".composer-box")));
}

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
