/**
 * The camera, in the canvas frame: a zoom holds the point under the cursor, `0` and ⌘+ / ⌘− / ⌘0
 * are the canvas's, and what a zoom does that a pan does not.
 *
 * What this checked of boards' pages (the focus inside a board, its embeds, a file changed on disk
 * reaching its frame, documents kept for a board that left the screen, a middle-drag over one, a
 * pan not reloading them) went with the pages themselves (d7906b45): a board is only its picture.
 */
import { canvasFrame, deckState, liveZoom, onCanvasAt, open, say, settle, still } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900 });
const canvas = await canvasFrame(page);
/** A point on bare canvas, in the middle of it: no item under it in the frame, and none of the page's chrome over it. */
const bareSpot = async () => {
	const candidates = await canvas.evaluate(() => {
		const stage = document.querySelector(".stage").getBoundingClientRect();
		const out = [];
		for (let y = Math.round(stage.top + 120); y < stage.bottom - 200; y += 16)
			for (let x = Math.round(stage.left + 340); x < stage.right - 160; x += 16) {
				const hit = document.elementFromPoint(x, y);
				if (!hit?.closest(".card-node, .v3-tools, .pen-tools, .card-callout, .v3-zoom, [class*='zoom']")) out.push({ x, y });
				if (out.length > 40) return out;
			}
		return out;
	});
	for (const at of candidates) if (await onCanvasAt(page, at.x, at.y)) return at;
	return null;
};

// 1. Zoom about a point keeps that point under the cursor.
//
// Measured from the camera rather than from an item's rendered size: a fractional zoom
// rounds the frame's layout to device pixels, which added a pixel or two of noise to what
// is otherwise an exact property.
const anchor = await canvas.evaluate(async () => {
	const stage = document.querySelector(".stage");
	const rect = stage.getBoundingClientRect();
	const cursor = { x: 420, y: 300 };
	const camera = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			globalThis.__decksCameraTransform(),
		);
		return { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	};
	const worldUnderCursor = () => {
		const c = camera();
		return { x: (cursor.x - rect.width / 2) / c.zoom + c.x, y: (cursor.y - rect.height / 2) / c.zoom + c.y };
	};
	const before = worldUnderCursor();
	for (let i = 0; i < 6; i++) {
		stage.dispatchEvent(
			new WheelEvent("wheel", {
				deltaY: -60,
				ctrlKey: true,
				clientX: rect.left + cursor.x,
				clientY: rect.top + cursor.y,
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
	const after = worldUnderCursor();
	return { drift: { x: Math.abs(after.x - before.x), y: Math.abs(after.y - before.y) }, zoom: camera().zoom };
});
say(
	"zoom holds the point under the cursor",
	anchor.drift.x < 0.01 && anchor.drift.y < 0.01,
	`drift ${anchor.drift.x.toFixed(4)}/${anchor.drift.y.toFixed(4)} world px at ${anchor.zoom.toFixed(2)}x`,
);

/*
 * 2. `0` fits everything. Clicked in the middle, not the corner: the corner is where the floating
 * panels live, and a click there summons one over the very point being clicked.
 *
 * **Bare stage, hit-tested rather than guessed.** Whether a board is under a given point depends
 * on the arrangement and on how the fit framed it — and a click that lands in a board goes into
 * *that document*, so every keystroke after it arrives there instead of here. That is a real
 * check (it is the one three sections down, deliberately), so here it is a precondition: the
 * point is found, and the assertion below says out loud that the focus is on the canvas. Without
 * it the failure surfaced as "nothing arrived" — about the key, three assertions later, saying
 * nothing about why.
 */
const bare = await bareSpot();
if (bare) await page.mouse.click(bare.x, bare.y);
say(
	"the canvas has the focus, not a board",
	await canvas.evaluate(() => document.activeElement === document.querySelector(".stage") || !document.activeElement?.closest(".card-node")),
	`clicked ${JSON.stringify(bare)}`,
);
await page.keyboard.press("0");
// The fit glides, and on a busy machine the glide outlasts a fixed wait.
await still(page);
await settle(page, 400);
const fitted = await canvas.evaluate(() => {
	const stage = document.querySelector(".stage").getBoundingClientRect();
	// Every board, with a node or as a picture on the sheet (below the live zoom it has no node).
	const nodes = window.__decksCards().map((one) => one.rect);
	return {
		inside: nodes.every(
			(r) => r.left >= stage.left - 2 && r.right <= stage.right + 2 && r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2,
		),
		count: nodes.length,
		level: document.querySelector('.v3-zoom-value').textContent,
	};
});
// The count comes from the deck, not a literal: this asserted 3 and started failing the
// moment an agent added a fourth board to the fixture, which is not what it tests.
const expected = (await deckState()).boards.length;
say("0 fits every board on screen", fitted.inside && fitted.count === expected, `${fitted.count}/${expected} boards at ${fitted.level}`);

/*
 * 2b. ⌘+ / ⌘− / ⌘0 are the canvas's, not the browser's.
 *
 * Chrome binds these to page zoom, which enlarges the whole app — chat column and chrome
 * with it — and leaves the camera exactly where it was. Taking them needs `preventDefault`
 * on a keystroke Chrome would rather have, so this asserts the outcome the unit test cannot:
 * that the browser honoured the refusal and the camera actually moved.
 *
 * Ctrl rather than ⌘ because the check runs on Linux, and the two are one gesture in
 * `zoom-keys.ts`. The key sent is `Equal`, which is the case that made this a bug: the key
 * labelled `+` is `=` unshifted, so a handler matching `"+"` never fired.
 */
const zoomOf = () =>
	canvas.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(globalThis.__decksCameraTransform())?.[1] ?? 0));

const fittedZoom = await zoomOf();
await page.keyboard.press("Control+Equal");
await settle(page, 400);
const zoomedIn = await zoomOf();
say("⌘+ zooms the canvas instead of the page", zoomedIn > fittedZoom * 1.1, `${fittedZoom.toFixed(3)} → ${zoomedIn.toFixed(3)}`);

await page.keyboard.press("Control+Minus");
await settle(page, 400);
const zoomedOut = await zoomOf();
say("…⌘− the other way", zoomedOut < zoomedIn * 0.95, `${zoomedIn.toFixed(3)} → ${zoomedOut.toFixed(3)}`);

await page.keyboard.press("Control+Digit0");
await settle(page, 500);
const refit = await zoomOf();
say("…and ⌘0 fits everything again", Math.abs(refit - fittedZoom) < 0.01, `${refit.toFixed(3)} vs ${fittedZoom.toFixed(3)}`);

/*
 * And the refusal itself, which is the half a camera reading cannot see. Without
 * `preventDefault` Chrome zooms the page *as well* — the camera would still move and this
 * check would still pass, while the app quietly grew a step every time somebody pressed it.
 */
/*
 * Installed and *confirmed* installed before the key is pressed.
 *
 * This started an `evaluate` and did not await it, because the promise it returns cannot
 * settle until the key arrives — which left the keystroke free to beat the listener. It did, on
 * two runs of the whole suite out of three, and the verdict was the string "nothing arrived":
 * a failure that says nothing about whether the app declined the zoom. So the listener now
 * writes its verdict down and returns at once, the press follows an *awaited* install, and the
 * verdict is waited for rather than assumed.
 */
await canvas.evaluate(() => {
	window.__declined = undefined;
	addEventListener("keydown", (event) => {
		// The modifier arrives as a keydown of its own and is nobody's shortcut, so the answer
		// comes from the key after it rather than from `Control`.
		if (event.key === "Control" || event.key === "Meta" || event.key === "Shift") return;
		window.__declined = event.defaultPrevented;
	});
});
await page.keyboard.press("Control+Equal");
await canvas.waitForFunction(() => window.__declined !== undefined, null, { timeout: 3000 }).catch(() => {});
const verdict = await canvas.evaluate(() => window.__declined);
say("…and the browser's own page zoom is declined", verdict === true, String(verdict ?? "nothing arrived"));
await page.keyboard.press("Control+Digit0");
await settle(page, 400);
await liveZoom(page);

// 5. What a zoom does that a pan does not, and what it now costs.
/*
 * Moving the camera is a transform over pictures the compositor already holds. Changing
 * its *scale* asks every board to be drawn again at a size it has never been drawn at —
 * a board being a whole document — and every title bar to be laid out again, because a
 * bar is counter-scaled and so its width and offset are functions of the zoom. Measured
 * on twelve boards at 4× CPU throttle, that was 134ms of work per finger movement while
 * pinching against 69ms while panning.
 *
 * Two mechanisms answer it, and both are here because neither shows up in a screenshot:
 * the boards go on layers of their own while the scale is moving, and a board that is off
 * screen does not draw a title bar at all.
 */
/*
 * A click on bare canvas first, so the key lands in the stage and the flag is read in the same breath.
 */
const bareNow = await bareSpot();
if (bareNow) await page.mouse.click(bareNow.x, bareNow.y);
await settle(page, 200);
await page.keyboard.press("Control+Equal");
const whileZooming = await canvas.evaluate(() => document.querySelector(".stage").dataset.scaling);
say("a zoom says the scale is moving, so the boards can go on layers", whileZooming === "true", `data-scaling=${whileZooming}`);
await settle(page, 900);
const atRest = await canvas.evaluate(() => document.querySelector(".stage").dataset.scaling);
// Held only while it is moving: a layer is a texture kept in memory, and a deck of them
// held for the life of the page is memory nobody asked for.
say("…and gives the layers back once it stops", atRest === "false", `data-scaling=${atRest}`);

const beforePan = await canvas.evaluate(() => document.querySelector(".stage").dataset.scaling);
await page.mouse.move(700, 400);
await page.mouse.wheel(0, 120);
await settle(page, 120);
const whilePanning = await canvas.evaluate(() => document.querySelector(".stage").dataset.scaling);
say("a scroll that only moves the camera does not ask for them", beforePan === "false" && whilePanning === "false", `${beforePan} -> ${whilePanning}`);

/*
 * And the world carries no `will-change` at rest or while the scale moves — which is the fix for a
 * board being soft at high zoom, and these assertions are here so nobody makes it permanent again.
 *
 * The declaration is a promise: hold the raster, apply the camera as a matrix. Across a zoom that
 * is the same picture stretched, which is what a board looked like at 400% on a 2× display until
 * it was taken off. A pan at one zoom is the one move where the matrix is exact, so the world
 * holds the promise then (`data-sliding`, `canvas.css`) and drops it in the frame a zoom starts.
 * A gesture-wide version was tried and reverted for flashing and for leaking past a change of
 * scale; this one was recorded frame by frame for flashes, at 22% and 60%, and found none.
 */
const promise = () =>
	canvas.evaluate(() => ({ world: getComputedStyle(document.querySelector(".world")).willChange }));
await settle(page, 400);
const resting = await promise();
say("at rest the world makes no promise, so a zoom is drawn at the size it is read at", resting.world === "auto", JSON.stringify(resting));

await page.mouse.move(700, 400);
await page.mouse.wheel(0, 120);
await settle(page, 60);
const whileMoving = await promise();
say("…a pan at one zoom holds one, to slide the world", whileMoving.world === "transform", JSON.stringify(whileMoving));
await settle(page, 400);
say("…and lets it go when the pan stops", (await promise()).world === "auto");
await page.keyboard.press("Control+Equal");
await settle(page, 150);
const onZoom = await promise();
say("…and a zoom does not either", onZoom.world === "auto", JSON.stringify(onZoom));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
