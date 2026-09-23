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
const bare = await page.evaluate(() => {
	const stage = document.querySelector(".stage").getBoundingClientRect();
	/*
	 * The middle of the canvas: clear of the floats by construction — the left panel is 276px
	 * wide, the corner cluster runs along the top, the dock along the bottom — and hit-tested
	 * anyway, because that is the one thing the geometry does not promise.
	 */
	const floats = ".board-node, .panel-shell, .dock, .pill, .stream";
	for (let y = Math.round(stage.top + 120); y < stage.bottom - 200; y += 16) {
		for (let x = Math.round(stage.left + 340); x < stage.right - 160; x += 16) {
			if (!document.elementFromPoint(x, y)?.closest(floats)) return { x, y };
		}
	}
	return null;
});
if (bare) await page.mouse.click(bare.x, bare.y);
say(
	"the canvas has the focus, not a board",
	await page.evaluate(() => !document.querySelector(".board-node iframe")?.contentDocument?.hasFocus()),
	`clicked ${JSON.stringify(bare)}`,
);
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
/*
 * The bar's glyphs at the near end of the zoom, to compare with the far end.
 *
 * `Icon` sizes its SVG in pixels, and pixels inside a bar are *board* pixels — the bar is laid
 * out in board units and the camera cancels them — so the buttons stay 18 screen pixels while the
 * glyphs inside them scale with the camera: measured at 2.3px at 19% zoom and 48px at 400%,
 * overflowing the button they were drawn in. Sized from `--unit` now, and this is the assertion
 * that it stays that way: the same four glyphs, the same size, at both ends of a real zoom.
 */
const iconsAt = () =>
	page.evaluate(() => {
		const acts = document.querySelector(".board-node .chrome .acts");
		if (!acts) return null;
		return [...acts.children].map((child) => Math.round(child.querySelector("svg")?.getBoundingClientRect().width ?? 0));
	});
const iconsBefore = await iconsAt();
await page.keyboard.press("Control+Equal");
await settle(page, 400);
const zoomedIn = await zoomOf();
say("⌘+ zooms the canvas instead of the page", zoomedIn > fittedZoom * 1.1, `${fittedZoom.toFixed(3)} → ${zoomedIn.toFixed(3)}`);
const iconsAfter = await iconsAt();
say(
	"…and the title bar's glyphs are the same size zoomed in as they were",
	iconsBefore !== null && iconsAfter !== null && iconsAfter.every((icon, at) => icon === iconsBefore[at] && icon > 0),
	`${(iconsBefore ?? []).join("/")} at ${fittedZoom.toFixed(2)} → ${(iconsAfter ?? []).join("/")} at ${zoomedIn.toFixed(2)}`,
);

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
 * This started a `page.evaluate` and did not await it, because the promise it returns cannot
 * settle until the key arrives — which left the keystroke free to beat the listener. It did, on
 * two runs of the whole suite out of three, and the verdict was the string "nothing arrived":
 * a failure that says nothing about whether the app declined the zoom. So the listener now
 * writes its verdict down and returns at once, the press follows an *awaited* install, and the
 * verdict is waited for rather than assumed.
 */
await page.evaluate(() => {
	window.__declined = undefined;
	addEventListener("keydown", (event) => {
		// The modifier arrives as a keydown of its own and is nobody's shortcut, so the answer
		// comes from the key after it rather than from `Control`.
		if (event.key === "Control" || event.key === "Meta" || event.key === "Shift") return;
		window.__declined = event.defaultPrevented;
	});
});
await page.keyboard.press("Control+Equal");
await page.waitForFunction(() => window.__declined !== undefined, null, { timeout: 3000 }).catch(() => {});
const verdict = await page.evaluate(() => window.__declined);
say("…and the browser's own page zoom is declined", verdict === true, String(verdict ?? "nothing arrived"));
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

/*
 * And the world carries no `will-change` at all — which is the fix for a board being soft at high
 * zoom, and this assertion is here so nobody puts it back for the sake of the pan.
 *
 * The declaration is a promise: hold the raster, apply the camera as a matrix. It makes a pan a
 * matrix rather than a repaint of sixteen documents — and it makes every zoom the same picture
 * stretched, which is what a board looked like at 400% on a 2× display until it was taken off.
 * A gesture-scoped version was tried and reverted: the layer being built and torn down flashed
 * under the pointer, worst over a board, and a camera moved without a gesture (an agent's
 * `stage.show`, a restored view) could leave the promise held over a scale it no longer matched.
 * The cost is a pan painting itself, which `index.css` measures and explains.
 */
const promise = () =>
	page.evaluate(() => ({
		world: getComputedStyle(document.querySelector(".world")).willChange,
		iframes: getComputedStyle(document.querySelector(".board-node iframe")).willChange,
	}));
const resting = await promise();
say("the world makes no promise, so a zoom is drawn at the size it is read at", resting.world === "auto", JSON.stringify(resting));

await page.mouse.move(700, 400);
await page.mouse.wheel(0, 120);
await settle(page, 150);
const whileMoving = await promise();
say("…and a pan does not make one", whileMoving.world === "auto", JSON.stringify(whileMoving));
await page.keyboard.press("Control+Equal");
await settle(page, 150);
const onZoom = await promise();
say("…and a zoom does not either", onZoom.world === "auto", JSON.stringify(onZoom));

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
const cursorIn = (path) =>
	page.evaluate((wanted) => {
		/*
		 * The board the hand is actually on, not the first large one.
		 *
		 * This read `[...document.querySelectorAll(".board-node iframe")].find((f) => big)`,
		 * which is a different question: on a deck with two boards over 200px it reads
		 * whichever comes first in the DOM, and the assertion below then compares the cursor of
		 * one board with a drag performed on another. It passed for as long as the fixture had
		 * exactly one board that large in view, and broke the moment the arrangement changed —
		 * which is what `grab.path` is for, and it was already being computed.
		 */
		const frame = document.querySelector(`.board-node[data-path="${wanted}"] iframe`);
		return frame ? getComputedStyle(frame.contentDocument.documentElement).cursor : null;
	}, path);
say("the board's own cursor is not a grab hand to begin with", (await cursorIn(grab?.path)) !== "grabbing", String(await cursorIn(grab?.path)));
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
	if (i === 4) {
		/*
		 * The feedback, which the stage's own cursor cannot give. `.stage[data-panning="true"]`
		 * makes the cursor a grab hand for a pan on bare canvas, and an iframe's document has a
		 * cursor of its own — so the identical gesture started over a board showed the board's
		 * cursor while the canvas moved under it, which reads as nothing happening at all.
		 */
		say("…and the board under the hand says it is being dragged", (await cursorIn(grab.path)) === "grabbing", String(await cursorIn(grab.path)));
	}
}
await page.mouse.up({ button: "middle" });
await settle(page, 300);
say("…and gives the board's own cursor back afterwards", (await cursorIn(grab?.path)) !== "grabbing", String(await cursorIn(grab?.path)));
const travelled = Math.round((before.x - at.x) * at.zoom);
const wanted = STEP * STEPS;
say("a middle-drag over a board pans one for one", Math.abs(travelled - wanted) <= 2, `${travelled}px of canvas for ${wanted}px of mouse`);
say(
	"…and every step of it moves, rather than stalling on alternate events",
	steps.every((d) => d >= STEP - 2),
	steps.join(" "),
);

/*
 * A scroll that lands exactly on a board's outline pans. That pixel is the frame's border, which its
 * document does not cover, so the wheel used to reach neither document — and a trackpad latches a
 * whole gesture to where it began, so a pan that started there never moved at all. Probed across
 * the edge at half-pixel steps, since where the boundary falls depends on the zoom.
 */
await page.keyboard.press("0");
await settle(page, 900);
const surface = await page.locator(".board-node .surface").first().boundingBox();
const camNow = () => page.evaluate(() => getComputedStyle(document.querySelector(".world")).transform);
const stuck = [];
for (let d = -1; d <= 3; d += 0.5) {
	for (const [side, x, y] of [["left", surface.x + d, surface.y + surface.height / 2], ["top", surface.x + surface.width / 2, surface.y + d]]) {
		if (x < 1 || y < 1) continue;
		const before = await camNow();
		await page.mouse.move(x, y);
		await page.mouse.wheel(0, 30);
		await settle(page, 150);
		if ((await camNow()) === before) stuck.push(`${side} ${d}`);
		else {
			await page.mouse.wheel(0, -30);
			await settle(page, 150);
		}
	}
}
say("a scroll landing on a board's outline pans the canvas", stuck.length === 0, stuck.join(", ") || "every point panned");

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
