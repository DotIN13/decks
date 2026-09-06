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
		canvases: doc?.querySelectorAll('[data-id="paper"] canvas.page').length ?? -1,
		note: doc?.querySelector('[data-id="paper"] .note')?.textContent ?? "",
		md: (doc?.querySelector('[data-id="notes"] .embed-body h1')?.textContent ?? "").trim(),
		nested: doc?.querySelector('[data-id="report"] iframe')?.getAttribute("sandbox") ?? null,
		missing: doc?.querySelector('[data-id="missing"]')?.dataset?.kind ?? null,
	};
});
say("pdf renders the requested pages", embeds.canvases === 2, `${embeds.canvases} canvases, header "${embeds.note}"`);
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
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
