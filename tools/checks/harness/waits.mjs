// The checks' waits: for the canvas to settle, and for a file or the drawing to change. Never the clock.
import { read } from "./programs.mjs";

/**
 * The canvas frame (`iframe.canvas-frame`), once its canvas is drawn in it: where the canvas, its tools, its
 * zoom bar and its popovers are. Made again when the conversation moves to another canvas, so a
 * check asks for it again after a switch rather than keeping the one it had.
 */
export async function canvasFrame(page, { timeout = 30000 } = {}) {
	const deadline = Date.now() + timeout;
	for (;;) {
		const frame = page.frames().find((one) => !one.isDetached() && one.url().includes("canvas-frame.html"));
		if (frame && (await frame.evaluate(() => !!document.querySelector(".stage")).catch(() => false))) return frame;
		if (Date.now() > deadline) throw new Error("the canvas frame never drew its canvas");
		await page.waitForTimeout(100);
	}
}

/**
 * Wait until the canvas has drawn: the stage's sheet shown, or the Rust engine's first frame; then,
 * for a moment, for the items awake near the window (cards, documents, apps) to show their surfaces
 * (`item-slot.tsx`, `data-inert` until then). A board is only ever its picture.
 */
export async function ready(page, { timeout = 30000 } = {}) {
	const canvas = await canvasFrame(page, { timeout });
	await canvas.waitForFunction(
		() => document.querySelector(".stage-sheet")?.hidden === false || (globalThis.__decksProbes?.sheet?.shown ?? 0) > 0,
		null,
		{ timeout, polling: 100 },
	);
	await canvas.waitForFunction(() => [...document.querySelectorAll(".card-node")].every((node) => node.dataset.inert !== "true"), null, { timeout: 5000, polling: 100 }).catch(() => {});
}

/**
 * Wait for the camera to stop moving.
 *
 * A press at a coordinate is only about the thing under it. A camera that *arrives* rather than
 * jumping adds a way to be wrong about that: measure a box while the view is still gliding and the
 * press lands wherever the box has got to by then. `data-gliding` is the canvas's own answer.
 */
export async function still(page, { timeout = 5000 } = {}) {
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => document.querySelector(".stage")?.dataset.gliding !== "true", null, { timeout });
}

/**
 * Wait for the camera to come to rest after something that *may* move it — a Fit, a `1`, a click
 * on a card — instead of a fixed pause long enough for the longest glide.
 *
 * Two steps, because the move may not have begun when this is called: up to `start` ms for it to
 * begin (and if it never does, nothing moved), then for it to end; then one frame for whatever
 * reads layout.
 */
export async function rest(page, { start = 300, timeout = 6000 } = {}) {
	const canvas = await canvasFrame(page);
	const moving = (want) => {
		const stage = document.querySelector(".stage")?.dataset;
		return (stage?.gliding === "true" || stage?.moving === "true") === want;
	};
	// (Playwright reads a timeout of 0 as "forever", so `start: 0` skips the first step instead.)
	if (start > 0) await canvas.waitForFunction(moving, true, { timeout: start, polling: "raf" }).catch(() => {});
	await canvas.waitForFunction(moving, false, { timeout, polling: "raf" });
	await canvas.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** A short settle for things with no observable signal — a CSS transition, mostly. */
export function settle(page, ms = 350) {
	return page.waitForTimeout(ms);
}

/**
 * Where two versions of a file differ, as a **byte range** rather than a line count.
 *
 * This replaces two assertions that counted lines:
 *
 *     after.split("\n").filter((line, index) => line !== before[index])
 *
 * and called the result "moves one line of the file". It does not measure that, and the reason is
 * worth writing down because the shape of the mistake is easy to repeat. Measured on `boards/notes.html`,
 * one retyped paragraph reported **24** — and 24 is `42 - 18`: the file had 44 lines before and 42 after,
 * so from the deletion at line 18 **every line after it differs at its own index**. The count is the
 * *position* of an edit in the file, not its size, and it moves when the file's length moves.
 *
 * That made a real fix look like a failure. The editor collapses a run's wrapping when it opens it, so
 * that the words being typed are the words in the file rather than the file's indentation — which turns a
 * five-line paragraph into one line, deliberately. A line count can only report that as "the rest of the
 * file changed".
 *
 * What is worth asserting is a region: which bytes differ, and whether they lie inside the node the editor
 * says it is editing. This finds that region the only way it can be found without a diff library — the
 * longest common prefix and the longest common suffix — and returns offsets into the *old* file, which is
 * the version the node's byte range comes from.
 */
export function differ(before, after) {
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let tail = 0;
	while (
		tail < before.length - start &&
		tail < after.length - start &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	)
		tail++;
	return {
		start,
		/** One past the last changed byte, in the old file and in the new one. */
		endBefore: before.length - tail,
		endAfter: after.length - tail,
		/** The changed text on each side, so a detail line can show it. */
		before: before.slice(start, before.length - tail),
		after: after.slice(start, after.length - tail),
		lines: { before: before.split("\n").length, after: after.split("\n").length },
		/** Open tags on each side: a bound on markup the edit added or removed. */
		tags: { before: (before.match(/<[a-zA-Z]/g) ?? []).length, after: (after.match(/<[a-zA-Z]/g) ?? []).length },
	};
}

/**
 * Wait for the file on disk to change, instead of sleeping and hoping.
 *
 * A write travels board → server → watcher → client, so "did the edit land" is a
 * condition with no fixed duration.
 */
export async function changed(file, was, { timeout = 15000 } = {}) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const now = read(file);
		if (now !== was) return now;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`${file} did not change within ${timeout}ms`);
}
