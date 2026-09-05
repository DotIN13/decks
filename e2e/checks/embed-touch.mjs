/**
 * A finger inside an HTML embed drives the canvas too (DESIGN §4, §7).
 *
 * `mobile.mjs` asserts the layer above: a finger on a *board* pans, because the board is
 * same origin and `frame-gestures.ts` can listen inside it. An embed is a third document
 * and sandboxed, so a one-finger drag over an embedded page moved nothing at all and two
 * fingers could not pinch. A page that opts in posts its fingers up (`lib/embed-guest.js`),
 * `board.js` re-emits them as `decks:embed-finger`, and this asserts the whole chain —
 * including the half that must *not* travel: a finger the page's own box can use.
 *
 * Driven with real touch through CDP, in a device context, because a mouse proves nothing
 * about any of it.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, context, errors } = await open({ device: "iPhone 15" });
const cdp = await context.newCDPSession(page);

const BOARD = '.board-node[data-path="boards/sources.html"]';

const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		return { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	});

/*
 * `force` and a radius, unlike `mobile.mjs`, which has neither and does not need them.
 * A sandboxed embed is a cross-origin frame and may well be a process of its own, and a
 * touch point with no pressure does not survive the hop into one: the events landed on
 * the board around it instead, which pans — a green pan for the wrong reason, and the
 * scroll assertion below is what caught it.
 */
const touch = (type, points) =>
	cdp.send("Input.dispatchTouchEvent", {
		type,
		touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id, radiusX: 2, radiusY: 2, force: 1 })),
	});

const swipe = async (fingers, delta, steps = 10) => {
	let points = fingers;
	await touch("touchStart", points);
	for (let step = 0; step < steps; step++) {
		points = points.map((point) => ({ x: point.x + delta.x / steps, y: point.y + delta.y / steps }));
		await touch("touchMove", points);
		await settle(page, 16);
	}
	await touch("touchEnd", []);
	await settle(page, 120);
};

/** Two fingers, from one spread to another about a fixed centre. */
const pinch = async (centre, from, to, steps = 12) => {
	const pair = (spread) => [
		{ x: centre.x - spread / 2, y: centre.y },
		{ x: centre.x + spread / 2, y: centre.y },
	];
	await touch("touchStart", pair(from));
	for (let step = 1; step <= steps; step++) {
		await touch("touchMove", pair(from + ((to - from) * step) / steps));
		await settle(page, 16);
	}
	await touch("touchEnd", []);
	await settle(page, 120);
};

// The sources board, alone and big enough for its embeds to be touched.
await page.evaluate(() => [...document.querySelectorAll(".board-row")].find((i) => i.textContent.includes("sources"))?.click());
await page.waitForFunction(
	() => {
		const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
		return (
			frame?.contentWindow?.__boardReady === true &&
			Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) > 10
		);
	},
	null,
	{ timeout: 20000 },
);
await page.waitForFunction(
	() =>
		document
			.querySelector('.board-node[data-path="boards/sources.html"] iframe')
			?.contentDocument?.querySelector('[data-id="live"].embed-guest') !== null,
	null,
	{ timeout: 10000 },
);

const inner = page.frameLocator(`${BOARD} iframe`).frameLocator('[data-id="live"] iframe');
const moved = (was, now) => Math.hypot(now.x - was.x, now.y - was.y);
const gesture = () => inner.locator("#go").evaluate(() => window.__gesture?.() ?? null);

/**
 * Zoom in until the frames take the pointer at all.
 *
 * `INTERACT_ZOOM` is 0.5, and a 1600px board fitted to a 393px phone lands at 21%: below
 * it every board is inert by design, so a touch anywhere goes to the stage and pans. That
 * made the pan and the pinch here pass for entirely the wrong reason — the embed never saw
 * a finger — and only the scroll assertion, which needs the *page* to act, caught it. So
 * the zoom is asserted rather than assumed.
 */
const zoomIn = async (wanted) => {
	for (let attempt = 0; attempt < 12 && (await camera()).zoom < wanted; attempt++) {
		await page.evaluate(() =>
			document.querySelector(".stage").dispatchEvent(
				new WheelEvent("wheel", {
					deltaY: -120,
					ctrlKey: true,
					clientX: Math.round(window.innerWidth / 2),
					clientY: Math.round(window.innerHeight / 2),
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		await settle(page, 120);
	}
	return (await camera()).zoom;
};

/*
 * Bring a point to the middle of the screen with a synthetic wheel on the stage.
 *
 * The camera is fitted to a board that is wider than a phone, so where the guest sits is
 * whatever the fixture and the fit decide; `mobile.mjs` pans the same way for the same
 * reason. A wheel dispatched on the stage is the one way a check can move the camera by
 * an exact amount without using the gesture it is about to test.
 */
const bring = async (point) => {
	const middle = await page.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
	await page.evaluate(
		(delta) =>
			document
				.querySelector(".stage")
				.dispatchEvent(new WheelEvent("wheel", { deltaX: delta.x, deltaY: delta.y, clientX: 100, clientY: 200, bubbles: true, cancelable: true })),
		{ x: point.x - middle.x, y: point.y - middle.y },
	);
	await settle(page, 250);
};

/*
 * The camera is fitted to one board, so the guest sits wherever the fixture puts it;
 * every point below comes from the live box rather than a literal, and the check bails
 * loudly if a phone-sized viewport cannot reach it at all.
 */
const level = await zoomIn(0.55);
say("the boards are zoomed in far enough to take a finger", level >= 0.5, `${Math.round(level * 100)}%, INTERACT_ZOOM is 50%`);

let headAt = await inner.locator("h1").boundingBox();
let boxAt = await inner.locator("#box").boundingBox();
say("the guest embed is reachable on a phone", !!headAt && !!boxAt, JSON.stringify({ headAt, boxAt }));

// --- 1. a finger the page has no use for pans the canvas -----------------------------
await bring({ x: headAt.x + headAt.width / 2, y: headAt.y + headAt.height / 2 });
headAt = await inner.locator("h1").boundingBox();
const c0 = await camera();
await swipe([{ x: headAt.x + headAt.width / 2, y: headAt.y + headAt.height / 2 }], { x: 0, y: -60 });
const c1 = await camera();
say("one finger over an embedded page pans the canvas", moved(c0, c1) > 20, `moved ${moved(c0, c1).toFixed(1)}px`);
const released = await gesture();
say("and the gesture is released when the finger lifts", released.fingers === 0 && released.mode === "undecided", JSON.stringify(released));

// --- 2. a finger its own box can use never leaves it ---------------------------------
const readTop = () => inner.locator("#box").evaluate((element) => Math.round(element.scrollTop));
boxAt = await inner.locator("#box").boundingBox();
await bring({ x: boxAt.x + boxAt.width / 2, y: boxAt.y + boxAt.height / 2 });
boxAt = await inner.locator("#box").boundingBox();
const topWas = await readTop();
const c2 = await camera();
await swipe([{ x: boxAt.x + boxAt.width / 2, y: boxAt.y + boxAt.height / 2 }], { x: 0, y: -40 });
const topNow = await readTop();
const c3 = await camera();
say("a finger dragged up inside the page's own box scrolls it", topNow > topWas, `scrollTop ${topWas} -> ${topNow}, gesture ${JSON.stringify(await gesture())}`);
say("and leaves the camera where it was", moved(c2, c3) < 1, `moved ${moved(c2, c3).toFixed(2)}px`);

// --- 3. two fingers are the canvas, wherever they land -------------------------------
let headNow = await inner.locator("h1").boundingBox();
await bring({ x: headNow.x + headNow.width / 2, y: headNow.y + headNow.height / 2 });
headNow = await inner.locator("h1").boundingBox();
const centre = { x: headNow.x + headNow.width / 2, y: headNow.y + headNow.height / 2 };
const z0 = (await camera()).zoom;
await pinch(centre, 60, 170);
const z1 = (await camera()).zoom;
say("a pinch over an embedded page zooms the canvas", z1 > z0 * 1.1, `${z0.toFixed(3)} -> ${z1.toFixed(3)}`);

// --- 4. and a tap is still a tap ----------------------------------------------------
await inner.locator("#go").tap();
const label = await inner.locator("#go").textContent();
say("a tap still reaches the page's own controls", label === "clicked 1 time", label);

// --- 5. the veiled kind works because the veil is in the board's document ------------
const veiled = await page.evaluate(() => {
	const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
	const rect = frame.getBoundingClientRect();
	const scale = rect.width / frame.clientWidth;
	const host = frame.contentDocument.querySelector('[data-id="report"]');
	const box = host.getBoundingClientRect();
	return {
		veil: !!host.querySelector(".embed-veil"),
		point: { x: rect.left + (box.left + box.width / 2) * scale, y: rect.top + (box.top + box.height / 2) * scale },
	};
});
if (!veiled.veil) {
	say("a foreign embed is still veiled", false, "no veil");
} else {
	await bring(veiled.point);
	const again = await page.evaluate(() => {
		const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
		const rect = frame.getBoundingClientRect();
		const scale = rect.width / frame.clientWidth;
		const box = frame.contentDocument.querySelector('[data-id="report"]').getBoundingClientRect();
		return { x: rect.left + (box.left + box.width / 2) * scale, y: rect.top + (box.top + box.height / 2) * scale };
	});
	const c4 = await camera();
	await swipe([again], { x: 0, y: -60 });
	const c5 = await camera();
	say("a finger over a veiled embed pans the canvas", moved(c4, c5) > 20, `moved ${moved(c4, c5).toFixed(1)}px`);
}

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
