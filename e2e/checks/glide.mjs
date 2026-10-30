/**
 * A camera that arrives, and the hands it yields to.
 *
 * A row in the side panel glides the camera when it moves it (a link on a card is the same call,
 * `flyToBoards`): something *else* decided where to look — after a press or a link, a camera
 * that arrives says which way it went, where one that jumps leaves you to work out how the board
 * you are now looking at relates to the one you were reading.
 *
 * Everything else is instant, and that half is as much the point: a wheel, a pinch and a drag are
 * the person's own hands, and smoothing input is lag. So this measures from the **transform** —
 * not what the app says the camera is, but where the pixels actually are, frame by frame:
 *
 * - a row in the panel glides: intermediate frames exist, they lie between the two cameras, and
 *   the arrival is where it stops;
 * - a wheel mid-glide ends it within a frame, and the camera stays where the wheel put it;
 * - `prefers-reduced-motion` makes it instant and never says otherwise.
 *
 * The canvas is in its frame: the samples are taken there, frame by frame, while the row is pressed
 * on the page.
 */
import { canvasFrame, open, resetStage, say, settle, zoom } from "../harness.mjs";

// The panel's Canvas tab lists the boards on the canvas (`panel/LeftPanel.tsx`, `itemRow`); a board's row flies to it.
const { browser, page, errors } = await open({ width: 1500, height: 1000, panelTab: "canvas" });
await resetStage(page);
await settle(page, 600);

/**
 * Press something, then read the world transform every frame until `ms` has passed.
 *
 * The camera is read out of the world element's own transform, because that is the pixels. The
 * app's `camera()` is the *state*, which during a glide is where the view is going — worth
 * having, and not what a person sees.
 */
const watched = async (press, ms) => {
	const canvas = await canvasFrame(page);
	const sampling = canvas.evaluate(async (ms) => {
		const camera = () => {
			const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
				globalThis.__decksCameraTransform(),
			);
			return m ? { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) } : null;
		};
		const stage = document.querySelector(".stage");
		const before = camera();
		const samples = [];
		const start = performance.now();
		while (performance.now() - start < ms) {
			samples.push({ t: Math.round(performance.now() - start), gliding: stage.dataset.gliding === "true", ...camera() });
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		return { before, samples };
	}, ms);
	// The row is the page's, beside the frame.
	await page.evaluate((label) => [...document.querySelectorAll('.v3-item[data-kind="board"]')].find((row) => row.title === label)?.click(), press.label);
	return sampling;
};

/** A board's row in the Canvas tab, which is labelled with the board's name on the canvas rather than its file. */
const LABEL = { "risks.html": "Auth refresh — risks", "plan.html": "Auth refresh — the plan" };
const row = (name) => ({ kind: "row", name, label: LABEL[name] });
const same = (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

// --- a row in the panel -----------------------------------------------------------------

// 900 ms, not the glide's own length: frames a slow machine draws 45 ms apart left too few after the stop to see it.
const panel = await watched(row("risks.html"), 900);
const from = panel.samples[0];
const to = panel.samples.at(-1);
const flying = panel.samples.filter((sample) => sample.gliding);
const midway = flying.filter((sample) => !same(sample, from) && !same(sample, to));
const within = (a, b, v) => v >= Math.min(a, b) - 1e-6 && v <= Math.max(a, b) + 1e-6;
say(
	"a row in the panel glides to the board rather than jumping to it",
	flying.length >= 3 &&
		midway.length >= 3 &&
		midway.every((sample) => within(from.x, to.x, sample.x) && within(from.y, to.y, sample.y) && within(from.zoom, to.zoom, sample.zoom)),
	`${panel.samples.length} frames, ${midway.length} of them between the two cameras, ${flying.length ? flying.at(-1).t - flying[0].t : 0}ms in flight`,
);
say(
	"…and it arrives and stops: the last frames are the fit, and none of them moves",
	!to.gliding && panel.samples.slice(-4).every((sample) => same(sample, to)),
	JSON.stringify(to),
);

/*
 * And the readout is not a lie.
 *
 * The pill's percentage is drawn from the camera *signal*, which a glide raises once a frame. At
 * rest the pixels and the reading have to be the same number, and that is the whole argument for
 * writing the signal per frame rather than once at the end.
 */
const pill = await zoom(page);
say("…and at rest the pill's percentage is the pixels'", Math.abs(pill - to.zoom * 100) <= 1, `${pill}% against ${(to.zoom * 100).toFixed(1)}%`);

// --- the hand wins ----------------------------------------------------------------------

const stealing = (await canvasFrame(page)).evaluate(async () => {
	const camera = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			globalThis.__decksCameraTransform(),
		);
		return m ? { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) } : null;
	};
	const stage = document.querySelector(".stage");
	// The page presses the plan's row meanwhile: wait for the glide it starts, then a little into it.
	const until = performance.now() + 2000;
	while (stage.dataset.gliding !== "true" && performance.now() < until) await new Promise((resolve) => requestAnimationFrame(resolve));
	await new Promise((resolve) => setTimeout(resolve, 60));
	const midFlight = stage.dataset.gliding === "true";
	// A wheel over the canvas: the smallest thing a person does that moves the camera.
	stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
	/*
	 * A wheel's pan is a scrollBy of the stage, and the camera follows from the scroll event the
	 * browser sends before the next frame (`Stage.tsx`, `onWheel`; `camera/controller.ts`, `scrolled`),
	 * which is what ends the glide: so "within a frame" is read one frame on, not in the same task.
	 */
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const after = [];
	for (let i = 0; i < 14; i++) {
		after.push({ gliding: stage.dataset.gliding === "true", ...camera() });
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
	return { midFlight, after };
});
// Back to the plan: the camera is on risks.html after the reduced-motion-free row above, so this has somewhere to glide.
await page.evaluate(() => [...document.querySelectorAll('.v3-item[data-kind="board"]')].find((row) => row.title === "Auth refresh — the plan")?.click());
const stolen = await stealing;
const landed = stolen.after.at(-1);
say(
	"a wheel takes the camera back from a glide, within a frame",
	stolen.midFlight && !stolen.after[0].gliding && stolen.after.every((sample) => !sample.gliding),
	`in flight when wheeled: ${stolen.midFlight}, then ${stolen.after.slice(0, 3).map((sample) => sample.gliding).join(",")}`,
);
say(
	"…and the camera stays where the wheel left it rather than finishing the move",
	stolen.after.slice(-4).every((sample) => same(sample, landed)),
	JSON.stringify({ x: Math.round(landed.x), y: Math.round(landed.y), zoom: landed.zoom.toFixed(3) }),
);

// --- reduced motion ---------------------------------------------------------------------

await page.emulateMedia({ reducedMotion: "reduce" });
const calm = await watched(row("risks.html"), 200);
say(
	"with reduced motion it is instant, and never says it is gliding",
	// The samples start before the row is pressed: the last of them is where it went.
	!calm.samples.some((sample) => sample.gliding) && !same(calm.samples.at(-1), calm.before),
	`${JSON.stringify(calm.samples.at(-1))} from ${JSON.stringify(calm.before)}`,
);
await page.emulateMedia({ reducedMotion: null });

// --- and the default stays instant for input --------------------------------------------

const wheeled = await (await canvasFrame(page)).evaluate(async () => {
	const stage = document.querySelector(".stage");
	const said = [];
	for (let i = 0; i < 10; i++) {
		stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
		said.push(stage.dataset.gliding === "true");
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
	return said;
});
say("a wheel is still immediate: nothing about it glides", wheeled.every((gliding) => !gliding), wheeled.join(","));

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
