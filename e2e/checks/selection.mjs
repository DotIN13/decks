/**
 * Which board is selected — by every way in, and above all by pressing the board itself.
 *
 * A board is drawn only as its picture now (no page of its own on the canvas), so what this asserts
 * is the rule left: **a press on a board's picture selects that board**, a press on another moves
 * the selection to it, and flying to a board selects it. The selected board is the one the pill
 * (`BoardCallout`) is over; its "New tab" link names the board's file.
 */
import { canvasFrame, card, flyToCard, nameOf, onCanvasAt, open, resetStage, say, settle, zoom } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000 });
await resetStage(page);
await settle(page, 800);
const canvas = await canvasFrame(page);

/** The board the pill is over, by its file name, or nothing. */
const selected = async () =>
	nameOf(await canvas.evaluate(() => {
		const pill = document.querySelector(".stage-fixed > .card-callout");
		const link = pill?.querySelector('a[aria-label="New tab"]')?.getAttribute("href") ?? "";
		return pill && link ? decodeURIComponent(link) : "";
	}));
const file = nameOf;

const first = card("plan");
await flyToCard(page, first);
await settle(page, 900);
say("flying to a board selects it", (await selected()) === file(first), (await selected()) || "nothing selected");

// Back out until two boards share the window.
for (let i = 0; i < 8 && (await zoom(page)) > 30; i++) {
	await page.mouse.move(800, 500);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, 120);
	await page.keyboard.up("Control");
	await settle(page, 300);
}

/** A point on a board's picture, clear of the page's chrome and of the pill. */
const pointOn = async (path) => {
	const points = await canvas.evaluate((wanted) => {
		const r = window.__decksCards?.().find((one) => one.path === wanted)?.rect;
		if (!r) return [];
		const out = [];
		for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const fx of [0.5, 0.3, 0.7]) {
			const x = r.x + r.width * fx, y = r.y + r.height * fy;
			if (x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2 && window.__decksPictureAt?.(x, y) === wanted && !document.elementFromPoint(x, y)?.closest(".card-callout")) out.push({ x, y });
		}
		return out;
	}, path);
	for (const at of points) if (await onCanvasAt(page, at.x, at.y)) return at;
	return undefined;
};
const paths = await canvas.evaluate(() => (window.__decksCards?.() ?? []).map((one) => one.path));
let other, at;
for (const path of paths) {
	if (path === first) continue;
	at = await pointOn(path);
	if (at) {
		other = path;
		break;
	}
}
if (other && at) {
	await page.mouse.click(at.x, at.y);
	await settle(page, 400);
	say("a press on a board's picture selects it", (await selected()) === file(other), `pressed ${other} at ${Math.round(at.x)},${Math.round(at.y)}, selected ${(await selected()) || "nothing"}`);
	const back = await pointOn(first);
	if (back) {
		await page.mouse.click(back.x, back.y);
		await settle(page, 400);
		say("…and pressing the first board moves the selection back", (await selected()) === file(first), (await selected()) || "nothing");
	} else say("…the first board is still on screen to press", false);
} else {
	say("two boards to press", false, "no other board's picture is on screen clear of the chrome");
}

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
