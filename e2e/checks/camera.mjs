/** The camera, the embeds, and a file changed on disk reaching the frame. */
import { boardPath, changed, deckState, open, read, say, settle, write } from "../harness.mjs";

const plan = await boardPath("plan.html");
const original = read(plan);

const { browser, page, errors } = await open({ width: 1400, height: 900 });

// 1. Zoom about a point keeps that point under the cursor.
//
// Measured from the camera rather than from an iframe's rendered size: a fractional zoom
// rounds the frame's layout to device pixels, which added a pixel or two of noise to what
// is otherwise an exact property.
const anchor = await page.evaluate(async () => {
	const stage = document.querySelector(".stage");
	const rect = stage.getBoundingClientRect();
	const cursor = { x: 420, y: 300 };
	const camera = () => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
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

// 2. `0` fits everything. Clicked in the middle, not the corner: the corner is where the
// floating panels live, and a click there summons one over the very point being clicked.
await page.mouse.move(700, 500);
await page.locator(".stage").click({ position: { x: 700, y: 450 } });
await page.keyboard.press("0");
await settle(page, 400);
const fitted = await page.evaluate(() => {
	const stage = document.querySelector(".stage").getBoundingClientRect();
	const nodes = [...document.querySelectorAll(".board-node")].map((n) => n.getBoundingClientRect());
	return {
		inside: nodes.every(
			(r) => r.left >= stage.left - 2 && r.right <= stage.right + 2 && r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2,
		),
		count: nodes.length,
		level: document.querySelector('.pill [aria-label^="Zoom"]').textContent,
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
	page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector(".world").style.transform)?.[1] ?? 0));

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
// Not awaited before the keystroke: `page.evaluate` blocks until its promise settles, so
// awaiting here would hold the press until the listener had already timed out.
const refused = page.evaluate(
	() =>
		new Promise((resolve) => {
			const spy = (event) => {
				// The modifier arrives as a keydown of its own and is nobody's shortcut, so
				// resolving on the first event would answer about `Control` rather than `=`.
				if (event.key === "Control" || event.key === "Meta" || event.key === "Shift") return;
				removeEventListener("keydown", spy);
				resolve(event.defaultPrevented);
			};
			addEventListener("keydown", spy);
			setTimeout(() => resolve("nothing arrived"), 3000);
		}),
);
await settle(page, 200);
await page.keyboard.press("Control+Equal");
const verdict = await refused;
say("…and the browser's own page zoom is declined", verdict === true, String(verdict));
await page.keyboard.press("Control+Digit0");
await settle(page, 400);

/*
 * With the focus inside a board, which is where it goes the moment anybody clicks one. The
 * keystroke arrives in the board's own document and is handed back through
 * `frame-gestures.ts` — take the zoom in the stage and not there, and ⌘+ works on empty
 * canvas and stops working as soon as you touch a board.
 */
const focused = await page.evaluate(() => {
	const frame = document.querySelector(".board-node iframe");
	frame?.contentWindow?.focus();
	const body = frame?.contentDocument?.body;
	if (!body) return "no board frame";
	body.tabIndex = -1;
	body.focus();
	// Asserted, not assumed: if the focus stayed in the top document this would pass through
	// the window handler and prove nothing about the path it is meant to be testing.
	return frame.contentDocument.activeElement === body ? "in the board" : "focus did not move";
});
say("the focus really is inside a board", focused === "in the board", String(focused));
await settle(page, 300);
const beforeInBoard = await zoomOf();
await page.keyboard.press("Control+Equal");
await settle(page, 500);
const afterInBoard = await zoomOf();
say("…and all of it still works with a board focused", afterInBoard > beforeInBoard * 1.1, `${beforeInBoard.toFixed(3)} → ${afterInBoard.toFixed(3)}`);
await page.keyboard.press("Control+Digit0");
await settle(page, 400);

// 3. The embeds on the sources board.
const embeds = await page.evaluate(() => {
	const frame = [...document.querySelectorAll(".board-node iframe")].find((f) => f.src.includes("sources"));
	const doc = frame?.contentDocument;
	return {
		// Images, not canvases: a rendered page is swapped for a picture of itself, because a
		// canvas is re-uploaded to the compositor on every frame of a gesture (`board.js`).
		pages: doc?.querySelectorAll('[data-id="paper"] img.page').length ?? -1,
		canvases: doc?.querySelectorAll('[data-id="paper"] canvas').length ?? -1,
		note: doc?.querySelector('[data-id="paper"] .note')?.textContent ?? "",
		md: (doc?.querySelector('[data-id="notes"] .embed-body h1')?.textContent ?? "").trim(),
		nested: doc?.querySelector('[data-id="report"] iframe')?.getAttribute("sandbox") ?? null,
		missing: doc?.querySelector('[data-id="missing"]')?.dataset?.kind ?? null,
	};
});
say("pdf renders the requested pages", embeds.pages === 2, `${embeds.pages} pages, header "${embeds.note}"`);
say("…as pictures, with no canvas left behind to re-upload on every frame", embeds.canvases === 0, `${embeds.canvases} canvases`);
say("markdown embed renders", embeds.md === "Session notes", `h1 "${embeds.md}"`);
say("foreign html is in a sandboxed nested frame", embeds.nested === "allow-scripts", `sandbox="${embeds.nested}"`);
say("an unresolvable embed says so", embeds.missing === "missing", `kind=${embeds.missing}`);

// 4. A file changed on disk reaches the frame, with nobody asking it to.
const srcBefore = await page.evaluate(() => document.querySelector('.board-node[data-path="boards/plan.html"] iframe').src);
write(
	plan,
	original.replace(
		'<div class="chip" data-id="status"',
		'<div class="sticky" data-id="live-check" style="left: 1300px; top: 700px; width: 200px">written from outside</div>\n\t\t<div class="chip" data-id="status"',
	),
);
await page.waitForFunction(
	() => Boolean(document.querySelector('.board-node[data-path="boards/plan.html"] iframe')?.contentDocument?.querySelector('[data-id="live-check"]')),
	null,
	{ timeout: 15000 },
);
const live = await page.evaluate(() => {
	const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
	return { src: frame?.src, found: Boolean(frame?.contentDocument?.querySelector('[data-id="live-check"]')) };
});
say("an edit on disk reaches the frame unaided", live.found && live.src !== srcBefore, `new src ${live.src?.split("?")[1]}`);

write(plan, original);
await changed(plan, read(plan) === original ? "" : original).catch(() => {});
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
await page.keyboard.press("Control+Equal");
const whileZooming = await page.evaluate(() => document.querySelector(".stage").dataset.scaling);
say("a zoom says the scale is moving, so the boards can go on layers", whileZooming === "true", `data-scaling=${whileZooming}`);
await settle(page, 900);
const atRest = await page.evaluate(() => document.querySelector(".stage").dataset.scaling);
// Held only while it is moving: a layer is a texture kept in memory, and a deck of them
// held for the life of the page is memory nobody asked for.
say("…and gives the layers back once it stops", atRest === "false", `data-scaling=${atRest}`);

const beforePan = await page.evaluate(() => document.querySelector(".stage").dataset.scaling);
await page.mouse.move(700, 400);
await page.mouse.wheel(0, 120);
await settle(page, 120);
const whilePanning = await page.evaluate(() => document.querySelector(".stage").dataset.scaling);
say("a scroll that only moves the camera does not ask for them", beforePan === "false" && whilePanning === "false", `${beforePan} -> ${whilePanning}`);

// Zoom in until the other boards leave the screen, and their bars should go with them.
for (let step = 0; step < 10; step++) {
	await page.keyboard.press("Control+Equal");
	await settle(page, 60);
}
await settle(page, 900);
/*
 * Bars are counted against the boards within a viewport of the screen — the margin the
 * stage loads documents for — rather than against the documents, because the two are no
 * longer the same set: a document outlives its board leaving the screen by a few seconds
 * (below), and a bar must not.
 */
const barsNow = () =>
	page.evaluate(() => {
		const near = [...document.querySelectorAll(".board-node")].filter((node) => {
			const r = node.getBoundingClientRect();
			return r.right > -innerWidth && r.left < 2 * innerWidth && r.bottom > -innerHeight && r.top < 2 * innerHeight;
		}).length;
		return {
			nodes: document.querySelectorAll(".board-node").length,
			near,
			documents: document.querySelectorAll(".board-node iframe").length,
			bars: document.querySelectorAll(".board-node > .chrome").length,
		};
	});
const bars = await barsNow();
say("a board that is off screen draws no title bar", bars.bars < bars.nodes, JSON.stringify(bars));
say("…and every board that is on screen still has one", bars.bars === bars.near, JSON.stringify(bars));
/*
 * 6. A document outlives its board leaving the screen, by a moment.
 *
 * Zooming in puts every other board outside the margin within a few steps, and zooming out
 * brings them back: unloading on the way in and parsing again on the way out was 37ms per
 * step of `Document::shutdown` in the middle of the gesture, and every document rebuilt in
 * the middle of the next. So the boards that just left are still documents here — and are
 * let go once they have been gone for a few seconds.
 */
say("…while the boards that just left the screen keep their documents for now", bars.documents === bars.nodes, `${bars.documents} of ${bars.nodes}`);
await settle(page, 3600);
const later = await barsNow();
say("…and are let go once they have been gone a few seconds", later.documents < later.nodes && later.documents >= later.bars, JSON.stringify(later));

/*
 * 7. A middle-drag over a board moves the canvas exactly as far as the mouse.
 *
 * The gesture runs inside the frame's own document, whose coordinate system is the one the
 * pan is moving. A mouse standing still reports a shrinking `clientX` in there, by every pan
 * that moves the frame under it — so a delta measured in those pixels is the mouse's movement
 * *minus* the pan just applied, and feeding that back as the next pan makes the camera advance
 * by `mouse − previous step`: half the distance, one event in two. That was "it lags and
 * jitters when I pan over a board", and it measured 120px of board for 240px of mouse with the
 * steps reading `20 0 20 0 …`.
 *
 * The per-step numbers are asserted, not only the total. A drag whose steps alternate between
 * twice the movement and none has the right total and is still the bug.
 */
/*
 * Above `INTERACT_ZOOM`, or there is nothing to measure.
 *
 * Below it a board's frame is inert and takes no pointer events at all — the stage handles the
 * drag itself, in its own coordinates, which is a different code path and correct. The fit that
 * `0` gives lands under the threshold in this fixture, so the first version of this check
 * passed against the bug: it was measuring the stage's pan and calling it the frame's.
 */
await page.keyboard.press("Control+Digit0");
await settle(page, 400);
for (let i = 0; i < 10; i++) {
	const live = await page.evaluate(() =>
		[...document.querySelectorAll(".board-node")].some((n) => n.dataset.inert !== "true" && n.getBoundingClientRect().width > 320),
	);
	if (live) break;
	await page.keyboard.press("Control+Equal");
	await settle(page, 350);
}
const grab = await page.evaluate(() => {
	const nodes = [...document.querySelectorAll(".board-node")];
	const offsets = [
		[0, 0],
		[140, 0],
		[-140, 0],
		[0, -120],
		[0, 120],
	];
	for (const node of nodes) {
		if (node.dataset.inert === "true") continue;
		const r = node.getBoundingClientRect();
		if (r.width < 320 || r.height < 320) continue;
		const frame = node.querySelector("iframe");
		if (getComputedStyle(frame).pointerEvents === "none") continue;
		for (const [dx, dy] of offsets) {
			const x = Math.min(Math.max(r.x + r.width / 2 + dx, 420), innerWidth - 340);
			const y = Math.min(Math.max(r.y + r.height / 2 + dy, 140), innerHeight - 180);
			if (document.elementFromPoint(x, y)?.closest(".board-node") !== node) continue;
			return { x: Math.round(x), y: Math.round(y), path: node.dataset.path };
		}
	}
	return null;
});
// A live frame is the condition for measuring the path this is about, so not finding one is a
// failure rather than a quieter test of something else.
say("a live board frame is under the cursor to be dragged on", grab !== null, JSON.stringify(grab));

/*
 * The camera's own numbers are **world** units — `pan()` divides a screen movement by the
 * zoom before storing it — so a screen-pixel measurement is the world difference times the
 * zoom. Getting that wrong is how the first version of this check read 89px of canvas for
 * 20px of mouse and looked like a bug in the code rather than in the arithmetic.
 */
const cameraAt = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		return m ? { x: -Number(m[4]), y: -Number(m[5]), zoom: Number(m[3]) } : null;
	});

const STEP = 20;
const STEPS = 8;
await page.mouse.move(grab.x, grab.y);
const before = await cameraAt();
await page.mouse.down({ button: "middle" });
const steps = [];
let at = before;
for (let i = 1; i <= STEPS; i++) {
	await page.mouse.move(grab.x + STEP * i, grab.y);
	const now = await cameraAt();
	// Panning right moves the camera left, so the board's travel is the camera's loss —
	// in screen pixels, which is the world difference scaled back up.
	steps.push(Math.round((at.x - now.x) * now.zoom));
	at = now;
}
await page.mouse.up({ button: "middle" });
const travelled = Math.round((before.x - at.x) * at.zoom);
const wanted = STEP * STEPS;
say("a middle-drag over a board pans one for one", Math.abs(travelled - wanted) <= 2, `${travelled}px of canvas for ${wanted}px of mouse`);
say(
	"…and every step of it moves, rather than stalling on alternate events",
	steps.every((d) => d >= STEP - 2),
	steps.join(" "),
);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
