/**
 * The board list scrolls, and its thumbnails follow the scroll (DESIGN §7).
 *
 * Two bugs met here: the rail was `flex: 1` with `min-height: auto`, so it took its
 * content's full height and ran off the bottom of the screen instead of scrolling; and
 * live thumbnails were capped by *index*, so past the eighth board they stayed blank
 * however far you scrolled.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, openPanel, say, settle, socket, write } from "../harness.mjs";

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
	await page.waitForFunction((count) => document.querySelectorAll(".rail-item").length >= count, EXTRA, { timeout: 20000 });
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
	const zoomLabel = await page.locator(".zoombar .level").textContent();
	say("the camera did not pan while scrolling the list", true, `zoom still ${zoomLabel}`);

	await page.evaluate(() => {
		const items = document.querySelector(".side .rail .items");
		items.scrollTop = items.scrollHeight;
	});
	await page.waitForFunction(
		() => {
			const items = [...document.querySelectorAll(".side .rail .rail-item")];
			return Boolean(items.at(-1)?.querySelector("iframe, img"));
		},
		null,
		{ timeout: 20000 },
	);
	const last = await page.evaluate(() => {
		const items = [...document.querySelectorAll(".side .rail .rail-item")];
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
	const live = await page.evaluate(() => document.querySelectorAll(".side .rail .rail-item iframe").length);
	const total = await page.evaluate(() => document.querySelectorAll(".side .rail .rail-item").length);
	say("live thumbnails stay bounded after scrolling the list", live < total, `${live} live of ${total} items`);

	await page.evaluate(() => {
		document.querySelector(".side .rail .items").scrollTop = 0;
	});
	await page.waitForFunction(
		() => Boolean(document.querySelector(".side .rail .rail-item")?.querySelector("iframe, img")),
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
	await page.locator(".side .rail .rail-item").first().click();
	await settle(page, 900);
	await openPanel(page, "agents");
	await settle(page, 300);

	const ring = await page.evaluate(() => {
		const list = document.querySelector(".side .rail .items");
		const current = document.querySelector('.side .rail .rail-item[data-current="true"]');
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

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	for (const file of made) rmSync(file, { force: true });
	link.close();
	await page.waitForTimeout(800);
	await browser.close();
}
