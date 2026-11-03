/**
 * Keys pressed in a card are the card's, until Escape.
 *
 * A press inside a card puts the focus in it (its body takes the focus), and the keys typed then stay
 * in it (`items/input.ts`): its own scripts hear them, and the canvas's keys do nothing to it. Before,
 * the focus went to the canvas behind the card, so the arrows nudged the card and Backspace deleted it.
 * Here: a press on a card's words; the arrows, a letter, Space and Backspace leave the card where it is
 * and on the canvas, and reach the card's own root; ⌘0 still fits the canvas; Escape leaves the card,
 * still selected, and then an arrow nudges it and Backspace deletes it, as the canvas's keys do.
 */
import { canvasFrame, card, open, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
const frame = await canvasFrame(page);
await rest(page);
const path = card("plan");
await selectCard(page, path);
await settle(page, 1000);
const host = await frame.evaluate((wanted) => {
	const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
	const r = node?.querySelector(".card-host")?.getBoundingClientRect();
	return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
}, path);
say("the card is awake, with its page on the canvas", !!host, JSON.stringify(host));
const box = await (await frame.frameElement()).boundingBox();
const state = () =>
	frame.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		return { at: node ? `${node.style.left},${node.style.top}` : null, selected: node?.dataset.selected === "true", focusInCard: !!node && node.contains(document.activeElement) };
	}, path);

// Keys that reach the card: counted on the card's host, which a key from inside its closed root passes on its way out.
await frame.evaluate((wanted) => {
	const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
	const cardHost = node?.querySelector(".card-host");
	globalThis.__cardKeys = [];
	cardHost?.addEventListener("keydown", (event) => globalThis.__cardKeys.push(event.key), true);
}, path);

await page.mouse.click(box.x + host.x + host.w * 0.5, box.y + host.y + host.h * 0.6);
await settle(page, 400);
const before = await state();
say("a press on the card's words puts the focus in the card", before.focusInCard, JSON.stringify(before));
for (const key of ["ArrowRight", "ArrowDown", "t", "Space", "Backspace"]) await page.keyboard.press(key);
await settle(page, 600);
const after = await state();
say("the arrows, a letter, Space and Backspace leave the card where it was, on the canvas", after.at === before.at && after.at !== null, JSON.stringify({ before: before.at, after: after.at }));
const heard = await frame.evaluate(() => globalThis.__cardKeys);
say("…and reach the card", ["ArrowRight", "ArrowDown", "t", " ", "Backspace"].every((key) => heard.includes(key)), JSON.stringify(heard));

const zoomBefore = await frame.evaluate(() => globalThis.__decksProbes?.frameCamera?.()?.zoom ?? null);
await page.keyboard.press("ControlOrMeta+Minus");
await settle(page, 600);
const zoomAfter = await frame.evaluate(() => globalThis.__decksProbes?.frameCamera?.()?.zoom ?? null);
say("⌘− still zooms the canvas from inside the card", zoomBefore !== null && zoomAfter !== null && zoomAfter < zoomBefore, `${zoomBefore} → ${zoomAfter}`);

await page.keyboard.press("Escape");
await settle(page, 400);
const out = await state();
say("Escape leaves the card, which stays selected", !out.focusInCard && out.selected, JSON.stringify(out));
await page.keyboard.press("ArrowRight");
await settle(page, 500);
const nudged = await state();
say("then an arrow nudges the card, as the canvas's keys do", nudged.at !== out.at, JSON.stringify({ was: out.at, now: nudged.at }));
await page.keyboard.press("Backspace");
await settle(page, 800);
say("…and Backspace deletes it", (await state()).at === null);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
