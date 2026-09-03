/**
 * Gestures that start over a board are forwarded out of it (DESIGN §7).
 *
 * A board frame is a separate document, so a wheel event over it never reaches the stage.
 * With the frame live that meant panning and pinching stopped working exactly where the
 * user is most likely to be looking.
 */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open();
await page.evaluate(() => document.querySelector(".board-row").click());
await page.waitForFunction(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")) > 40, null, { timeout: 8000 });

const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		return { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	});
const inFrameWheel = (options) =>
	page.evaluate((o) => {
		const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
		const doc = frame.contentDocument;
		(doc.elementFromPoint(o.clientX, o.clientY) ?? doc.body).dispatchEvent(
			new frame.contentWindow.WheelEvent("wheel", { ...o, bubbles: true, cancelable: true }),
		);
	}, options);
const onStageWheel = (options) =>
	page.evaluate((o) => {
		document.querySelector(".stage").dispatchEvent(new WheelEvent("wheel", { ...o, bubbles: true, cancelable: true }));
	}, options);

/*
 * 1. The same delta must move the camera by the same amount, wherever the cursor is.
 *
 * Fitted before each of the two measurements, and that is not ceremony: the first wheel
 * *pans*, which can carry the board being aimed at out of the viewport — and a frame that
 * leaves the viewport unmounts its document, so the second measurement went looking for an
 * iframe that had been disposed of a moment earlier. Fitting between them makes the two
 * halves of the comparison start from the same place, which is what the comparison claims
 * anyway.
 */
const refit = async () => {
	await page.keyboard.press("0");
	await settle(page, 300);
};

await refit();
const a0 = await camera();
await onStageWheel({ deltaX: 0, deltaY: 150, clientX: 800, clientY: 500 });
await settle(page, 200);
const a1 = await camera();
const overStage = { dx: a1.x - a0.x, dy: a1.y - a0.y };

await refit();
const a1b = await camera();
await inFrameWheel({ deltaX: 0, deltaY: 150, clientX: 200, clientY: 200 });
await settle(page, 200);
const a2 = await camera();
const overBoard = { dx: a2.x - a1b.x, dy: a2.y - a1b.y };
say(
	"a pan over a board moves the camera exactly as far as over bare stage",
	Math.abs(overStage.dy - overBoard.dy) < 0.5 && Math.abs(overStage.dx - overBoard.dx) < 0.5,
	`${JSON.stringify(overStage)} vs ${JSON.stringify(overBoard)}`,
);

// 2. Zooming over a board holds the world point under the cursor.
const anchorDrift = await page.evaluate(async () => {
	const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
	const doc = frame.contentDocument;
	const inFrame = { x: 260, y: 180 };
	const screenOf = () => {
		const rect = frame.getBoundingClientRect();
		const scale = rect.width / frame.clientWidth;
		return { x: rect.left + inFrame.x * scale, y: rect.top + inFrame.y * scale };
	};
	const before = screenOf();
	for (let i = 0; i < 5; i++) {
		(doc.elementFromPoint(inFrame.x, inFrame.y) ?? doc.body).dispatchEvent(
			new frame.contentWindow.WheelEvent("wheel", {
				deltaY: -60,
				ctrlKey: true,
				clientX: inFrame.x,
				clientY: inFrame.y,
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
	const after = screenOf();
	return { x: Math.abs(after.x - before.x), y: Math.abs(after.y - before.y) };
});
say("zooming over a board holds the point under the cursor", anchorDrift.x < 2 && anchorDrift.y < 2, `drift ${anchorDrift.x.toFixed(2)}/${anchorDrift.y.toFixed(2)}px`);

// 3. A board still does not scroll inside its own frame.
const scrolled = await page.evaluate(() => {
	const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
	return { x: frame.contentWindow.scrollX, y: frame.contentWindow.scrollY };
});
say("the board itself never scrolls", scrolled.x === 0 && scrolled.y === 0, JSON.stringify(scrolled));

// 4. Clicking a component still selects it — the pan capture must not eat clicks.
await page.evaluate(() => {
	const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
	const element = frame.contentDocument.querySelector('[data-id="goal"]');
	const box = element.getBoundingClientRect();
	element.dispatchEvent(
		new frame.contentWindow.PointerEvent("pointerdown", {
			clientX: box.x + 20,
			clientY: box.y + 20,
			button: 0,
			bubbles: true,
			cancelable: true,
			isPrimary: true,
		}),
	);
});
await page.waitForFunction(
	() =>
		document
			.querySelector('.board-node[data-path="boards/plan.html"] iframe')
			?.contentDocument?.querySelector('[data-id="goal"]')
			?.classList.contains("decks-editing") === true,
	null,
	{ timeout: 5000 },
);
say("clicking a component still selects it", true);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
