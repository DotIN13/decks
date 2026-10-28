/**
 * A → B → A: does a canvas come back where you left it?
 *
 * The person reports being displaced on the canvas they return to, even when nothing happened on
 * it while they were away. This reads the camera itself at each step of the round trip, so the
 * answer is a number rather than an impression.
 */
import { open, resetStage, say, settle, socket, rest } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const link = await socket();
const focused = await until(() => link.last("agents")?.focused);

/** The camera, read off the world's own transform, which is what the eye sees. */
const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(globalThis.__decksCameraTransform());
		return m ? { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) } : null;
	});

const wallName = (wall, title) => wall.find((one) => one.title === title)?.name ?? wall.find((one) => !one.here)?.name ?? "";
const pillStage = () => page.evaluate(() => document.querySelector(".pill [aria-label^='Canvases']")?.textContent?.trim() ?? null);
const cards = () => page.evaluate(() => [...document.querySelectorAll(".stage-card")].map((card) => ({ name: card.dataset.name, title: card.querySelector(".row-label")?.textContent?.trim() ?? null, here: card.dataset.here ?? null })));
/* The pill opens the canvas switcher (`canvas/CanvasSwitcher.tsx`); its All canvases row opens the manager. */
const openManager = async () => {
	await page.locator(".pill [aria-label^='Canvases']").click();
	await page.getByRole("menuitem", { name: "All canvases" }).click();
	await page.waitForSelector(".stage-manager", { timeout: 6000 });
};
const pick = async (name) => {
	await openManager();
	await page.locator(`.stage-card[data-name="${name}"]`).click();
	await settle(page, 2500);
};

const onA = await pillStage();
say("this conversation starts on a canvas with boards on it", !!onA, String(onA));

/*
 * A camera of the person's own on A: zoomed in, where a board is read, which is the state the
 * complaint is about. Set by wheel rather than by any internal call, so it is the same camera a
 * hand would have made. Ctrl with the wheel is the zoom; the wheel alone is a pan.
 */
await page.mouse.move(700, 450);
await page.keyboard.down("Control");
for (let i = 0; i < 10; i++) {
	await page.mouse.wheel(0, -120);
	await settle(page, 80);
}
await page.keyboard.up("Control");
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(520, 360, { steps: 8 });
await page.mouse.up();
await settle(page, 1200);
const mine = await camera();
say("the person sets a camera on A, zoomed in to read", !!mine && mine.zoom > 1, JSON.stringify(mine));

/*
 * B is an empty canvas, which is the case that matters: arriving somewhere with no remembered view
 * starts a poller that waits up to six seconds for boards to appear before fitting them, and an
 * empty canvas never satisfies it. Making one opens it, which is the switch.
 */
await openManager();
await page.locator(".stage-new").first().click();
await page.fill(".stage-new-field", "Second canvas");
await page.locator(".stage-new-form button[type=submit]").click();
/*
 * Barely any wait. The poller gives up after 1.2 s and then acts whatever it finds, so the window
 * to be inside is that one — a quick there-and-back, which is what a person does when they switch
 * to the wrong canvas.
 */
// As soon as the pill says B: on a busy machine the switch itself can take longer than the quick 250 ms this was.
let onB = await pillStage();
for (const deadline = Date.now() + 4000; onB === onA && Date.now() < deadline; onB = await pillStage()) await settle(page, 100);
say("a new, empty canvas opens as B", onB !== onA, JSON.stringify({ onA, onB }));

// Back to A at once — inside the window the poller is still waiting in.
await openManager();
const backTo = wallName(await cards(), onA);
await page.locator(`.stage-card[data-name="${backTo}"]`).click();
await settle(page, 400);
say("the pill says A again", (await pillStage()) === onA, `${await pillStage()}`);
const back = await camera();
const drift = mine && back ? { dx: Math.round(Math.abs(back.x - mine.x)), dy: Math.round(Math.abs(back.y - mine.y)), zoom: `${mine.zoom} → ${back.zoom}` } : null;
say("A comes back where it was left", !!drift && drift.dx < 40 && drift.dy < 40 && back.zoom === mine.zoom, JSON.stringify(drift));

/*
 * And it stays there. The poller that was started for B fires up to six seconds later and reads
 * the boards of whatever canvas is current by then, so the displacement can arrive after the
 * switch has visibly finished.
 */
await settle(page, 6000);
const later = await camera();
const after = mine && later ? { dx: Math.round(Math.abs(later.x - mine.x)), dy: Math.round(Math.abs(later.y - mine.y)), zoom: `${mine.zoom} → ${later.zoom}` } : null;
say("…and is still there a few seconds later", !!after && after.dx < 40 && after.dy < 40 && later.zoom === mine.zoom, JSON.stringify(after));

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
