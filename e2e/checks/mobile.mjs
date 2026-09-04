/**
 * The app on a phone: the gestures a hand has, and the chrome it can reach.
 *
 * Driven in a device context (`hasTouch`) with real touch events dispatched through CDP,
 * because a mouse hides every bug this file is about. Before any of this existed a
 * touchscreen had no pinch and no two-finger pan — two fingers were two independent
 * one-finger pans, so pinching pulled the canvas about — and a one-finger drag over a
 * *live* board moved nothing at all, which meant the canvas was frozen wherever a board
 * was under your finger. Both are asserted here, on bare stage and over a board, since a
 * board is a separate document and its gestures come out through `frame-gestures.ts`.
 */
import { open, openPanel, say, settle } from "../harness.mjs";

const { browser, page, context, errors } = await open({ device: "iPhone 15" });
const cdp = await context.newCDPSession(page);

const camera = () =>
	page.evaluate(() => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		return { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	});

const touch = (type, points) =>
	cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })) });

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
	await settle(page, 80);
};

const swipe = async (fingers, delta, steps = 10) => {
	let points = fingers;
	await touch("touchStart", points);
	for (let step = 0; step < steps; step++) {
		points = points.map((point) => ({ x: point.x + delta.x / steps, y: point.y + delta.y / steps }));
		await touch("touchMove", points);
		await settle(page, 16);
	}
	await touch("touchEnd", []);
	await settle(page, 80);
};

// --- 1. the input bar exists at all --------------------------------------------------
/*
 * The dock's width used to be `calc(100% - 650px)` — the room left beside two panels,
 * which on a 390px screen is negative. The composer was 18 pixels across, with the
 * placeholder broken one letter per line.
 */
const dock = await page.evaluate(() => {
	const box = (selector) => {
		const element = document.querySelector(selector);
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return { w: Math.round(rect.width), h: Math.round(rect.height) };
	};
	return { composer: box(".dockbox"), field: box(".dockfield"), send: box(".sendbtn"), width: window.innerWidth };
});
say(
	"the composer is as wide as the phone, not as wide as what is left over",
	dock.composer.w > dock.width - 60 && dock.field.w > 240,
	JSON.stringify(dock),
);
say("the send button is a fingertip target", dock.send.w >= 40 && dock.send.h >= 40, JSON.stringify(dock.send));

/*
 * And no keyboard hints under it.
 *
 * Every phrase in that row names a key — ⏎, ⇧+⏎, /, Esc — and a phone has none of them
 * until a keyboard is up, at which point the row is behind it. 18px of unreadable advice
 * directly above the one control that matters on a small screen. `pointer-coarse:hidden`
 * rather than a width, because a narrow window on a laptop still has the keys.
 */
const hints = await page.evaluate(() => {
	const row = document.querySelector(".hintrow");
	return { present: Boolean(row), shown: row ? getComputedStyle(row).display !== "none" : false };
});
say("no keyboard hints under the box on a touchscreen", hints.shown === false, JSON.stringify(hints));

/*
 * And the title bar still holds them all.
 *
 * The two clusters have to fit a line that a title bar never had to.
 *
 * There is no title bar: it held seven buttons against a layout viewport of ~490px, with
 * room for about one more and a silent failure mode — a button pushed off the right edge,
 * or one landing on top of the wordmark. The clusters cannot overflow in the same way,
 * because the tools fold into a menu under 1100px and the three secondary controls are menu
 * rows at every width. That folding is what is asserted, since the whole point of it is
 * that a phone gets a line it can hold.
 */
const bar = await page.evaluate(() => {
	const clusters = [...document.querySelectorAll("[data-inset='top']")];
	const boxes = clusters.flatMap((c) => [...c.querySelectorAll("button")]).map((b) => b.getBoundingClientRect());
	const rects = clusters.map((c) => c.getBoundingClientRect());
	return {
		clusters: clusters.length,
		buttons: boxes.length,
		width: innerWidth,
		offRight: boxes.filter((box) => box.right > innerWidth + 1).length,
		clear: rects.length === 2 ? Math.round(rects[1].left - rects[0].right) : null,
		// *Visible*, not present: the group folds with `display: none`, and
		// `querySelectorAll` counts what is hidden as happily as what is not — which is how
		// this check reported five tools on a phone that was showing none.
		toolsVisible: [...document.querySelectorAll(".palette button")].filter((b) => b.offsetParent !== null).length,
	};
});
/*
 * The two clusters must not touch, which is a stronger claim than "both fit".
 *
 * They are floats over a canvas, and two floats overlapping is the one thing a floating
 * chrome cannot do — there is no z-order that makes it read as anything but a bug. On a
 * 393px screen with 44px touch targets the left pill came to 305px and ran 42px into the
 * corner; the name and the hairlines came out of the line, and undo moved into the tools
 * menu, to buy that back.
 */
say("both clusters fit the line, with nothing off the right edge", bar.offRight === 0, JSON.stringify(bar));
say("…and the two of them do not touch", bar.clear >= 0, `${bar.clear}px between them`);
say("the tools fold away on a phone rather than pushing the corner off", bar.toolsVisible === 0, JSON.stringify(bar));

// --- 2. pinch on bare stage ---------------------------------------------------------
const start = await camera();
await pinch({ x: 190, y: 320 }, 60, 260);
const spread = await camera();
say("pinching out zooms the canvas in", spread.zoom > start.zoom * 1.5, `${start.zoom.toFixed(3)} -> ${spread.zoom.toFixed(3)}`);
await pinch({ x: 190, y: 320 }, 260, 90);
say("pinching in zooms back out", (await camera()).zoom < spread.zoom, `${spread.zoom.toFixed(3)}`);

// --- 3. two fingers moving together are a pan, not a double-speed one -----------------
const before = await camera();
await swipe(
	[
		{ x: 150, y: 300 },
		{ x: 250, y: 300 },
	],
	{ x: 80, y: 0 },
);
const after = await camera();
const travelled = (before.x - after.x) * before.zoom;
say("two fingers moving together pan the canvas", Math.abs(travelled) > 20, `${travelled.toFixed(1)} screen px`);
say("and hold the zoom while they do", Math.abs(after.zoom - before.zoom) < 1e-6, `${before.zoom} -> ${after.zoom}`);
say(
	"a two-finger pan travels the distance the fingers did, not twice it",
	Math.abs(Math.abs(travelled) - 80) < 12,
	`${travelled.toFixed(1)} for 80px of finger`,
);

// --- 4. the same gestures over a live board ------------------------------------------
// Fly to one board and get past `INTERACT_ZOOM`, where its frame takes pointer events
// and every gesture has to be forwarded back out of it.
/*
 * Zoom in until a board is interactive, and give up rather than spin.
 *
 * Two loops here used to click `.pill [aria-label^="Zoom"]` until the zoom rose past a
 * threshold. That selector is the zoom *chip*, and the chip opens a menu — it does not zoom
 * — so the condition could never become true and the check sat in an unbounded `while` for
 * twenty-three minutes, which in a suite reads as a hang rather than a failure.
 *
 * `=` is the stage's own zoom-in key, so this asks the app the way a person would. The bound
 * is the point as much as the key is: a loop in a check needs somewhere to stop, or the next
 * selector that goes stale costs a run instead of a line.
 */
const zoomTo = async (wanted) => {
	for (let step = 0; step < 40; step++) {
		if ((await camera()).zoom >= wanted) return true;
		await page.keyboard.press("=");
		await settle(page, 60);
	}
	return (await camera()).zoom >= wanted;
};

await page.evaluate(() => [...document.querySelectorAll(".board-row")].find((item) => item.textContent.includes("plan.html"))?.click());
await settle(page, 500);
say("the canvas reaches editing zoom on a phone", await zoomTo(0.6), `${(await camera()).zoom.toFixed(2)}`);
const over = await page.evaluate(() => {
	const surface = document.querySelector('.board-node[data-path="boards/plan.html"] .surface');
	const rect = surface.getBoundingClientRect();
	return {
		x: Math.min(window.innerWidth - 60, Math.max(60, rect.x + rect.width / 2)),
		y: Math.min(window.innerHeight - 220, Math.max(140, rect.y + rect.height / 2)),
	};
});
say("the gesture point is over a live board", await page.evaluate((at) => document.elementFromPoint(at.x, at.y)?.tagName === "IFRAME", over));

const onBoard = await camera();
await swipe([over], { x: 0, y: -60 });
const panned = await camera();
say(
	"one finger over a board pans the canvas — it used to move nothing",
	Math.abs((panned.y - onBoard.y) * onBoard.zoom - 60) < 12,
	`${((panned.y - onBoard.y) * onBoard.zoom).toFixed(1)} screen px for 60px of finger`,
);
say("and does not carry the board off with it", Math.abs(panned.zoom - onBoard.zoom) < 1e-6);

// Pinching over a board must hold the world point between the fingers, which is the
// property `gestures.mjs` asserts for the wheel and the only one worth measuring here.
// Measured through the camera rather than through the frame's box: the transform is what
// the assertion is about, and reading it back needs no assumptions about the layout.
const anchor = await page.evaluate((at) => {
	const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
		document.querySelector(".world").style.transform,
	);
	const camera = { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
	const stage = document.querySelector(".stage").getBoundingClientRect();
	const view = { width: stage.width, height: stage.height };
	return {
		x: (at.x - stage.left - view.width / 2) / camera.zoom + camera.x,
		y: (at.y - stage.top - view.height / 2) / camera.zoom + camera.y,
	};
}, over);
await pinch(over, 80, 220);
const drift = await page.evaluate(
	(world) => {
		const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
			document.querySelector(".world").style.transform,
		);
		const camera = { zoom: Number(m[3]), x: -Number(m[4]), y: -Number(m[5]) };
		const stage = document.querySelector(".stage").getBoundingClientRect();
		return {
			x: (world.x - camera.x) * camera.zoom + stage.width / 2 + stage.left,
			y: (world.y - camera.y) * camera.zoom + stage.height / 2 + stage.top,
		};
	},
	anchor,
);
const zoomedOverBoard = await camera();
say("pinching over a board zooms the canvas", zoomedOverBoard.zoom > onBoard.zoom, `${onBoard.zoom.toFixed(3)} -> ${zoomedOverBoard.zoom.toFixed(3)}`);
say(
	"and holds the world point between the fingers",
	Math.abs(drift.x - over.x) < 3 && Math.abs(drift.y - over.y) < 3,
	`the point the pinch started on is now at ${drift.x.toFixed(1)}/${drift.y.toFixed(1)}, the fingers were at ${over.x}/${over.y}`,
);

// --- 5. tap to select, tap again to type ---------------------------------------------
// Back to the whole board and just past `INTERACT_ZOOM`, so there is something small
// enough to aim at and it is where the maths says it is.
const frameBoard = async (name) => {
	/*
	 * Open the sheet to reach the row, then put it away again.
	 *
	 * The panel starts closed on a phone — it is a sheet over the canvas there, and a canvas
	 * app should not open with something covering the canvas — so there was no `.board-row`
	 * to click and the `?.click()` did nothing silently. Nothing was selected, `1` fitted
	 * whichever board came first instead, and the frame this check wanted had unmounted by
	 * the time it looked for it.
	 *
	 * And it has to close again before anything is aimed at: the sheet covers the left two
	 * thirds of a 393px screen, which is where the board now is.
	 */
	await openPanel(page, "deck");
	await page.locator(".board-row").filter({ hasText: name }).first().click();
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="boards/${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		name,
		{ timeout: 15000 },
	);
	await page.locator('.pill button[aria-label$="the boards panel"]').tap();
	await settle(page, 320);
	/*
	 * `1` fits the selected board rather than stepping the zoom up.
	 *
	 * Stepping zooms about the viewport centre, so twelve steps drift — the board ends up
	 * past an edge and the next assertion goes looking for a run of text that is off screen.
	 * Fitting is one move to a known frame, and it is also what a person would press.
	 */
	await page.keyboard.press("1");
	await settle(page, 500);
	if ((await camera()).zoom < 0.55) await zoomTo(0.55);
};
await frameBoard("plan.html");

const run = await page.evaluate(() => {
	const frame = document.querySelector('.board-node[data-path="boards/plan.html"] iframe');
	const rect = frame.getBoundingClientRect();
	const scale = rect.width / frame.clientWidth;
	const at = (node) => {
		const box = node.getBoundingClientRect();
		return { x: rect.left + (box.x + Math.min(40, box.width / 2)) * scale, y: rect.top + (box.y + box.height / 2) * scale };
	};
	/*
	 * A leaf holding words, which is what makes a run retypeable (DESIGN §6.5). Asked of the
	 * shape rather than of an attribute: it used to look for `[data-edit]`, a name the
	 * board's author had to write, and a run without one was not editable by any gesture.
	 */
	const found = [...frame.contentDocument.querySelectorAll("[data-id] *, [data-id]")].find((node) => {
		if (node.children.length > 0 || (node.textContent ?? "").trim().length < 5) return false;
		if (node.closest("[data-md], [data-mermaid], [data-embed], svg")) return false;
		const point = at(node);
		return point.x > 40 && point.x < window.innerWidth - 40 && point.y > 120 && point.y < 300;
	});
	return found ? { id: found.closest("[data-id]").dataset.id, tag: found.tagName.toLowerCase(), ...at(found) } : null;
});
if (!run) {
	say("a run of text is on screen to tap", false, "nothing found — the camera moved somewhere unexpected");
} else {
	const tap = async () => {
		await touch("touchStart", [{ x: run.x, y: run.y }]);
		await touch("touchEnd", []);
		await settle(page, 250);
	};
	await tap();
	const selected = await page.evaluate(
		() =>
			document
				.querySelector('.board-node[data-path="boards/plan.html"] iframe')
				.contentDocument.querySelector(".decks-editing")?.dataset.id ?? null,
	);
	say("one tap selects the component under it", selected === run.id, `${selected} vs ${run.id}`);
	say("and the inspector comes with it", await page.evaluate(() => Boolean(document.querySelector(".inspector"))));

	// A double-tap is the browser's zoom gesture, so the second tap is the text edit.
	await tap();
	const typing = await page.evaluate(() =>
		Boolean(
			document
				.querySelector('.board-node[data-path="boards/plan.html"] iframe')
				.contentDocument.querySelector('[contenteditable="true"]'),
		),
	);
	say("tapping it again starts typing over the run of text", typing, `over the <${run.tag}> in #${run.id}`);
	await page.evaluate(() =>
		document
			.querySelector('.board-node[data-path="boards/plan.html"] iframe')
			.contentDocument.querySelector('[contenteditable="true"]')
			?.blur(),
	);
	await settle(page, 300);
}

// --- 6. a scroll an embed can take is still the embed's -------------------------------
/*
 * The rule the wheel path documents (§7), now for a finger: the canvas takes over at the
 * end of the box, and a `touch-action: none` inside the frame means it has to be done by
 * hand. The board with the embeds is the one this can be asked of.
 */
await frameBoard("sources.html");

/** Where a scrollable embed body is, having first brought it into view. */
const findEmbed = () =>
	page.evaluate(() => {
		const frame = document.querySelector('.board-node[data-path="boards/sources.html"] iframe');
		const rect = frame.getBoundingClientRect();
		const scale = rect.width / frame.clientWidth;
		for (const body of frame.contentDocument.querySelectorAll(".embed-body")) {
			const room = Math.round(body.scrollHeight - body.clientHeight);
			if (room < 20) continue;
			const box = body.getBoundingClientRect();
			body.dataset.decksProbe = "true";
			return {
				point: { x: rect.left + (box.left + 40) * scale, y: rect.top + (box.top + 40) * scale },
				room,
				top: Math.round(body.scrollTop),
			};
		}
		return null;
	});

/*
 * Brought into view with a wheel pan, which is the one way a check can move the camera by
 * an exact amount (`gestures.mjs` does the same): the fixture's embeds are wherever the
 * board puts them, and at a zoom where a phone can read one, most of the board is off
 * screen.
 */
const wheelPan = (dx, dy) =>
	page.evaluate(
		(delta) =>
			document.querySelector(".stage").dispatchEvent(
				new WheelEvent("wheel", { deltaX: delta.dx, deltaY: delta.dy, clientX: 190, clientY: 300, bubbles: true, cancelable: true }),
			),
		{ dx, dy },
	);
const wanted = { x: 190, y: 240 };
let embed = await findEmbed();
if (embed) {
	await wheelPan(embed.point.x - wanted.x, embed.point.y - wanted.y);
	await settle(page, 200);
	embed = await findEmbed();
}
if (!embed) {
	say("an embed with something to scroll is on screen", false, "none of them is both");
} else {
	const cameraWas = await camera();
	await swipe([embed.point], { x: 0, y: -70 });
	const scrolled = await page.evaluate(() =>
		Math.round(
			document
				.querySelector('.board-node[data-path="boards/sources.html"] iframe')
				.contentDocument.querySelector('[data-decks-probe="true"]').scrollTop,
		),
	);
	const cameraNow = await camera();
	say("a finger dragged up inside an embed scrolls the embed", scrolled > 10, `scrollTop ${embed.top} -> ${scrolled}`);
	say(
		"and leaves the camera where it was",
		Math.abs(cameraNow.y - cameraWas.y) < 1 && Math.abs(cameraNow.x - cameraWas.x) < 1,
		`${JSON.stringify(cameraWas)} -> ${JSON.stringify(cameraNow)}`,
	);
}

// --- 7. the panels, and the conversation ---------------------------------------------
//
// Two ways in: the title bar's buttons, and a swipe in from the edge. The swipe is the one a
// phone teaches, and the one that has to be proved over a board as well as over bare stage —
// a board is a separate document, so a gesture watched on `window` would die exactly where
// the screen is fullest. The left edge brings the **agents**: the boards have a button of
// their own now, and one edge cannot carry two drawers without asking which you meant.
const openState = () =>
	page.evaluate(() => ({
		// `data-open`, not presence: the panel stays mounted so it can animate out.
		boards: document.querySelector(".panel-shell")?.dataset.open === "true",
		right: (document.querySelector("[data-shown]")?.dataset.shown ?? "false") === "true",
	}));
const away = await openState();
say("the conversation starts away", away.right === false, JSON.stringify(away));

/*
 * Two surfaces take turns now, not three: the agents became a dropdown, so there is one
 * panel and one conversation. 264px of panel and 320px of cards on a 390px screen is two
 * surfaces and no canvas, which is the whole reason for the rule.
 */
await page.locator('.pill button[aria-label$="the boards panel"]').tap();
await settle(page, 320);
say("a tap on the pill brings the boards sheet out", (await openState()).boards === true, JSON.stringify(await openState()));

await page.locator('.pill button[title^="Conversation"]').tap();
await settle(page, 320);
const both = await openState();
say("opening the conversation puts the sheet away", both.right === true && both.boards === false, JSON.stringify(both));

await page.locator('.pill button[title^="Conversation"]').tap();
await settle(page, 320);
say("and tapping it again puts it away", (await openState()).right === false, JSON.stringify(await openState()));

/*
 * A swipe toward the right edge is the other way out — the gesture a phone already
 * teaches for a sheet, and the one thing about the conversation that a finger can do and a
 * cursor cannot. It has to survive the bubbles being a scroller: a *vertical* drag inside
 * them belongs to the history, so only horizontal travel takes the sheet.
 */
await page.locator('.pill button[title^="Conversation"]').tap();
await settle(page, 400);
say("…and it opens again", (await openState()).right, JSON.stringify(await openState()));
/*
 * Before the swipe that closes it: the history has to *scroll* under a finger, and from
 * anywhere in the sheet rather than only from a card.
 *
 * The column takes no pointer events and its cards take their own, so the gaps between
 * turns stay canvas — right beside the canvas, wrong over it. On a phone this is a
 * full-width sheet with nothing reachable behind it, and a thumb landing in a gap did
 * nothing at all: "the history will not scroll", when in fact it scrolled fine from the
 * middle of a card. Below 1100px the roll takes the pointer (`Stream.tsx`).
 *
 * The cards are the harness's own, because a fresh agent has said nothing and a scroller
 * with nothing in it cannot be scrolled. What is under test is which element the finger
 * lands on, not what the transcript happens to hold.
 */
const gutter = await page.evaluate(() => {
	const roll = document.querySelector(".stream .stream-roll");
	for (let i = 0; i < 14; i++) {
		const filler = document.createElement("div");
		filler.className = "stream-card";
		filler.dataset.harness = "filler";
		filler.textContent = `Filler ${i + 1} — long enough to take a line or two of the column.`;
		roll.append(filler);
	}
	roll.scrollTop = roll.scrollHeight;
	const box = roll.getBoundingClientRect();
	return { room: roll.scrollHeight - roll.clientHeight, top: roll.scrollTop, at: { x: Math.round(box.left + 8), y: Math.round(box.top + box.height / 2) } };
});
await swipe([gutter.at], { x: 0, y: 180 }, 12);
const scrolledHistory = await page.evaluate(() => Math.round(document.querySelector(".stream .stream-roll").scrollTop));
say(
	"a finger anywhere in the conversation scrolls it, not only on a card",
	gutter.room > 100 && scrolledHistory < gutter.top - 50,
	`scrollTop ${gutter.top} -> ${scrolledHistory}, ${gutter.room}px of room`,
);
await page.evaluate(() => document.querySelectorAll('[data-harness="filler"]').forEach((node) => node.remove()));
await settle(page, 200);

const middle = await page.evaluate(() => {
	const box = document.querySelector(".stream .stream-roll").getBoundingClientRect();
	return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
});
await swipe([middle], { x: 260, y: 0 }, 12);
await settle(page, 500);
say("a swipe to the right edge puts the conversation away", !(await openState()).right, JSON.stringify(await openState()));

/*
 * And in from the edges, which is how the panels are opened rather than closed.
 *
 * The assertion that matters as much as the opening is that **the camera does not move**.
 * A finger landing in the outermost 28px is held until the gesture says which of the two
 * it is, because 44px of canvas lurching before the panel appears is worse than a pan that
 * starts a little late (`canvas/edge-swipe.ts`).
 */
/*
 * The *layout* viewport, asked of the page.
 *
 * `page.viewportSize()` is 393 on this device and `window.innerWidth` is 435 — Playwright's
 * mobile emulation lays the page out wider than the visual viewport and scales it down. Touch
 * coordinates are layout pixels, so `viewportSize().width - 3` is 45px short of the edge the
 * app watches, which is a gesture aimed at the middle of nothing.
 */
const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
const mid = Math.round(size.height / 2);

const wasCamera = await camera();
await swipe([{ x: 3, y: mid }], { x: 150, y: 0 }, 12);
await settle(page, 400);
say("a swipe in from the left edge brings the boards out", (await openState()).boards, JSON.stringify(await openState()));
const afterLeft = await camera();
say(
	"…and the canvas did not lurch under it",
	afterLeft.x === wasCamera.x && afterLeft.y === wasCamera.y,
	`${wasCamera.x},${wasCamera.y} -> ${afterLeft.x},${afterLeft.y}`,
);

await swipe([{ x: size.width - 3, y: mid }], { x: -150, y: 0 }, 12);
await settle(page, 400);
const swiped = await openState();
say("a swipe in from the right edge brings the conversation out", swiped.right, JSON.stringify(swiped));
say("…and takes the sheet's place, on a screen too narrow for both", !swiped.boards, JSON.stringify(swiped));

await page.locator('.pill button[title^="Conversation"]').tap();
await settle(page, 300);

/*
 * A drag that begins at the edge and goes *down* is not a drawer, and the claim on the
 * finger has to be given back: otherwise the outermost 28px of the screen would be a strip
 * the canvas cannot be panned from.
 */
const beforeDown = await camera();
await swipe([{ x: 3, y: mid }], { x: 0, y: -200 }, 12);
await settle(page, 400);
const afterDown = await camera();
say("a vertical drag from the edge is not a drawer", !(await openState()).boards, JSON.stringify(await openState()));
say("…and the canvas gets the finger back", afterDown.y !== beforeDown.y, `${beforeDown.y} -> ${afterDown.y}`);

/*
 * The same swipe over a live board. This is the case the gesture exists to survive: a
 * board's pointer events never reach this document (DESIGN §4), so the fingers come out
 * through `frame-gestures.ts` and both paths have to end in the same pool.
 */
await page.evaluate(() => document.querySelector(".board-row")?.click());
await settle(page, 2500);
// Fitting a board leaves a margin, so the edge is still bare stage: pinch out until the
// frame reaches it. Pinching rather than the zoom buttons because the inspector is a
// bottom sheet on this screen, where the inspector used to have the corner to itself.
for (let attempt = 0; attempt < 4; attempt++) {
	if ((await page.evaluate((y) => document.elementFromPoint(3, y)?.tagName.toLowerCase(), mid)) === "iframe") break;
	await pinch({ x: Math.round(size.width / 2), y: mid }, 100, 260);
	await settle(page, 400);
}
await settle(page, 800);
const overBoard = await page.evaluate((y) => document.elementFromPoint(3, y)?.tagName.toLowerCase(), mid);
say("zoomed in, the left edge is over a live board's frame", overBoard === "iframe", `${overBoard} at ${(await camera()).zoom.toFixed(2)}`);
await swipe([{ x: 3, y: mid }], { x: 150, y: 0 }, 12);
await settle(page, 400);
say("the edge swipe works over a board too", (await openState()).boards, JSON.stringify(await openState()));
await page.locator('.pill button[aria-label$="the boards panel"]').tap();
await settle(page, 300);

// --- 7b. the panel's own header is a fingertip's, not a cursor's ---------------------
/*
 * A 28px search field is right beside a cursor, where the panel is a dense list and its
 * header should not compete with it. On a phone the same header is a *sheet's* and the only
 * control above a scrolling list, and 28px is a thumb's-width of guesswork.
 *
 * The tab strip that used to be up here is gone — one list, three headings — so what is left
 * to size is the field, the foot and the two toggles in it.
 *
 * The 16px on the input is the one number here that is not about looks: below 16, iOS zooms
 * the page when a field takes focus, which leaves the canvas at a scale nobody chose and the
 * chrome half off screen. The composer's field has carried that number for the same reason.
 */
await openPanel(page, "deck");
const header = await page.evaluate(() => {
	const box = (selector) => {
		const element = document.querySelector(selector);
		return element ? Math.round(element.getBoundingClientRect().height) : 0;
	};
	return {
		tabs: document.querySelectorAll('[role="tab"]').length,
		field: box(".panel-shell .field"),
		font: Math.round(parseFloat(getComputedStyle(document.querySelector(".panel-shell .field input")).fontSize)),
		foot: box(".panel-foot"),
		toggle: box(".panel-foot .seg button"),
	};
});
say("no tab strip to aim at, on a phone least of all", header.tabs === 0, JSON.stringify(header));
say("the panel's search field is a finger tall", header.field >= 36, JSON.stringify(header));
say("…and its foot, which has two more targets in it", header.foot >= 40 && header.toggle >= 28, JSON.stringify(header));
say("the search input is 16px, so focusing it does not zoom the page", header.font >= 16, JSON.stringify(header));

/*
 * Both marks on a row, side by side, because a thumb never hovers.
 *
 * Beside a cursor the bin stands *in* the dot's column and the dot gives way to it on
 * approach. There is no approach here, so hiding the dot behind a permanently visible bin
 * would lose the one thing that says a board is on the canvas.
 */
const marks = await page.evaluate(() => {
	const row = document.querySelector(".board-act:has(.dot)");
	if (!row) return null;
	const dot = row.querySelector(".dot").getBoundingClientRect();
	const bin = row.querySelector(".board-del").getBoundingClientRect();
	return {
		dot: getComputedStyle(row.querySelector(".dot"), "::before").opacity,
		bin: getComputedStyle(row.querySelector(".board-del")).opacity,
		apart: Math.round(bin.left - dot.right),
	};
});
say(
	"a row on the canvas shows its dot and its bin, side by side",
	marks === null || (marks.dot === "1" && marks.bin === "1" && marks.apart >= 0),
	JSON.stringify(marks),
);

/*
 * And the page itself does not zoom: one pinch, and the thing it zooms is the canvas.
 *
 * The meta is honoured by Android and ignored by iOS, which is why the gesture events are
 * refused as well — that is the half this can actually exercise in Chromium.
 */
const zoomable = await page.evaluate(() => {
	const meta = document.querySelector('meta[name="viewport"]')?.content ?? "";
	const event = new Event("gesturestart", { cancelable: true, bubbles: true });
	document.dispatchEvent(event);
	return { meta, refused: event.defaultPrevented };
});
say("the viewport says the page is not scalable", /user-scalable=no/.test(zoomable.meta) && /maximum-scale=1/.test(zoomable.meta), zoomable.meta);
say("…and a pinch gesture aimed at the page is refused", zoomable.refused, JSON.stringify(zoomable));
await page.locator('.pill button[aria-label$="the boards panel"]').tap();
await settle(page, 300);

// --- 8. nothing in the chrome is smaller than a fingertip ---------------------------
const small = await page.evaluate(() => {
	/*
	 * Everything a finger has to hit. The title bar and the zoombar are gone, so the list is
	 * the two clusters, the tools wherever they currently live, and the send button.
	 */
	const wanted = "[data-inset='top'] button, .palette button, .sendbtn";
	return [...document.querySelectorAll(wanted)]
		.filter((element) => element.getBoundingClientRect().width > 0)
		.map((element) => ({
			what: `${element.className || element.tagName} ${element.getAttribute("aria-label") ?? ""}`.trim(),
			w: Math.round(element.getBoundingClientRect().width),
			h: Math.round(element.getBoundingClientRect().height),
		}))
		.filter((entry) => entry.w < 40 || entry.h < 40);
});
say("every button in the chrome is at least 40px", small.length === 0, JSON.stringify(small));


say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
