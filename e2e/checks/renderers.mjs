/**
 * The three renderers (`lib/renderer.ts`), switched from Settings.
 *
 * The DOM renderer is what every other check runs against. This one starts on the other two
 * — by the remembered preference, which is how a person's choice comes back on reload — and
 * asserts the things each renderer promises: a canvas per board keeps the document clickable
 * and draws it into a canvas of its own; one canvas draws every board as a picture on the
 * stage's canvas and keeps the documents in the darkroom, inert. Then it switches through
 * Settings, because that is the way anyone will actually change it, and ends back on
 * documents so the next check inherits nothing.
 *
 * Needs Chrome with `--enable-blink-features=CanvasDrawElement`, which `harness.mjs` sets.
 */
import { open, say, settle } from "../harness.mjs";

/** Wait for every document there is — wherever the renderer put it — to finish mounting. */
async function documentsReady(page, { timeout = 30000 } = {}) {
	await page.waitForSelector("iframe[data-path]", { timeout });
	await page.waitForFunction(
		() => {
			const frames = [...document.querySelectorAll("iframe[data-path]")];
			return frames.length > 0 && frames.every((frame) => frame.contentWindow?.__boardReady === true);
		},
		null,
		{ timeout },
	);
}

/**
 * How many sampled pixels of a canvas differ from its first pixel, which is what "the board
 * is drawn in it" means: a canvas holding a blank rectangle has alpha everywhere and passes
 * an alpha test, and the first version of this check let exactly that through.
 */
const INK = `(canvas) => {
	const ctx = canvas.getContext("2d");
	if (!ctx || canvas.width === 0 || canvas.height === 0) return -1;
	try {
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let ink = 0;
		const first = [data[0], data[1], data[2], data[3]];
		for (let i = 0; i < data.length; i += 4 * 97) {
			if (Math.abs(data[i] - first[0]) + Math.abs(data[i + 1] - first[1]) + Math.abs(data[i + 2] - first[2]) + Math.abs(data[i + 3] - first[3]) > 40) ink++;
		}
		return ink;
	} catch (error) {
		return "tainted: " + error.message;
	}
}`;

/**
 * How far down and across a rectangle of a canvas the last strongly-coloured pixel is, as a
 * fraction of its height and width.
 *
 * This is the scale test, and it is the one the first version of these checks did not have.
 * A board drawn at the wrong scale still fills its canvas with ink and still passes every
 * "is it drawn" assertion above; what it does is put the board's own furniture in the wrong
 * place. So this asks where the furthest-travelled piece of it landed.
 *
 * "Strongly coloured" is against the document's own background, passed in — not against
 * dark, because the app has a light theme and a dark one, and in the dark theme the whole
 * board is dark. The threshold is above the contrast of a board's grid lines and below that
 * of its text.
 */
const FURTHEST = `(canvas, region, background) => {
	const ctx = canvas.getContext("2d");
	const x = Math.max(0, Math.round(region.x)), y = Math.max(0, Math.round(region.y));
	const w = Math.min(canvas.width - x, Math.round(region.w)), h = Math.min(canvas.height - y, Math.round(region.h));
	if (!ctx || w <= 0 || h <= 0) return null;
	const data = ctx.getImageData(x, y, w, h).data;
	let bottom = -1, right = -1;
	for (let row = 0; row < h; row++) {
		for (let column = 0; column < w; column++) {
			const at = (row * w + column) * 4;
			const off = Math.abs(data[at] - background[0]) + Math.abs(data[at + 1] - background[1]) + Math.abs(data[at + 2] - background[2]);
			if (data[at + 3] > 40 && off > 120) {
				if (row > bottom) bottom = row;
				if (column > right) right = column;
			}
		}
	}
	return bottom < 0 ? null : { down: (bottom + 1) / h, across: (right + 1) / w };
}`;

/**
 * The same two fractions, asked of the document: where its text ends, where its components
 * end, and what colour it is behind them.
 *
 * Two bounds rather than one, because a picture's furthest ink is somewhere between them —
 * past the last letter, not past the card the letter is in.
 */
const FURTHEST_IN_DOCUMENT = `(frame) => {
	const doc = frame.contentDocument;
	if (!doc) return null;
	const extent = (selector) => {
		let bottom = 0, right = 0;
		for (const el of doc.querySelectorAll(selector)) {
			const rect = el.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) continue;
			if (rect.bottom > bottom) bottom = rect.bottom;
			if (rect.right > right) right = rect.right;
		}
		return { down: bottom / frame.offsetHeight, across: right / frame.offsetWidth };
	};
	const text = extent("h1, h2, h3, h4, p, li, td, th, code");
	const components = extent("[data-id]");
	const colour = getComputedStyle(doc.body).backgroundColor.match(/\\d+/g) ?? ["255", "255", "255"];
	if (text.down === 0) return null;
	return { text, components, background: colour.slice(0, 3).map(Number) };
}`;

/**
 * Is the picture's furthest ink between the document's last letter and its last component?
 *
 * The upper bound stops short of the edge, and that is the whole point of it. A board drawn
 * *larger* than its picture is cropped, so its ink runs to the very edge — 1.0, which "the
 * last component plus a tolerance" would wave through, since a board's last component nearly
 * touches its edge. Unless the document really does have something at the edge, ink at 1.0
 * means the picture was cut, not filled.
 */
function placedRight(measured) {
	if (!measured?.drawn || !measured.expected) return false;
	const { drawn, expected } = measured;
	const between = (got, text, components) => {
		const low = Math.min(text, components) - 0.02;
		const high = components >= 0.98 ? 1.01 : Math.min(components + 0.02, 0.99);
		return got > low && got < high;
	};
	return between(drawn.down, expected.text.down, expected.components.down) && between(drawn.across, expected.text.across, expected.components.across);
}

// On a 2× screen on purpose. Both renderers were once right at one device pixel per CSS
// pixel and wrong at two — the one-canvas half drew every board at twice its picture — and a
// check that only ever runs at 1× cannot see that at all.
const { browser, page, errors } = await open({ width: 1400, height: 900, dpr: 2 });
try {
	say("the browser has drawElementImage (the flag is on)", await page.evaluate(() => "drawElementImage" in CanvasRenderingContext2D.prototype));

	// --- a canvas per board, from the remembered choice -------------------------------
	await page.addInitScript((choice) => {
		if (window.top !== window.self) return;
		try {
			localStorage.setItem("decks.renderer", choice);
		} catch {
			/* the harness's own init script has already cleared it */
		}
	}, "canvas-per-board");
	await page.reload({ waitUntil: "load" });
	await documentsReady(page);
	await settle(page, 2500);

	say("the stage says which renderer it is", (await page.getAttribute(".stage", "data-renderer")) === "canvas-per-board");
	const perBoard = await page.evaluate((ink) => {
		const count = new Function("return " + ink)();
		return [...document.querySelectorAll(".board-node")].map((node) => {
			const canvas = node.querySelector(".surface > canvas.picture");
			const frame = canvas?.querySelector(":scope > iframe[data-path]");
			const doc = frame?.contentDocument;
			return {
				path: node.dataset.path,
				canvas: Boolean(canvas),
				frameInCanvas: Boolean(frame),
				ink: canvas ? count(canvas) : -1,
				backing: canvas ? `${canvas.width}x${canvas.height}` : "",
				// Whether there is anything to draw, and whether the picture is big enough to
				// see it in: the fixture collects blank boards from earlier checks, and a board
				// seen at a tenth of its size is a picture a hundred pixels across.
				hasContent: Boolean(doc && (doc.querySelectorAll("[data-id]").length > 0 || (doc.body?.innerText ?? "").trim().length > 20)),
				pixels: canvas ? canvas.width * canvas.height : 0,
			};
		});
	}, INK);
	say("every board has a canvas of its own with its document as the canvas's child", perBoard.length > 0 && perBoard.every((b) => b.canvas && b.frameInCanvas), JSON.stringify(perBoard));
	// Boards with something in them and a picture large enough to judge — a blank board left
	// by an earlier check is a flat rectangle by right, and a board seen small is a picture
	// too few pixels across to sample.
	const legible = perBoard.filter((board) => board.hasContent && board.pixels >= 5000);
	say(
		"…and the canvas has the board drawn in it",
		legible.length >= 2 && legible.every((b) => typeof b.ink === "number" && b.ink > 0),
		JSON.stringify(perBoard.map((b) => [b.path, b.ink, b.backing, b.hasContent])),
	);

	// Zoom to one board — `1` frames the first when nothing is selected — so it is
	// interactive, and click into it.
	const first = perBoard[0].path;
	await page.keyboard.press("1");
	await settle(page, 1200);
	const zoomed = await page.evaluate((path) => {
		const node = document.querySelector(`.board-node[data-path="${path}"]`);
		const rect = node.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(cx, cy);
		return { cx, cy, hit: hit?.tagName, inPicture: hit?.parentElement?.classList.contains("picture") ?? false, inert: node.dataset.inert, width: rect.width };
	}, first);
	say("zoomed in, the point under the picture is the board's own document", zoomed.hit === "IFRAME" && zoomed.inPicture && zoomed.inert === "false", JSON.stringify(zoomed));
	await page.mouse.click(zoomed.cx, zoomed.cy);
	await settle(page, 300);
	const focused = await page.evaluate(() => ({ active: document.activeElement?.tagName, path: document.activeElement?.dataset?.path }));
	say("a click goes through the canvas into the document", focused.active === "IFRAME" && focused.path === first, JSON.stringify(focused));

	// After the zoom rests, the picture has been redrawn at the size it is now seen at.
	const redrawn = await page.evaluate((path) => {
		const canvas = document.querySelector(`.board-node[data-path="${path}"] canvas.picture`);
		const rect = canvas.getBoundingClientRect();
		return { backing: canvas.width, shown: Math.round(rect.width * devicePixelRatio) };
	}, first);
	say("the picture was redrawn at rest at the size it is seen at", Math.abs(redrawn.backing - redrawn.shown) <= 2, JSON.stringify(redrawn));

	/*
	 * …and at the right *scale*, which is a different question and the one that was wrong.
	 * `drawElementImage` draws an element into the canvas's own coordinates, so a canvas that
	 * is the frame's own box needs no scale at all; a draw that scaled by the zoom put the
	 * board on its canvas 11% small, and 36% small once zoomed in — ink everywhere, every
	 * assertion above green, and plainly wrong to look at. The board's own furthest ink says
	 * where it really landed. Measured on the largest picture there is, since the reading is
	 * a fraction of it.
	 */
	const scaleTarget = legible.slice().sort((a, b) => b.pixels - a.pixels)[0]?.path ?? first;
	const perBoardScale = await page.evaluate(({ path, furthest, inDocument }) => {
		const inPicture = new Function("return " + furthest)();
		const inFrame = new Function("return " + inDocument)();
		const canvas = document.querySelector(`.board-node[data-path="${path}"] canvas.picture`);
		const frame = canvas?.querySelector(":scope > iframe[data-path]");
		if (!canvas || !frame) return null;
		const expected = inFrame(frame);
		if (!expected) return null;
		return { drawn: inPicture(canvas, { x: 0, y: 0, w: canvas.width, h: canvas.height }, expected.background), expected };
	}, { path: scaleTarget, furthest: FURTHEST, inDocument: FURTHEST_IN_DOCUMENT });
	say("the board is drawn at the picture's scale, not the zoom on top of it", placedRight(perBoardScale), `${scaleTarget} ${JSON.stringify(perBoardScale)}`);

	// --- one canvas, switched to from Settings --------------------------------------
	await page.locator('.pill button[aria-label="More"]').click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	await page.locator(".popover [data-row]").filter({ hasText: /settings/i }).first().click();
	await page.waitForSelector(".settings", { timeout: 6000 });
	const group = page.locator('.set-group[data-group="renderer"]');
	say("Settings has a Boards group with three renderers", (await group.locator(".seg button").count()) === 3);
	say("…and the current one is marked", (await group.locator('.seg button[data-on="true"]').textContent()) === "A canvas per board");
	await group.locator(".seg button", { hasText: "One canvas" }).click();
	await page.keyboard.press("Escape");
	await documentsReady(page);
	await settle(page, 3000);

	say("the stage is on one canvas", (await page.getAttribute(".stage", "data-renderer")) === "one-canvas");
	const one = await page.evaluate((ink) => {
		const count = new Function("return " + ink)();
		const picture = document.querySelector(".stage > .stage-picture");
		const darkroom = document.querySelector(".stage > .darkroom");
		const frames = [...(darkroom?.querySelectorAll(":scope > iframe[data-path]") ?? [])];
		const boxes = [...document.querySelectorAll(".board-node")].map((node) => {
			const rect = node.getBoundingClientRect();
			return { path: node.dataset.path, x: rect.left, y: rect.top, w: rect.width, h: rect.height };
		});
		// Ink inside each board's box on the stage picture — so two boards can be told apart.
		const ctx = picture?.getContext("2d");
		const perBox = boxes.map((box) => {
			if (!ctx) return -1;
			const x = Math.max(0, Math.round(box.x * devicePixelRatio));
			const y = Math.max(0, Math.round(box.y * devicePixelRatio));
			const w = Math.min(picture.width - x, Math.round(box.w * devicePixelRatio));
			const h = Math.min(picture.height - y, Math.round(box.h * devicePixelRatio));
			if (w <= 0 || h <= 0) return -1;
			const data = ctx.getImageData(x, y, w, h).data;
			// Varied pixels inside the box: text and cards, not a flat rectangle.
			let varied = 0;
			const first = [data[0], data[1], data[2]];
			for (let i = 0; i < data.length; i += 4 * 31) if (Math.abs(data[i] - first[0]) + Math.abs(data[i + 1] - first[1]) + Math.abs(data[i + 2] - first[2]) > 40) varied++;
			return varied;
		});
		return {
			darkroomSize: darkroom ? `${darkroom.width}x${darkroom.height}` : "none",
			pictureInk: picture ? count(picture) : -1,
			darkroomFrames: frames.map((frame) => ({ path: frame.dataset.path, inert: frame.inert })),
			surfaceFrames: document.querySelectorAll(".board-node .surface iframe").length,
			perBox: boxes.map((box, i) => [box.path, perBox[i]]),
			surfaceBg: getComputedStyle(document.querySelector(".board-node .surface")).backgroundColor,
		};
	}, INK);
	say("the stage's canvas has the boards drawn on it", typeof one.pictureInk === "number" && one.pictureInk > 0, `ink ${one.pictureInk}, darkroom ${one.darkroomSize}`);
	say("the documents live in the darkroom, inert, and not in the boxes", one.darkroomFrames.length > 0 && one.darkroomFrames.every((f) => f.inert) && one.surfaceFrames === 0, JSON.stringify(one.darkroomFrames));
	say("the boxes are clear so the picture shows through", /rgba\(0, 0, 0, 0\)|transparent/.test(one.surfaceBg), one.surfaceBg);
	// The fixture can hold blank boards left by earlier checks, and a blank board is a flat
	// rectangle by right — so the boards with content are what is asserted on, not all of them.
	const drawn = one.perBox.filter(([, count]) => count > 20);
	say("the boards with content have it drawn, not a flat rectangle", drawn.length >= 2, JSON.stringify(one.perBox));
	say("different boards are different pictures (no board wears another's)", new Set(drawn.map(([, count]) => count)).size === drawn.length, JSON.stringify(drawn));

	/*
	 * The same scale question, end to end: where a board's furthest ink lands inside the
	 * board's own rectangle on the stage's canvas. Here the darkroom is the canvas and it is
	 * shown at the size of the picture it is taking, so the scale is the ratio between the two
	 * boxes — and this is the assertion a 2× screen used to break, where the board came out
	 * twice its picture and the stage stretched the top-left quarter over the whole board.
	 *
	 * Measured on the largest board that is wholly on screen and has no other board over it.
	 * Every board is on one canvas here, so a rectangle that runs off the edge, or that a
	 * neighbour is drawn into, is a reading of something else — and boards in this deck do
	 * overlap, which is what made the first version of this read a neighbour's callout.
	 */
	const oneScale = await page.evaluate(({ paths, furthest, inDocument }) => {
		const inPicture = new Function("return " + furthest)();
		const inFrame = new Function("return " + inDocument)();
		const picture = document.querySelector(".stage > .stage-picture");
		if (!picture) return null;
		const everyBox = [...document.querySelectorAll(".board-node")].map((node) => ({ path: node.dataset.path, box: node.getBoundingClientRect() }));
		const overlapped = (path, box) =>
			everyBox.some((other) => other.path !== path && other.box.left < box.right && other.box.right > box.left && other.box.top < box.bottom && other.box.bottom > box.top);
		const whollyVisible = paths
			.map((path) => ({ path, node: document.querySelector(`.board-node[data-path="${path}"]`), frame: document.querySelector(`.stage > .darkroom > iframe[data-path="${path}"]`) }))
			.filter(({ path, node, frame }) => {
				if (!node || !frame) return false;
				const box = node.getBoundingClientRect();
				if (overlapped(path, box)) return false;
				return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && box.width > 60;
			})
			.sort((a, b) => b.node.getBoundingClientRect().width - a.node.getBoundingClientRect().width);
		const pick = whollyVisible[0];
		if (!pick) return { reason: "no board with content is wholly on screen and clear of its neighbours" };
		const { path, node, frame } = pick;
		const expected = inFrame(frame);
		if (!expected) return { reason: `nothing to compare against in ${path}` };
		const rect = node.getBoundingClientRect();
		const dpr = devicePixelRatio;
		const region = { x: rect.left * dpr, y: rect.top * dpr, w: rect.width * dpr, h: rect.height * dpr };
		return { path, drawn: inPicture(picture, region, expected.background), expected };
	}, { paths: drawn.map(([path]) => path), furthest: FURTHEST, inDocument: FURTHEST_IN_DOCUMENT });
	say("a board's picture fills the board's own rectangle at the right scale", placedRight(oneScale), JSON.stringify(oneScale));

	// A pan must not throw or redraw documents: the picture just moves.
	await page.mouse.move(700, 450);
	await page.mouse.wheel(120, 80);
	await settle(page, 600);
	say("the picture survives a pan", (await page.evaluate((ink) => new Function("return " + ink)()(document.querySelector(".stage-picture")), INK)) > 0);

	// --- back to documents ------------------------------------------------------------
	await page.locator('.pill button[aria-label="More"]').click();
	await page.waitForSelector(".popover", { timeout: 4000 });
	await page.locator(".popover [data-row]").filter({ hasText: /settings/i }).first().click();
	await page.waitForSelector(".settings", { timeout: 6000 });
	await page.locator('.set-group[data-group="renderer"] .seg button', { hasText: "Documents" }).click();
	await page.keyboard.press("Escape");
	await documentsReady(page);
	await settle(page, 1000);
	const back = await page.evaluate(() => ({
		renderer: document.querySelector(".stage")?.dataset.renderer,
		inSurface: document.querySelectorAll(".board-node .surface > iframe[data-path]").length,
		canvases: document.querySelectorAll(".stage > canvas").length,
		remembered: localStorage.getItem("decks.renderer"),
	}));
	say("documents again, in their boxes, with no stage canvases left", back.renderer === "dom" && back.inSurface > 0 && back.canvases === 0 && back.remembered === "dom", JSON.stringify(back));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	await browser.close();
}
