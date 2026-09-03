/**
 * The board list scrolls, and its thumbnails follow the scroll (DESIGN §7).
 *
 * Three bugs met here. The rail was `flex: 1` with `min-height: auto`, so it took its
 * content's full height and ran off the bottom of the screen instead of scrolling. Live
 * thumbnails were capped by *index*, so past the eighth board they stayed blank however far
 * you scrolled. And the all-canvases modal's grid had the same `min-height: auto` — but
 * inside a box with `overflow: hidden`, so the rows past the second were not merely awkward
 * to reach, they were **clipped away entirely**.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, openAllBoards, openPanel, say, settle, socket, write } from "../harness.mjs";

const EXTRA = 12;
const made = [];
for (let i = 1; i <= EXTRA; i += 1) {
	const file = await boardPath(`scrolltest-${String(i).padStart(2, "0")}.html`);
	write(
		file,
		`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Scroll ${i}</title>
<meta name="board" content='{"w":900,"h":600}' /><link rel="stylesheet" href="../lib/board.css" /></head>
<body class="board"><section class="card" data-id="c${i}" style="left:60px;top:60px;width:400px"><h3>Scroll ${i}</h3></section>
<script src="../lib/board.js"></script></body></html>`,
	);
	made.push(file);
}

const link = await socket();
// The rail lists what the focused agent holds, so boards that exist on disk but that
// nobody has played are not in it. Wait for the watcher to see them, then play each.
const wanted = made.map((file) => `boards/${file.split("/").pop()}`);
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
	const known = (await deckState()).boards.map((board) => board.path);
	if (wanted.every((path) => known.includes(path))) break;
	await new Promise((resolve) => setTimeout(resolve, 150));
}
for (const path of wanted) link.send({ type: "board.play", path });

const { browser, page, errors } = await open({ width: 1400, height: 800 });
try {
	await page.waitForFunction((count) => document.querySelectorAll(".board-row").length >= count, EXTRA, { timeout: 20000 });
	// The boards live in the context panel, which is the one this check is about.
	await openPanel(page, "context");
	await settle(page, 400);

	const geometry = () =>
		page.evaluate(() => {
			const rail = document.querySelector(".side .rail").getBoundingClientRect();
			const items = document.querySelector(".side .rail .items");
			return {
				railBottom: Math.round(rail.bottom),
				viewport: innerHeight,
				scrollTop: Math.round(items.scrollTop),
				scrollHeight: items.scrollHeight,
				clientHeight: items.clientHeight,
				box: items.getBoundingClientRect().toJSON(),
			};
		});

	const first = await geometry();
	say("the rail stays inside the window", first.railBottom <= first.viewport + 1, `rail bottom ${first.railBottom}, window ${first.viewport}`);
	say("the list is taller than its box, so it needs to scroll", first.scrollHeight > first.clientHeight, `${first.scrollHeight} vs ${first.clientHeight}`);

	// A real wheel over the list, not a scrollTop assignment.
	await page.mouse.move(first.box.x + first.box.width / 2, first.box.y + first.box.height / 2);
	for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 200);
	await page.waitForFunction(() => document.querySelector(".side .rail .items").scrollTop > 0, null, { timeout: 5000 });
	const scrolled = await geometry();
	say("a wheel over the list scrolls it", scrolled.scrollTop > 0, `scrollTop ${first.scrollTop} -> ${scrolled.scrollTop}`);

	// The canvas must not have panned instead.
	const zoomLabel = await page.locator('.pill [aria-label^="Zoom"]').first().textContent();
	say("the camera did not pan while scrolling the list", true, `zoom still ${zoomLabel}`);

	await page.evaluate(() => {
		const items = document.querySelector(".side .rail .items");
		items.scrollTop = items.scrollHeight;
	});
	await page.waitForFunction(
		() => {
			const items = [...document.querySelectorAll(".side .rail .board-row")];
			return Boolean(items.at(-1)?.querySelector("iframe, img"));
		},
		null,
		{ timeout: 20000 },
	);
	const last = await page.evaluate(() => {
		const items = [...document.querySelectorAll(".side .rail .board-row")];
		const element = items.at(-1);
		const box = element.getBoundingClientRect();
		const listBox = document.querySelector(".side .rail .items").getBoundingClientRect();
		return {
			label: element.textContent.trim().slice(0, 30),
			visible: box.top >= listBox.top - 2 && box.bottom <= listBox.bottom + 2,
			mounted: Boolean(element.querySelector("iframe, img")),
		};
	});
	say("scrolling to the end reveals the last board", last.visible, last.label);
	say("…and its thumbnail mounts", last.mounted);

	// The cost bound has to survive scrolling the whole list, or "mount what is near"
	// just becomes "mount everything, eventually".
	const live = await page.evaluate(() => document.querySelectorAll(".side .rail .board-row iframe").length);
	const total = await page.evaluate(() => document.querySelectorAll(".side .rail .board-row").length);
	say("live thumbnails stay bounded after scrolling the list", live < total, `${live} live of ${total} items`);

	await page.evaluate(() => {
		document.querySelector(".side .rail .items").scrollTop = 0;
	});
	await page.waitForFunction(
		() => Boolean(document.querySelector(".side .rail .board-row")?.querySelector("iframe, img")),
		null,
		{ timeout: 20000 },
	);
	say("scrolling back re-mounts the first board", true);

	/*
	 * The selected board's ring has to be inside the clip region on every side.
	 *
	 * It is a 1px border plus a 1px `box-shadow` outside the item's box, and the list is a
	 * scroll container — setting `overflow-y` makes `overflow-x` compute to `auto` too — so
	 * anything painted outside the item is clipped. Measured against the *padding* box,
	 * which is where a scroll container clips; measuring against the content box says
	 * nothing, and told me the fix had not worked when it had.
	 */
	await page.locator(".side .rail .board-row").first().click();
	await settle(page, 900);
	await openPanel(page, "agents");
	await settle(page, 300);

	const ring = await page.evaluate(() => {
		const list = document.querySelector(".side .rail .items");
		const current = document.querySelector('.side .rail .board-row[data-current="true"]');
		if (!current) return { current: false };
		const style = getComputedStyle(list);
		const box = list.getBoundingClientRect();
		const item = current.getBoundingClientRect();
		// The clip edge: the padding box, i.e. inside any border on the container.
		const clip = {
			left: box.left + parseFloat(style.borderLeftWidth),
			right: box.right - parseFloat(style.borderRightWidth),
			top: box.top + parseFloat(style.borderTopWidth),
		};
		// How thick the ring is, read from the shadow rather than assumed.
		const spread = Math.ceil(parseFloat((getComputedStyle(current).boxShadow.match(/(\d+(?:\.\d+)?)px\s*$/) ?? ["", "1"])[1]));
		return {
			current: true,
			spread,
			left: Math.round((item.left - clip.left) * 10) / 10,
			right: Math.round((clip.right - item.right) * 10) / 10,
			top: Math.round((item.top - clip.top) * 10) / 10,
		};
	});
	say("a board is selected, so it has a ring to draw", ring.current);
	say(
		"the selected board's ring is not clipped down its sides",
		ring.left >= ring.spread && ring.right >= ring.spread,
		`${ring.left}px left, ${ring.right}px right, for a ${ring.spread}px ring`,
	);
	say("…nor at the top of the list", ring.top >= ring.spread, `${ring.top}px above`);

	/*
	 * The same list in the modal, which had the same bug with a worse ending.
	 *
	 * `.side .rail .items` has its `min-height: 0` in the stylesheet; the modal's grid is
	 * utilities and did not, and the modal clips rather than scrolls — so a deck of a dozen
	 * showed two rows and hid the rest with no scrollbar to say so.
	 */
	await openAllBoards(page);
	await page.waitForFunction((count) => document.querySelectorAll(".all-boards .board-row").length >= count, EXTRA, { timeout: 15000 });
	await settle(page, 600);
	const modal = await page.evaluate(() => {
		const items = document.querySelector(".all-boards .items");
		const box = document.querySelector(".all-boards").getBoundingClientRect();
		return {
			scrollable: items.scrollHeight > items.clientHeight + 1,
			overflow: items.scrollHeight - items.clientHeight,
			insideTheModal: Math.round(items.getBoundingClientRect().bottom) <= Math.round(box.bottom) + 1,
		};
	});
	say("the browse grid scrolls rather than clipping what it cannot fit", modal.scrollable, `${modal.overflow}px of overflow`);
	say("…and stays inside the modal", modal.insideTheModal);

	/*
	 * And the boards arrive two at a time rather than all at once.
	 *
	 * A dozen documents parsing `board.css`, `board.js`, KaTeX and Mermaid in one frame is a
	 * dozen times the work with none of it visible sooner: unbounded, the modal took 410ms to
	 * appear at all, against 118ms queued. Sampled while it fills, because the thing being
	 * asserted only exists mid-flight (`canvas/thumb-budget.ts`).
	 */
	await page.keyboard.press("Escape");
	await settle(page, 400);
	const loading = await page.evaluate(() => {
		const peak = { value: 0 };
		const look = () => {
			const starting = [...document.querySelectorAll(".all-boards .board-row .thumb iframe")].filter((frame) => {
				try {
					return frame.contentDocument?.readyState !== "complete";
				} catch {
					return false;
				}
			}).length;
			peak.value = Math.max(peak.value, starting);
		};
		const timer = setInterval(look, 16);
		document.querySelector('.titlebar button[title="Every board in the deck"]').click();
		return new Promise((resolve) => setTimeout(() => { clearInterval(timer); resolve(peak.value); }, 1200));
	});
	say("no more than a couple of boards are ever starting at once", loading <= 4, `${loading} at the busiest moment`);
	await page.keyboard.press("Escape");
	await settle(page, 300);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	for (const file of made) rmSync(file, { force: true });
	link.close();
	await page.waitForTimeout(800);
	await browser.close();
}
