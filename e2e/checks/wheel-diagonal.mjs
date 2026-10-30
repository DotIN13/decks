/**
 * A slow two-finger diagonal pans along the fingers' line, not as a staircase.
 *
 * The stage pans by the wheel's own deltas (`Stage.tsx`, `onWheel`), and the browser keeps whole
 * pixels of each `scrollBy`: a trackpad's small steps (1.3 right and 0.9 down) lost their smaller
 * direction every step, so the pan went straight sideways until a step was big enough to move it.
 * The part below a pixel is carried to the next step now.
 */
import { canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900, boards: false, dpr: 2 });
await rest(page, { start: 0 });
await settle(page, 600);
const canvas = await canvasFrame(page);

const cameraNow = () =>
	canvas.evaluate(() => {
		const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(globalThis.__decksCameraTransform());
		return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
	});

for (const [dx, dy] of [[1.3, 0.9], [3.2, 2.1], [0.4, 0.7]]) {
	const before = await cameraNow();
	await canvas.evaluate(
		({ dx, dy }) => {
			const stage = document.querySelector(".stage");
			for (let i = 0; i < 30; i++) stage.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, clientX: 700, clientY: 450, bubbles: true, cancelable: true }));
		},
		{ dx, dy },
	);
	await settle(page, 300);
	const after = await cameraNow();
	// In screen pixels: what the fingers asked for is 30 steps of each delta.
	const moved = { x: (after.x - before.x) * after.zoom, y: (after.y - before.y) * after.zoom };
	const want = { x: 30 * dx, y: 30 * dy };
	const off = Math.max(Math.abs(moved.x - want.x), Math.abs(moved.y - want.y));
	const angle = (v) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
	say(
		`30 steps of ${dx} right and ${dy} down pan ${want.x.toFixed(0)} by ${want.y.toFixed(0)} px, within a pixel`,
		off <= 1.01,
		`moved ${moved.x.toFixed(1)} by ${moved.y.toFixed(1)} px, at ${angle(moved).toFixed(1)}° for ${angle(want).toFixed(1)}°`,
	);
}
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
