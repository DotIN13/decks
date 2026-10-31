/**
 * With the draw tool on, once a pencil has drawn, a finger pans the canvas and presses what is under it.
 *
 * The glass a stroke is drawn on (`StageInk.tsx`) had `touch-action: none` and lay over the whole
 * stage, so after drawing with a pencil a finger could neither pan (a pan is the stage's own scroll
 * now) nor reach a card. Once a pencil has been seen the glass lets fingers through and catches the
 * pencil on the stage instead. In Chromium's touch iPad, with CDP's pen (`pointerType: "pen"`) and
 * touch input:
 *
 * - a pencil stroke lands in the canvas file;
 * - a finger over the canvas finds the stage, not the glass;
 * - a one-finger drag moves the camera;
 * - a pencil stroke that starts over a card is a stroke too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANVAS, canvasFrame, deckState, open, rest, resetStage, say } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
const file = join(deck.path, "canvases", CANVAS, "canvas.pen");
/** Strokes in the canvas file: pen.dev paths the draw tool writes. */
const strokes = () => (readFileSync(file, "utf8").match(/"type":\s*"path"/g) ?? []).length;

const { browser, page, context, errors } = await open({ device: "iPad Pro 11 landscape" });
await rest(page, { start: 0 });
const canvas = await canvasFrame(page);
const cdp = await context.newCDPSession(page);
const box = await (await page.$("iframe.canvas-frame")).boundingBox();

await canvas.locator('.v3-tool[data-tool="pen"]').tap();
await canvas.waitForSelector(".stage-ink");

/** A pencil stroke, in page coordinates. */
const pencil = async (from, to) => {
	// Hovering first, as a pencil does, at the place it comes down.
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, button: "none", buttons: 0, pointerType: "pen" });
	await new Promise((resolve) => setTimeout(resolve, 100));
	await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: 0.5 });
	for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12, button: "left", buttons: 1, pointerType: "pen", force: 0.5 });
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
};
const scroll = () => canvas.evaluate(() => {
	const stage = document.querySelector(".stage");
	return stage ? `${Math.round(stage.scrollLeft)},${Math.round(stage.scrollTop)}` : "";
});

const at = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.8 };
const first = strokes();
await pencil(at, { x: at.x + 120, y: at.y + 30 });
say("a pencil stroke lands in the canvas file", !!(await until(() => strokes() > first)), `${first} → ${strokes()}`);
say("after a pencil stroke, the glass lets fingers through", await canvas.evaluate(() => !!document.querySelector(".stage-ink[data-pencil]")));

const glass = await canvas.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".stage-ink"), { x: box.width * 0.3, y: box.height * 0.4 });
say("a finger over the canvas finds the stage, not the glass", !glass);

const before = await scroll();
const from = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 };
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x - i * 15, y: from.y - i * 10 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const moved = await until(async () => (await scroll()) !== before, 3000);
say("a one-finger drag after the pencil moves the canvas", !!moved, `${before} → ${await scroll()}`);

// The middle of the part of a card on screen.
const card = await canvas.evaluate(() => {
	for (const node of document.querySelectorAll(".card-node")) {
		const r = node.getBoundingClientRect();
		// Clear of the bars floating over the canvas, top and bottom, and the tool column on the left.
		const x1 = Math.max(r.left, 120), y1 = Math.max(r.top, 140), x2 = Math.min(r.right, innerWidth - 40), y2 = Math.min(r.bottom, innerHeight - 180);
		if (x2 - x1 > 160 && y2 - y1 > 100) return { x: (x1 + x2) / 2 - 40, y: (y1 + y2) / 2 - 20 };
	}
	return null;
});
say("a card is on screen to start a stroke over", !!card);
if (card) {
	const start = { x: box.x + card.x, y: box.y + card.y };
	const had = strokes();
	await pencil(start, { x: start.x + 80, y: start.y + 40 });
	say("a pencil stroke starting over a card is a stroke", !!(await until(() => strokes() > had)), `${had} → ${strokes()}`);
}

say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
