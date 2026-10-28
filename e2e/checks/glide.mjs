/**
 * A camera that arrives, and the hands it yields to.
 *
 * Two gestures glide when they move the camera: a row in the boards panel, and a link on a board.
 * Both are cases where something *else* decided where to look — after a press or a link, a camera
 * that arrives says which way it went, where one that jumps leaves you to work out how the board
 * you are now looking at relates to the one you were reading.
 *
 * Everything else is instant, and that half is as much the point: a wheel, a pinch and a drag are
 * the person's own hands, and smoothing input is lag. So this measures from the **transform** —
 * not what the app says the camera is, but where the pixels actually are, frame by frame:
 *
 * - a row in the panel glides: intermediate frames exist, they lie between the two cameras, and
 *   the arrival is where it stops;
 * - a link on a board glides the same way, because it is the same call;
 * - a wheel mid-glide ends it within a frame, and the camera stays where the wheel put it;
 * - `prefers-reduced-motion` makes it instant and never says otherwise.
 */
import { open, resetStage, say, settle } from "../harness.mjs";

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
const watched = (press, ms) =>
	page.evaluate(
		async ({ press, ms }) => {
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
			if (press.kind === "row") {
				[...document.querySelectorAll('.v3-item[data-kind="board"]')].find((row) => row.title === press.label)?.click();
			} else {
				const frame = document.querySelector(`.board-node[data-path$="/${press.path}"] iframe, .board-node[data-path="${press.path}"] iframe`);
				// The canvas copy writes its links back to the library (`../../../boards/risks.html`), so by the end of the href.
				frame?.contentDocument?.querySelector(`a[href$="${press.href}"]`)?.click();
			}
			while (performance.now() - start < ms) {
				samples.push({ t: Math.round(performance.now() - start), gliding: stage.dataset.gliding === "true", ...camera() });
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
			return { before, samples };
		},
		{ press, ms },
	);

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
const pill = await page.evaluate(() => Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("…and at rest the pill's percentage is the pixels'", Math.abs(pill - to.zoom * 100) <= 1, `${pill}% against ${(to.zoom * 100).toFixed(1)}%`);

// --- a link on a board ------------------------------------------------------------------

/*
 * The other gesture that glides, through the same `flyToBoards`. A frame below half zoom takes no
 * pointer events at all, so this zooms in on the source board first — the same thing
 * `board-links.mjs` does, and for the same reason.
 */
await watched(row("plan.html"), 400);
for (let i = 0; i < 8; i++) {
	const level = await page.evaluate(() => Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
	if (level >= 70 && level <= 260) break;
	await page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
	await settle(page, 200);
}
// The zoom steps above can still be gliding; the link's glide is measured from rest.
await page.waitForFunction(() => document.querySelector(".stage")?.dataset.gliding !== "true", null, { timeout: 5000 }).catch(() => {});
await settle(page, 200);
const viaLink = await watched({ kind: "link", path: "boards/plan.html", href: "risks.html" }, 700);
const linkFrames = viaLink.samples.filter((sample) => sample.gliding);
say(
	"a link on a board glides the same way",
	linkFrames.length >= 3 && linkFrames.some((sample) => !same(sample, viaLink.samples[0])),
	`${linkFrames.length} of ${viaLink.samples.length} frames in flight`,
);

// --- the hand wins ----------------------------------------------------------------------

const stolen = await page.evaluate(async () => {
	const camera = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			globalThis.__decksCameraTransform(),
		);
		return m ? { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) } : null;
	};
	const stage = document.querySelector(".stage");
	// Back to the plan: the link above has just flown the camera to risks.html, and pressing the board
	// the camera is already on has nowhere to glide to, so nothing was ever in flight to take back.
	[...document.querySelectorAll('.v3-item[data-kind="board"]')].find((row) => row.title === "Auth refresh — the plan")?.click();
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
	!calm.samples.some((sample) => sample.gliding) && !same(calm.samples[0], calm.before),
	`${JSON.stringify(calm.samples[0])} from ${JSON.stringify(calm.before)}`,
);
await page.emulateMedia({ reducedMotion: null });

// --- and the default stays instant for input --------------------------------------------

const wheeled = await page.evaluate(async () => {
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
